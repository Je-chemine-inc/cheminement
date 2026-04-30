import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { SMS_MAX_ATTEMPTS, hashVerificationSecret } from "@/lib/account-init";
import { sendWelcomeEmail } from "@/lib/notifications";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";

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
  const rl = rateLimit(`verify-phone:${ip}`, AuthRateLimits.verifyPhone.limit, AuthRateLimits.verifyPhone.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = await req.json();
    const userId = body.userId as string | undefined;
    const phoneStepToken = body.phoneStepToken as string | undefined;
    const code = body.code as string | undefined;
    if (!userId || !phoneStepToken || !code) {
      return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    }

    const normalized = String(code).replace(/\D/g, "").slice(0, 6);
    if (normalized.length !== 6) {
      return NextResponse.json({ error: "Code à 6 chiffres requis" }, { status: 400 });
    }

    await connectToDatabase();
    const user = await User.findById(userId);
    if (!user || (user.accountSecurityVersion ?? 0) < 1) {
      return NextResponse.json({ error: "Non trouvé" }, { status: 404 });
    }

    if (!user.phoneStepTokenHash || !user.phoneStepTokenExpires) {
      return NextResponse.json({ error: "Session expirée" }, { status: 400 });
    }

    if (user.phoneStepTokenExpires.getTime() < Date.now()) {
      return NextResponse.json({ error: "Session expirée" }, { status: 400 });
    }

    const stepExpected = hashVerificationSecret(phoneStepToken);
    if (!safeEqualHex(stepExpected, user.phoneStepTokenHash)) {
      return NextResponse.json({ error: "Jeton invalide" }, { status: 400 });
    }

    if (!user.verificationSmsCodeHash || !user.verificationSmsExpires) {
      return NextResponse.json(
        { error: "Demandez d’abord un code SMS" },
        { status: 400 },
      );
    }

    if (user.verificationSmsExpires.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Code expiré. Demandez un nouveau SMS." },
        { status: 400 },
      );
    }

    const attempts = user.verificationSmsAttempts ?? 0;
    if (attempts >= SMS_MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Trop de tentatives. Reprenez depuis le courriel." },
        { status: 429 },
      );
    }

    user.verificationSmsAttempts = attempts + 1;

    const codeHash = hashVerificationSecret(normalized);
    if (!safeEqualHex(codeHash, user.verificationSmsCodeHash)) {
      await user.save();
      return NextResponse.json({ error: "Code incorrect" }, { status: 400 });
    }

    user.phoneVerifiedAt = new Date();
    user.status = "active";
    user.phoneStepTokenHash = undefined;
    user.phoneStepTokenExpires = undefined;
    user.verificationSmsCodeHash = undefined;
    user.verificationSmsExpires = undefined;
    user.verificationSmsAttempts = 0;
    await user.save();

    sendWelcomeEmail({
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role as "client" | "professional" | "guest" | "prospect",
    }).catch((err) => console.error("welcome after verify email:", err));

    if (user.phone) {
      const { sendWelcomeSms } = await import("@/lib/sms");
      sendWelcomeSms(
        user.phone,
        user.firstName,
        (user.language as "fr" | "en") || "fr",
      ).catch((err) => console.error("welcome after verify sms:", err));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("verify-phone:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
