import { NextRequest, NextResponse, after } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { triggerDueWaitlistOffers } from "@/lib/lazy-cron";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { listShowcaseSlots, loadBookableShowcase } from "@/lib/showcase-booking";
import { isDirectRequestService } from "@/lib/direct-request-rules";
import { isDayKey } from "@/lib/available-slots";

/**
 * GET /api/showcase/<slug>/slots?service=standard|quick&from=YYYY-MM-DD — a
 * professional's free times on their public page (spec 003 phase 3).
 *
 * Days, times, length and price only: never the professional's id, rate or
 * working hours. 404 while the pages are off and for a page that is not
 * published; 429 past 60 requests a minute from one address.
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isShowcaseEnabled())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!rateLimit(`showcase-slots:${getClientIp(req)}`, 60, 60 * 1000).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  // Keeps waitlist offers and request deadlines moving if the VPS cron stops (phase 4).
  after(() => triggerDueWaitlistOffers());

  const { slug } = await params;
  const service = req.nextUrl.searchParams.get("service") ?? "standard";
  const from = req.nextUrl.searchParams.get("from");
  if (!isDirectRequestService(service) || (from !== null && !isDayKey(from))) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  try {
    const bookable = await loadBookableShowcase(slug);
    if (!bookable) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const body = await listShowcaseSlots(bookable, service, from);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[showcase] slots could not be listed:", error);
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 500 });
  }
}
