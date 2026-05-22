import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import {
  EMAIL_VERIFY_TTL_MS,
  generateUrlToken,
  hashVerificationSecret,
} from "@/lib/account-init";
import { sendAccountEmailVerificationEmail } from "@/lib/notifications";

// SMTP send can be slow on cold start; give the route headroom.
export const maxDuration = 30;

/**
 * Admin "Valider" action for a professional. Two modes:
 *
 * 1. Default (`skipEmail` false / omitted) — Admin approval arms the 2FA flow:
 *    bumps `accountSecurityVersion`, generates a fresh email token, sends the
 *    verify-account link. Status stays `"pending"` until the pro completes
 *    email + SMS verification (final transition happens in verify-phone).
 *    If the pro is *already* email + SMS verified, status flips to "active"
 *    immediately and no email is sent.
 *
 * 2. Manual activation (`skipEmail: true`) — Admin activates the account
 *    fully without sending any email/SMS. Pre-fills emailVerified +
 *    phoneVerifiedAt if missing, sets status="active". Use case: admin has
 *    already shared credentials with the pro out-of-band, or is fixing a
 *    half-validated account created via the "Ajouter un profil" form.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();

    if (adminRecord?.permissions && !adminRecord.permissions.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || id === "undefined" || id.length !== 24) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    let skipEmail = false;
    try {
      const body = await req.json();
      skipEmail = body?.skipEmail === true;
    } catch {
      // No body — default to email flow.
    }

    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.role !== "professional") {
      return NextResponse.json(
        { error: "User is not a professional" },
        { status: 400 },
      );
    }

    user.adminApproved = true;
    user.professionalLicenseStatus = "verified";

    let verificationEmailSent = false;

    if (skipEmail) {
      // Manual activation: stamp any missing verification timestamps and flip
      // status to "active". Do NOT touch accountSecurityVersion — leaving it
      // alone preserves any existing session the pro may already have.
      const now = new Date();
      if (!user.emailVerified) user.emailVerified = now;
      if (!user.phoneVerifiedAt) user.phoneVerifiedAt = now;
      // Clear any in-flight verification tokens so a stale link can't be reused.
      user.verificationEmailTokenHash = undefined;
      user.verificationEmailExpires = undefined;
      user.phoneStepTokenHash = undefined;
      user.phoneStepTokenExpires = undefined;
      user.verificationSmsCodeHash = undefined;
      user.verificationSmsExpires = undefined;
      user.verificationSmsAttempts = 0;
      user.status = "active";
      await user.save();
    } else if (user.emailVerified && user.phoneVerifiedAt) {
      // Already fully verified — activate immediately, no email needed.
      user.status = "active";
      await user.save();
    } else {
      user.accountSecurityVersion = 1;
      // Clear any stale verification state so the new link is the source of truth.
      user.phoneVerifiedAt = undefined;
      user.emailVerified = undefined;
      user.phoneStepTokenHash = undefined;
      user.phoneStepTokenExpires = undefined;
      user.verificationSmsCodeHash = undefined;
      user.verificationSmsExpires = undefined;
      user.verificationSmsAttempts = 0;

      const token = generateUrlToken();
      user.verificationEmailTokenHash = hashVerificationSecret(token);
      user.verificationEmailExpires = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
      await user.save();

      const base =
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        new URL(req.url).origin;
      const verifyUrl = `${base}/verify-account?uid=${encodeURIComponent(
        user._id.toString(),
      )}&token=${encodeURIComponent(token)}`;
      try {
        await sendAccountEmailVerificationEmail({
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          verifyUrl,
          locale: user.language === "en" ? "en" : "fr",
          // Admin-approved pros: one-click activation, no SMS step.
          singleFactor: true,
        });
        verificationEmailSent = true;
      } catch (err) {
        console.error("Admin approve: activation email send failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      status: user.status,
      adminApproved: user.adminApproved,
      professionalLicenseStatus: user.professionalLicenseStatus,
      verificationEmailSent,
      skipEmail,
    });
  } catch (error) {
    console.error("Admin validate professional error:", error);
    return NextResponse.json(
      {
        error: "Failed to validate professional",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
