import { NextRequest, NextResponse, after } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";
import { generateUrlToken, hashVerificationSecret } from "@/lib/account-init";
import { sendPasswordSetupLinkEmail } from "@/lib/notifications";

// Cold-start Mongo + SMTP headroom.
export const maxDuration = 30;

const ONE_HOUR_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Roles that can actually log in (and thus reset a password). Passwordless
// lead shells (guest/prospect) are ignored.
const RESETTABLE_ROLES = ["client", "professional", "admin", "employee"];

/**
 * POST /api/auth/forgot-password — user-initiated password reset.
 *
 * Issues a 1-hour token, stores its SHA-256 hash on User.passwordResetTokenHash,
 * and emails a /reset-password link (consumed by /api/auth/account/set-password).
 * ALWAYS returns { ok: true } so the response can't be used to enumerate which
 * emails are registered. Rate-limited per IP.
 *
 * (Previously the /forgot-password page was a stub that faked success and never
 * called any endpoint — no reset email was ever sent, for any role.)
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(
    `pwreset:${ip}`,
    AuthRateLimits.passwordReset.limit,
    AuthRateLimits.passwordReset.windowMs,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  try {
    const { email } = (await req.json().catch(() => ({}))) as { email?: string };
    const normalized =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalized || !EMAIL_RE.test(normalized)) {
      return NextResponse.json({ ok: true });
    }

    await connectToDatabase();
    const user = await User.findOne({ email: normalized });

    // Only issue a link for a real, login-capable account. Either way the
    // response is identical (no account-existence leak).
    if (user?.email && RESETTABLE_ROLES.includes(user.role)) {
      const token = generateUrlToken();
      user.passwordResetTokenHash = hashVerificationSecret(token);
      user.passwordResetExpires = new Date(Date.now() + ONE_HOUR_MS);
      await user.save();

      const base =
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        new URL(req.url).origin;
      const setupLink = `${base}/reset-password?uid=${encodeURIComponent(
        user._id.toString(),
      )}&token=${encodeURIComponent(token)}`;

      const emailArgs = {
        name:
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
          "Utilisateur",
        email: user.email,
        setupLink,
        locale: (user.language === "en" ? "en" : "fr") as "fr" | "en",
        variant: "reset" as const,
      };
      // after() keeps the serverless function alive until the SMTP send finishes.
      after(() =>
        sendPasswordSetupLinkEmail(emailArgs).catch((err) =>
          console.error("[forgot-password] reset email failed:", err),
        ),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    // Still return ok to avoid leaking internal state / account existence.
    return NextResponse.json({ ok: true });
  }
}
