import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { readWaitlistOffer } from "@/lib/waitlist-entries";
import { WAITLIST_ERROR_MESSAGES } from "@/lib/waitlist-rules";

/**
 * GET /api/waitlist/offers/<token> — what a waitlist offer link shows: the
 * professional, the time, until when it is held (spec 003 phase 4). Reading
 * changes nothing. 410 OFFER_INVALID | OFFER_EXPIRED | OFFER_CLAIMED; 404
 * while the pages are off.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!(await isShowcaseEnabled())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!rateLimit(`waitlist-offer:${getClientIp(req)}`, 30, 60 * 1000).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  try {
    const { token } = await params;
    const result = await readWaitlistOffer(token);
    if (!result.ok) {
      return NextResponse.json(
        { error: WAITLIST_ERROR_MESSAGES[result.code], code: result.code },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ offer: result.offer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[waitlist] offer could not be read:", error);
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 500 });
  }
}
