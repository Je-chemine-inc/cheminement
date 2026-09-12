import { NextRequest, NextResponse } from "next/server";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { listShowcaseSitemapPages } from "@/lib/showcase-queries";
import { buildSitemapXml, type SitemapEntry } from "@/lib/showcase-seo";
import { isShowcaseEnabled } from "@/lib/showcase-settings";

/**
 * psy<city>.jechemine.ca/sitemap.xml (the middleware maps it here).
 *
 * Lists this host's own URLs only — a sitemap may not vouch for another host.
 * Nothing while the pages are off; otherwise the city page and each published
 * professional's page, once at least one professional is presented here (an
 * empty city page is not worth indexing).
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

  const pages = (await isShowcaseEnabled()) ? await listShowcaseSitemapPages(cityKey) : [];
  const entries: SitemapEntry[] = [];
  if (pages.length > 0) {
    const latest = pages.reduce<Date | null>(
      (max, page) => (page.lastModified && (!max || page.lastModified > max) ? page.lastModified : max),
      null,
    );
    entries.push({ url: absoluteShowcaseUrl(cityKey, "/"), lastModified: latest, changeFrequency: "weekly", priority: 1 });
    for (const page of pages) {
      entries.push({
        url: absoluteShowcaseUrl(cityKey, `/${page.slug}`),
        lastModified: page.lastModified,
        changeFrequency: "monthly",
        priority: 0.8,
      });
    }
  }

  return new NextResponse(buildSitemapXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
