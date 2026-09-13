import { NextRequest, NextResponse, after } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { leaveWaitlist } from "@/lib/waitlist-entries";
import { afterSlotFreed } from "@/lib/waitlist-slot-freed";

/**
 * POST /api/waitlist/leave `{ token }` — the person leaves a waitlist through
 * the link in their email (spec 003 phase 4). No session: the link is the
 * proof. Works even while the pages are off — leaving is always possible.
 * 410 for a link already used or unknown.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`waitlist-leave:${getClientIp(req)}`, 10, 15 * 60 * 1000).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    const result = await leaveWaitlist(body?.token);
    if (!result.ok) {
      return NextResponse.json({ error: "This link is no longer valid", code: "LINK_INVALID" }, { status: 410 });
    }
    if (result.freedTime) after(() => afterSlotFreed(result.professionalId));
    return NextResponse.json({ left: true });
  } catch (error) {
    console.error("[waitlist] leave failed:", error);
    return NextResponse.json({ error: "Failed to leave the waitlist" }, { status: 500 });
  }
}
