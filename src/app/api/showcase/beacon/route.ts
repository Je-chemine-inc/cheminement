import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import ShowcasePage from "@/models/ShowcasePage";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { recordShowcaseEvent } from "@/lib/showcase-stats";

/**
 * POST /api/showcase/beacon — anonymous visit counts of the showcase pages
 * (spec 003), sent with navigator.sendBeacon: `{ event: "view" | "cta", city,
 * slug? }`. With a slug it counts a professional's page, without one the
 * city's own pages. Nothing identifies the visitor (no cookie, no stored IP).
 *
 * Answers 204 whatever happens to the count — bots, rate limit, an unknown
 * page, a failing store — so a page never waits on it; 400 only for a
 * malformed request, 404 while the pages are off.
 */
const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|node-fetch|axios/i;
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function POST(req: NextRequest) {
  if (!(await isShowcaseEnabled())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as {
    event?: unknown;
    city?: unknown;
    slug?: unknown;
  } | null;
  const event = body?.event;
  const city = body?.city;
  const slug = body?.slug;
  if (
    (event !== "view" && event !== "cta") ||
    typeof city !== "string" ||
    !isShowcaseCityKey(city) ||
    (slug !== undefined && (typeof slug !== "string" || !SLUG_FORMAT.test(slug)))
  ) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  const done = new NextResponse(null, { status: 204 });
  if (BOT_USER_AGENT.test(req.headers.get("user-agent") ?? "")) return done;
  if (!rateLimit(`showcase-beacon:${getClientIp(req)}`, 60, 60 * 1000).allowed) return done;

  try {
    if (typeof slug === "string") {
      await connectToDatabase();
      const page = await ShowcasePage.findOne({ slug, cityKey: city, status: "published" })
        .select("_id")
        .lean();
      if (page) await recordShowcaseEvent({ scope: "page", key: String(page._id), event });
    } else {
      await recordShowcaseEvent({ scope: "city", key: city, event });
    }
  } catch (error) {
    console.error("[showcase] visit not counted:", error);
  }
  return done;
}
