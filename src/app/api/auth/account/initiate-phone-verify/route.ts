import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";
import {
  PHONE_STEP_TTL_MS,
  generatePhoneStepToken,
  hashVerificationSecret,
} from "@/lib/account-init";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(req);
  const rl = rateLimit(`initiate-phone:${ip}`, AuthRateLimits.sendSms.limit, AuthRateLimits.sendSms.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    await connectToDatabase();
    const user = await User.findById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.phoneVerifiedAt) {
      return NextResponse.json({ alreadyVerified: true });
    }

    if (!user.phone) {
      return NextResponse.json({ error: "No phone number on file" }, { status: 400 });
    }

    // Read phone before save — pre-save hook re-encrypts it
    const phone = user.phone;

    const phoneStepToken = generatePhoneStepToken();
    user.phoneStepTokenHash = hashVerificationSecret(phoneStepToken);
    user.phoneStepTokenExpires = new Date(Date.now() + PHONE_STEP_TTL_MS);
    user.verificationSmsAttempts = 0;
    await user.save();

    const masked =
      phone.length >= 4
        ? `${phone.slice(0, Math.min(3, phone.length - 2))}…${phone.slice(-2)}`
        : "•••";

    return NextResponse.json({
      userId: user._id.toString(),
      phoneStepToken,
      phoneMasked: masked,
    });
  } catch (e) {
    console.error("initiate-phone-verify:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
