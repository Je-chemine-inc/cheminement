import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import { generateUrlToken, hashVerificationSecret } from "@/lib/account-init";
import { sendPasswordSetupLinkEmail } from "@/lib/notifications";

// Allow headroom for cold-start Mongo + SMTP.
export const maxDuration = 30;

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Admin action: generate a one-hour token + email a "set your own password"
 * link to a user the admin manually created (client or professional). The
 * recipient clicks the link, lands on /reset-password, picks their own
 * password, and from then on can sign in with their own credentials.
 *
 * Stores the SHA-256 hash of the token on User.passwordResetTokenHash so the
 * raw token never persists. The email is wrapped in after() so the response
 * returns immediately while the SMTP send completes on Vercel.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!admin.permissions?.manageUsers) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || id === "undefined" || id.length !== 24) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!user.email) {
      return NextResponse.json(
        { error: "User has no email address on file" },
        { status: 400 },
      );
    }
    // Only allow for accounts the admin can actually manage like this.
    if (!["client", "professional", "guest", "prospect"].includes(user.role)) {
      return NextResponse.json(
        {
          error: "Cannot send password setup link for this role",
          code: "ROLE_NOT_SUPPORTED",
        },
        { status: 400 },
      );
    }

    const token = generateUrlToken();
    user.passwordResetTokenHash = hashVerificationSecret(token);
    user.passwordResetExpires = new Date(Date.now() + ONE_HOUR_MS);
    await user.save();

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";
    const setupLink = `${base}/reset-password?uid=${encodeURIComponent(
      user._id.toString(),
    )}&token=${encodeURIComponent(token)}`;

    const emailArgs = {
      name:
        `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Utilisateur",
      email: user.email,
      setupLink,
      locale: (user.language === "en" ? "en" : "fr") as "fr" | "en",
    };

    after(() =>
      sendPasswordSetupLinkEmail(emailArgs).catch((err) =>
        console.error("sendPasswordSetupLinkEmail failed:", err),
      ),
    );

    return NextResponse.json({
      success: true,
      expiresAt: user.passwordResetExpires?.toISOString(),
    });
  } catch (error) {
    console.error("Send password setup link error:", error);
    return NextResponse.json(
      {
        error: "Failed to send password setup link",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
