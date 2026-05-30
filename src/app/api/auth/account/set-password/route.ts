import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import {
  hashVerificationSecret,
  timingSafeEqualHex,
} from "@/lib/account-init";

export const maxDuration = 30;

/**
 * Public endpoint reached from the email link sent by either
 * /api/admin/users/[id]/send-password-setup-link (admin-created accounts) or
 * /api/auth/forgot-password (user-initiated reset, variant="reset").
 *
 * Body: { uid, token, password }
 *
 * Verifies the token against the stored hash (timing-safe), hashes the new
 * password with bcrypt, clears the token + expiry so the link cannot be
 * reused, marks the account as email-verified (the admin already trusted
 * this address — successful link click proves ownership), and stamps the
 * account active if it was pending without missing prerequisites.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const uid = typeof body?.uid === "string" ? body.uid.trim() : "";
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const password =
      typeof body?.password === "string" ? body.password : "";

    if (!uid || uid.length !== 24 || !token) {
      return NextResponse.json(
        { error: "Invalid or missing token" },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    await connectToDatabase();
    const user = await User.findById(uid);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 400 },
      );
    }
    if (!user.passwordResetTokenHash || !user.passwordResetExpires) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 400 },
      );
    }
    if (user.passwordResetExpires.getTime() < Date.now()) {
      // Clear the stale token so a stale stored hash can't be brute-forced
      // later if the secret somehow leaks.
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpires = undefined;
      await user.save();
      return NextResponse.json(
        { error: "Link has expired. Ask the administrator to resend it." },
        { status: 400 },
      );
    }
    const incomingHash = hashVerificationSecret(token);
    if (!timingSafeEqualHex(incomingHash, user.passwordResetTokenHash)) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 400 },
      );
    }

    user.password = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    // Clicking the email proves the address belongs to the user — admin had
    // already trusted it, so it's safe to mark verified here too.
    if (!user.emailVerified) {
      user.emailVerified = new Date();
    }
    // If the admin-created account was still pending only because of email
    // verification, activate it now that the user has set their own password.
    // (We don't override an explicit "inactive" status.)
    if (user.status === "pending" && user.phoneVerifiedAt) {
      user.status = "active";
    }
    await user.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Set-password error:", error);
    return NextResponse.json(
      {
        error: "Failed to set password",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
