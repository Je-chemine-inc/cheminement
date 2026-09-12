import { NextRequest, NextResponse } from "next/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { loadShowcaseCatalog, loadShowcaseDirectory } from "@/lib/showcase-queries";
import { buildSitemapXml, citySitemapEntries, type SitemapEntry } from "@/lib/showcase-seo";
import { isShowcaseEnabled } from "@/lib/showcase-settings";

/**
 * psy<city>.jechemine.ca/sitemap.xml (the middleware maps it here).
 *
 * Lists this host's own URLs only — a sitemap may not vouch for another host.
 * Nothing while the pages are off; otherwise, once at least one professional
 * is presented here, the city page, each professional's page and each
 * expertise page with a professional (an empty city page is not indexed).
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

  let entries: SitemapEntry[] = [];
  if (await isShowcaseEnabled()) {
    const [directory, catalog] = await Promise.all([loadShowcaseDirectory(), loadShowcaseCatalog()]);
    entries = citySitemapEntries(cityKey, directory, catalog);
  }

  return new NextResponse(buildSitemapXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
