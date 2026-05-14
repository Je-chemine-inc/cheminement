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
 * Admin "Valider" action for a professional. Per spec:
 *   - Admin approval triggers the 2FA activation email (email + SMS link).
 *   - The account becomes `active` ONLY after BOTH admin approval AND the pro
 *     completing email + SMS verification.
 * So this endpoint flips `adminApproved: true` and arms the verification flow
 * (bumps `accountSecurityVersion` to 1, generates a fresh email token, sends
 * the verify-account link). The pro's `status` stays `"pending"` until they
 * click the link and finish phone verification — that final transition is
 * handled in `/api/auth/account/verify-phone`.
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

    // If the pro has already completed email + SMS verification (e.g. they
    // went through the secure flow earlier), activate immediately. Otherwise
    // arm the 2FA flow and send the activation link.
    let verificationEmailSent = false;
    if (user.emailVerified && user.phoneVerifiedAt) {
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
        });
        verificationEmailSent = true;
      } catch (err) {
        console.error("Admin approve: 2FA email send failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      status: user.status,
      adminApproved: user.adminApproved,
      professionalLicenseStatus: user.professionalLicenseStatus,
      verificationEmailSent,
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
