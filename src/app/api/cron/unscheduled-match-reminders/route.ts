import { NextRequest, NextResponse } from "next/server";
import { runUnscheduledMatchReminders } from "@/lib/unscheduled-match-reminders";

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
    return NextResponse.json({ ok: true, ...result });
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
