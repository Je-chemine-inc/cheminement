import { NextRequest, NextResponse, after } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { joinWaitlist } from "@/lib/waitlist-entries";
import { WAITLIST_ERROR_MESSAGES, parseWaitlistJoin } from "@/lib/waitlist-rules";
import { sendWaitlistJoinedEmail } from "@/lib/notifications";
import { afterSlotFreed } from "@/lib/waitlist-slot-freed";

/**
 * POST /api/showcase/<slug>/waitlist — join a professional's waitlist from
 * their page (spec 003 phase 4). Consent to the current text is required; a
 * text message needs its own consent and a phone number.
 *
 * `{ joined: true }` whether the address was already on the list or not, so
 * the form never reveals who waits. 404 while the pages are off or the page
 * is not published; 409 WAITLIST_FULL at 50 people; 429 past 5 attempts in 15
 * minutes from one address, or 3 a day for one email.
 */
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isShowcaseEnabled())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!rateLimit(`waitlist-join:${ip}`, 5, 15 * 60 * 1000).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED", code: "RATE_LIMITED" }, { status: 429 });
  }

  const { slug } = await params;
  const parsed = parseWaitlistJoin(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json(
      { error: WAITLIST_ERROR_MESSAGES.INVALID_WAITLIST_REQUEST, code: "INVALID_WAITLIST_REQUEST", field: parsed.field },
      { status: 400 },
    );
  }
  const form = parsed.value;
  if (!rateLimit(`waitlist-join-email:${form.email}`, 3, DAY_MS).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED", code: "RATE_LIMITED" }, { status: 429 });
  }

  try {
    const result = await joinWaitlist({ slug, form, ip });
    if (!result.ok) {
      return NextResponse.json({ error: WAITLIST_ERROR_MESSAGES[result.code], code: result.code }, { status: result.status });
    }
    if (result.created) {
      after(() =>
        sendWaitlistJoinedEmail({
          firstName: form.firstName,
          email: form.email,
          professionalName: result.professionalName,
          service: form.service,
          sms: form.smsConsent,
          pageUrl: result.pageUrl,
          leaveUrl: result.leaveUrl,
          locale: form.locale,
        }).catch((error) => console.error("[waitlist] joined email failed:", error)),
      );
      // A time that suits them may already be free.
      after(() => afterSlotFreed(result.professionalId));
    }
    return NextResponse.json({ joined: true });
  } catch (error) {
    console.error("[waitlist] join failed:", error);
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 500 });
  }
}
