import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";
import User from "@/models/User";
import {
  EMAIL_VERIFY_TTL_MS,
  generateUrlToken,
  hashVerificationSecret,
} from "@/lib/account-init";
import { sendAccountEmailVerificationEmail } from "@/lib/notifications";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`resend-email:${ip}`, AuthRateLimits.resendEmail.limit, AuthRateLimits.resendEmail.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = await req.json();
    const email = (body.email as string | undefined)?.toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ error: "Courriel requis" }, { status: 400 });
    }

    await connectToDatabase();
    const user = await User.findOne({ email });
    if (!user || (user.accountSecurityVersion ?? 0) < 1) {
      return NextResponse.json({ ok: true });
    }

    if (user.emailVerified && user.phoneVerifiedAt) {
      return NextResponse.json({ ok: true });
    }

    if (user.emailVerified) {
      return NextResponse.json({
        ok: true,
        message: "Courriel déjà confirmé. Connectez-vous ou poursuivez l’étape SMS.",
      });
    }

    const token = generateUrlToken();
    user.verificationEmailTokenHash = hashVerificationSecret(token);
    user.verificationEmailExpires = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
    await user.save();

    const base = process.env.NEXTAUTH_URL || "";
    const verifyUrl = `${base}/verify-account?uid=${encodeURIComponent(user._id.toString())}&token=${encodeURIComponent(token)}`;

    void sendAccountEmailVerificationEmail({
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      verifyUrl,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("resend-email:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
