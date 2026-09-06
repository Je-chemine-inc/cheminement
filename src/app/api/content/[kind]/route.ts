import { NextRequest, NextResponse } from "next/server";
import {
  isContentKind,
  listPublishedContent,
  type PremiumFilter,
} from "@/lib/content-entry";
import type { ContentLocale } from "@/models/ContentEntry";

function premiumFilter(value: string | null): PremiumFilter {
  return value === "only" || value === "exclude" ? value : "all";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const { kind } = await params;
    if (!isContentKind(kind)) {
      return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const localeRaw = searchParams.get("locale");
    const locale: ContentLocale = localeRaw === "en" ? "en" : "fr";

    const items = await listPublishedContent(kind, locale, {
      premium: premiumFilter(searchParams.get("premium")),
    });

    // An explicit allowlist, never a spread of the DTO. contentHtml, mediaUrl
    // and previewHtml are all absent by construction: for a premium resource
    // the first two ARE the paid good, and adding a field here would leak it to
    // an unauthenticated caller. Clients read full content via /book/[slug],
    // which checks entitlement.
    const slim = items.map((item) => ({
      id: item.id,
      kind: item.kind,
      slug: item.slug,
      locale: item.locale,
      title: item.title,
      summary: item.summary,
      iconUrl: item.iconUrl,
      mediaType: item.mediaType,
      isPremium: item.isPremium,
      priceCents: item.priceCents,
      status: item.status,
      sortOrder: item.sortOrder,
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
    }));
    return NextResponse.json({ items: slim });
  } catch (error) {
    console.error("Public list content error:", error);
    return NextResponse.json(
      {
        error: "Failed to load content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
