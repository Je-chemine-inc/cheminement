import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { sendPaymentGuaranteeDay1Reminder } from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";
import { clientLacksPaymentGuaranteeForAppointment } from "@/lib/client-payment-guarantee";

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

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
    
    const admin = await Admin.findOne({ userId: session.user.id, isActive: true })
      .select("permissions")
      .lean();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const user = await User.findById(id).lean();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // The reminder CTA points at the auth-gated billing dashboard. Non-active
    // users (no password yet) would land on a login screen they cannot pass,
    // so refuse the request rather than send a dead-end email. Admins who
    // want to nudge an unclaimed user should resend the onboarding invite
    // instead — those flows already mint tokenized links per-appointment.
    if (user.status !== "active") {
      return NextResponse.json(
        {
          error:
            "User account is not active; resend the onboarding invitation instead",
        },
        { status: 400 },
      );
    }

    // H11 (LSSSS art. 14): the nudge must reach the booking's recipient — for
    // an adult loved-one booking that's the loved one, NOT the account holder
    // (parent). Mirror the cron path: find the user's guarantee-pending
    // scheduled appointment and resolve the recipient + billing URL from it
    // (which also gives the link the right &lang, fixing H10 for this path).
    const apt = await Appointment.findOne({
      clientId: user._id,
      status: "scheduled",
    }).sort({ awaitingPaymentGuarantee: -1, firstScheduledAt: -1 });

    if (!apt) {
      return NextResponse.json(
        { error: "No scheduled appointment found for this user" },
        { status: 400 },
      );
    }

    // Don't nudge a client who already secured payment for that appointment.
    if (!clientLacksPaymentGuaranteeForAppointment(apt, user)) {
      return NextResponse.json(
        { error: "This appointment already has a payment guarantee" },
        { status: 400 },
      );
    }

    // M14: anti-spam — don't fire another manual nudge within the cooldown
    // window (protects against double-clicks and over-eager re-sends). The
    // timestamp is only stamped after a successful send below, so a failed
    // send can be retried immediately.
    const RESEND_COOLDOWN_MS = 6 * 60 * 60 * 1000;
    if (
      apt.lastGuaranteeReminderSentAt &&
      Date.now() - new Date(apt.lastGuaranteeReminderSentAt).getTime() <
        RESEND_COOLDOWN_MS
    ) {
      return NextResponse.json(
        { error: "A reminder was already sent recently; please try later" },
        { status: 429 },
      );
    }

    const recipient = resolveAppointmentRecipient(
      { bookingFor: apt.bookingFor, lovedOneInfo: apt.lovedOneInfo },
      {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        language: user.language,
      },
    );

    const billingUrl = await resolveBillingUrl({
      userStatus: user.status,
      appointment: apt as Parameters<
        typeof resolveBillingUrl
      >[0]["appointment"],
      base: getBaseUrl(),
      recipientLocale: recipient.language,
    });

    await sendPaymentGuaranteeDay1Reminder({
      clientName: recipient.name,
      clientEmail: recipient.email,
      billingUrl,
      locale: recipient.language === "en" ? "en" : "fr",
    });

    // M14: stamp the cooldown only after a successful send.
    await Appointment.findByIdAndUpdate(apt._id, {
      $set: { lastGuaranteeReminderSentAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin resend guarantee reminder error:", error);
    return NextResponse.json(
      { error: "Failed to resend guarantee reminder", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}
