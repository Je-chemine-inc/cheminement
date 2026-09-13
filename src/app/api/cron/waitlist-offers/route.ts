import { NextRequest, NextResponse } from "next/server";
import { runWaitlistOffers } from "@/lib/waitlist-offers";

/**
 * Scheduled from /etc/cron.d/jechemine on the WHC VPS every two minutes, with
 * `Authorization: Bearer <CRON_SECRET>` (spec 003 phase 4). Expires direct
 * requests past their deadline and waitlist offers past their 15 minutes,
 * ends places after three misses or 90 days, purges old closed entries, and —
 * while the pages are on — offers freed times to the people waiting.
 * Idempotent: every step is an atomic claim.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runWaitlistOffers();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("waitlist-offers cron:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
