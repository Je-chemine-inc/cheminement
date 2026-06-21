import { NextRequest, NextResponse } from "next/server";
import { runUnscheduledMatchReminders } from "@/lib/unscheduled-match-reminders";
import { runEmergencyTakeChargeSlaAlerts } from "@/lib/emergency-sla";

/**
 * Daily cron. Call with header: Authorization: Bearer <CRON_SECRET>.
 * Reminds professionals who accepted a client (matched) but haven't confirmed
 * the first appointment date after a few days. Dedupes via firstRdvReminderSent.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runUnscheduledMatchReminders();
    // Piggyback the urgent 12h-take-charge soft-SLA nudges on this daily run:
    // urgent matches the pro accepted but never scheduled within 12h get a soft
    // reminder to the pro + an alert to admins (request stays assigned).
    const emergencyTakeCharge = await runEmergencyTakeChargeSlaAlerts();
    return NextResponse.json({
      ok: true,
      ...result,
      emergencyTakeChargeAlerts: emergencyTakeCharge.alerted,
    });
  } catch (e: unknown) {
    console.error("unscheduled-match-reminders cron:", e);
    return NextResponse.json(
      {
        error: "Failed",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
