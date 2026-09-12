import { NextRequest, NextResponse } from "next/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { buildSitemapXml, type SitemapEntry } from "@/lib/showcase-seo";

/**
 * psy<city>.jechemine.ca/sitemap.xml (the middleware maps it here).
 *
 * Lists this host's own URLs only — a sitemap may not vouch for another host.
 * A page is listed once it is worth indexing: a city page once a professional
 * is presented there, a professional's page once published. No showcase page
 * can be published yet (spec 003 phase 1 adds them), so the list is empty.
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
  const entries: SitemapEntry[] = [];
  return new NextResponse(buildSitemapXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
