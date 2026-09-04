import { NextRequest, NextResponse } from "next/server";
import { runInteracReconciliation } from "@/lib/interac-reconciler";

/**
 * Match Interac e-Transfer notifications to invoices and settle exact matches.
 *
 * The on-box IMAP fetcher (`scripts/inbound-email-sync.mjs`, every 5 min via
 * /etc/cron.d/jechemine) already stores mail from `paiement@jechemine.ca` as
 * inbound ExternalMessages. This reads the ones from @payments.interac.ca.
 *
 * Safe to run as often as the fetcher: each notification is processed at most
 * once (marked on the message itself), and only an exact amount match against a
 * named, unsettled session is ever settled — everything else is left for a
 * human with the reason recorded.
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
    const result = await runInteracReconciliation();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("interac-reconciliation cron:", e);
    return NextResponse.json(
      { error: "Failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
