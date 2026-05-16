import { NextRequest, NextResponse } from "next/server";
import {
  isContentKind,
  listPublishedContent,
} from "@/lib/content-entry";
import type { ContentLocale } from "@/models/ContentEntry";

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

    const items = await listPublishedContent(kind, locale);

    // Trim contentHtml for listing — clients pull full content via the detail page.
    const slim = items.map((item) => ({
      id: item.id,
      kind: item.kind,
      slug: item.slug,
      locale: item.locale,
      title: item.title,
      summary: item.summary,
      iconUrl: item.iconUrl,
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
