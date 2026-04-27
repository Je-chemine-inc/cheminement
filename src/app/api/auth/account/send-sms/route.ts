import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";
import {
  SMS_CODE_TTL_MS,
  generateSmsCode,
  hashVerificationSecret,
} from "@/lib/account-init";
import { sendSmsOtp } from "@/lib/sms";

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
  const rl = rateLimit(`send-sms:${ip}`, AuthRateLimits.sendSms.limit, AuthRateLimits.sendSms.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many SMS requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const body = await req.json();
    const userId = body.userId as string | undefined;
    const phoneStepToken = body.phoneStepToken as string | undefined;
    if (!userId || !phoneStepToken) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    await connectToDatabase();
    const user = await User.findById(userId);
    if (!user || (user.accountSecurityVersion ?? 0) < 1) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!user.emailVerified) {
      return NextResponse.json(
        { error: "Confirm email first" },
        { status: 400 },
      );
    }

    if (!user.phoneStepTokenHash || !user.phoneStepTokenExpires) {
      return NextResponse.json(
        { error: "Verification session expired" },
        { status: 400 },
      );
    }

    if (user.phoneStepTokenExpires.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Phone step expired" },
        { status: 400 },
      );
    }

    const expected = hashVerificationSecret(phoneStepToken);
    if (!safeEqualHex(expected, user.phoneStepTokenHash)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const rawPhone = (user.phone || "").trim();
    if (!rawPhone) {
      return NextResponse.json({ error: "No phone on file" }, { status: 400 });
    }

    const code = generateSmsCode();
    user.verificationSmsCodeHash = hashVerificationSecret(code);
    user.verificationSmsExpires = new Date(Date.now() + SMS_CODE_TTL_MS);
    user.verificationSmsAttempts = 0;
    await user.save();

    try {
      await sendSmsOtp(rawPhone, code, (user.language as "fr" | "en") || "fr");
    } catch (smsErr) {
      console.error("send-sms Twilio:", smsErr);
      return NextResponse.json(
        {
          error: "SMS send failed. Configure Twilio or use dev mode.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, smsTtlMs: SMS_CODE_TTL_MS });
  } catch (e) {
    console.error("send-sms:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
