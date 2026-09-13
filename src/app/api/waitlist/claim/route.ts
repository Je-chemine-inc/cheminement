import { NextRequest, NextResponse, after } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { claimWaitlistOffer } from "@/lib/waitlist-entries";
import { notifyDirectRequestCreated } from "@/lib/direct-request";
import { WAITLIST_ERROR_MESSAGES } from "@/lib/waitlist-rules";

/**
 * POST /api/waitlist/claim `{ token }` — the person books the time a waitlist
 * offer holds for them (spec 003 phase 4). It becomes a request to the
 * professional, held until they answer, exactly like a time chosen on the page:
 * the professional is emailed, and the person gets the usual confirmation.
 *
 * 410 OFFER_INVALID | OFFER_EXPIRED | OFFER_CLAIMED; 409 OFFER_UNAVAILABLE when
 * the time can no longer be requested (the person keeps their place); 404
 * while the pages are off.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`waitlist-claim:${getClientIp(req)}`, 10, 15 * 60 * 1000).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    const result = await claimWaitlistOffer(body?.token);
    if (!result.ok) {
      return NextResponse.json({ error: WAITLIST_ERROR_MESSAGES[result.code], code: result.code }, { status: result.status });
    }
    const { appointmentId } = result;
    after(() =>
      notifyDirectRequestCreated(appointmentId).catch((error) =>
        console.error("[waitlist] claim emails failed:", appointmentId, error),
      ),
    );
    return NextResponse.json({
      claimed: true,
      professionalName: result.professionalName,
      dayKey: result.dayKey,
      time: result.time,
      respondBy: result.respondBy.toISOString(),
    });
  } catch (error) {
    console.error("[waitlist] claim failed:", error);
    return NextResponse.json({ error: "Failed to book this time" }, { status: 500 });
  }
}
