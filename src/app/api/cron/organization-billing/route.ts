import { NextRequest, NextResponse } from "next/server";
import { runOrganizationBilling } from "@/lib/organization-billing-run";

/**
 * Organization billing pass (spec 002): statement and per-session drafts, the
 * organizations' opt-in auto-send, the team's review email, overdue marking.
 * Hourly from /etc/cron.d/jechemine; every step is safe to repeat, and the run
 * does nothing while the organization-billing switch is off.
 *
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
    const result = await runOrganizationBilling();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("organization-billing cron:", e);
    return NextResponse.json(
      { error: "Failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
