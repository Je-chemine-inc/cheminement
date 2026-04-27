import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";
import {
  EMAIL_VERIFY_TTL_MS,
  PHONE_STEP_TTL_MS,
  generatePhoneStepToken,
  hashVerificationSecret,
} from "@/lib/account-init";

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`verify-email:${ip}`, AuthRateLimits.verifyEmail.limit, AuthRateLimits.verifyEmail.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = await req.json();
    const userId = body.userId as string | undefined;
    const token = body.token as string | undefined;
    if (!userId || !token) {
      return NextResponse.json(
        { error: "userId et token requis" },
        { status: 400 },
      );
    }

    await connectToDatabase();
    const user = await User.findById(userId);
    if (!user || (user.accountSecurityVersion ?? 0) < 1) {
      return NextResponse.json({ error: "Non trouvé" }, { status: 404 });
    }

    if (!user.verificationEmailTokenHash || !user.verificationEmailExpires) {
      return NextResponse.json(
        { error: "Lien invalide ou déjà utilisé" },
        { status: 400 },
      );
    }

    if (user.verificationEmailExpires.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Ce lien a expiré (15 min). Demandez un nouveau courriel." },
        { status: 400 },
      );
    }

    const expected = hashVerificationSecret(token);
    if (!safeEqualHex(expected, user.verificationEmailTokenHash)) {
      return NextResponse.json({ error: "Lien invalide" }, { status: 400 });
    }

    user.emailVerified = new Date();
    user.verificationEmailTokenHash = undefined;
    user.verificationEmailExpires = undefined;

    const phoneStepToken = generatePhoneStepToken();
    user.phoneStepTokenHash = hashVerificationSecret(phoneStepToken);
    user.phoneStepTokenExpires = new Date(Date.now() + PHONE_STEP_TTL_MS);
    user.verificationSmsCodeHash = undefined;
    user.verificationSmsExpires = undefined;
    user.verificationSmsAttempts = 0;

    await user.save();

    const phone = user.phone || "";
    const masked =
      phone.length >= 4
        ? `${phone.slice(0, Math.min(3, phone.length - 2))}…${phone.slice(-2)}`
        : "•••";

    return NextResponse.json({
      ok: true,
      phoneStepToken,
      phoneMasked: masked,
      emailVerifyTtlMs: EMAIL_VERIFY_TTL_MS,
      phoneStepTtlMs: PHONE_STEP_TTL_MS,
    });
  } catch (e) {
    console.error("verify-email:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
