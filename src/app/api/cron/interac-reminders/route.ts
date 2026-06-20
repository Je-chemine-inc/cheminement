import { NextRequest, NextResponse } from "next/server";
import { runPaymentReminders } from "@/lib/payment-reminders";

/**
 * Post-session invoice dunning cron. Drives the H+12 / H+36 reminders and the
 * H+48 → "overdue" + admin alert for ANY unpaid invoice (card or Interac).
 * Endpoint path kept (`/api/cron/interac-reminders`) so vercel.json + any
 * external pinger stay unchanged; the runner is now method-agnostic. The
 * boolean/state flags make repeated runs (daily Vercel cron + the in-app lazy
 * trigger, or an hourly external pinger) safe.
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPaymentReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("payment-reminders cron:", e);
    return NextResponse.json(
      { error: "Failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
