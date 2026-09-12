import { NextRequest, NextResponse } from "next/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { buildCityRobotsTxt } from "@/lib/showcase-seo";

/**
 * psy<city>.jechemine.ca/robots.txt (the middleware maps it here). Route
 * handlers are not wrapped by the segment's layout, so the city and the
 * switch are checked here too.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cityKey: string }> },
) {
  const { cityKey } = await params;
  if (!findShowcaseCity(cityKey)) {
    return new NextResponse("Not found\n", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  const enabled = await isShowcaseEnabled();
  return new NextResponse(buildCityRobotsTxt(cityKey, enabled), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
