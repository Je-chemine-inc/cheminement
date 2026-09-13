import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { findPublishedShowcase } from "@/lib/showcase-queries";
import type { ShowcaseBookingSummary } from "@/lib/showcase-booking-types";

/**
 * GET /api/showcase/<slug>/summary — what the booking funnel on www shows about
 * the professional a visitor came from (spec 003 phase 3): name, title, photo,
 * city, and the consultations offered with their length and price.
 *
 * Taken from the public profile, so it can carry nothing the page itself does
 * not show. 404 while the pages are off and for a page that is not published.
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isShowcaseEnabled())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!rateLimit(`showcase-summary:${getClientIp(req)}`, 60, 60 * 1000).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const { slug } = await params;
  try {
    // The funnel names the title in its own language; the text fields are not sent.
    const result = await findPublishedShowcase(slug, "fr");
    if (result.kind !== "found") {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    const { profile } = result;
    const summary: ShowcaseBookingSummary = {
      slug: profile.slug,
      url: profile.url,
      displayName: profile.displayName,
      title: profile.title,
      photoUrl: profile.photoUrl,
      city: { key: profile.city.key, name: profile.city.name },
      services: profile.services,
    };
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[showcase] summary could not be read:", error);
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 500 });
  }
}
