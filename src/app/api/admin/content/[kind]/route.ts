import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import ContentEntry, {
  CONTENT_KIND_PUBLIC_BASE,
} from "@/models/ContentEntry";
import {
  isContentKind,
  listContentAdmin,
  slugify,
} from "@/lib/content-entry";
import { isMediaType } from "@/lib/content-kind";
import { canBePremium, validatePriceCents } from "@/lib/content-premium";

async function requireContentAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return { error: "Unauthorized", status: 401 as const };
  }
  await connectToDatabase();
  const admin = await Admin.findOne({
    userId: session.user.id,
    isActive: true,
  });
  if (!admin?.permissions?.manageContent) {
    return { error: "Insufficient permissions", status: 403 as const };
  }
  return { userId: session.user.id };
}

function listingPath(kind: string): string | null {
  if (kind === "problematique") return "/book";
  if (kind === "traitement") return "/approaches";
  if (kind === "nouveaute") return "/nouveautes";
  if (kind === "media") return "/medias";
  // Resources live in the #resources section of /book.
  if (kind === "resource") return "/book";
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { kind } = await params;
    if (!isContentKind(kind)) {
      return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    }
    const items = await listContentAdmin(kind);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("List content error:", error);
    return NextResponse.json(
      {
        error: "Failed to load content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

interface CreateBody {
  slug?: string;
  titleFr: string;
  titleEn: string;
  summaryFr?: string;
  summaryEn?: string;
  iconUrl?: string;
  contentHtmlFr?: string;
  contentHtmlEn?: string;
  mediaType?: string;
  /** Mirrored across locales for kind "media". */
  mediaUrl?: string;
  /** Per-locale, for kind "resource": a FR and an EN video are different assets. */
  mediaUrlFr?: string;
  mediaUrlEn?: string;
  previewHtmlFr?: string;
  previewHtmlEn?: string;
  isPremium?: boolean;
  priceCents?: number;
  status?: "draft" | "published";
  sortOrder?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { kind } = await params;
    if (!isContentKind(kind)) {
      return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    }

    const body = (await req.json()) as CreateBody;
    if (!body.titleFr?.trim() || !body.titleEn?.trim()) {
      return NextResponse.json(
        { error: "titleFr and titleEn are required" },
        { status: 400 },
      );
    }

    const rawSlug = body.slug?.trim() || slugify(body.titleFr);
    const slug = slugify(rawSlug);
    if (!slug) {
      return NextResponse.json(
        { error: "Invalid slug — title must contain letters or digits" },
        { status: 400 },
      );
    }

    const existing = await ContentEntry.findOne({ kind, slug });
    if (existing) {
      return NextResponse.json(
        { error: `Slug already used for this kind: ${slug}` },
        { status: 409 },
      );
    }

    const status = body.status === "published" ? "published" : "draft";
    const now = new Date();
    const sortOrder =
      typeof body.sortOrder === "number" ? body.sortOrder : 100;

    // "media" and "resource" both carry an embeddable video/podcast/link;
    // the other kinds ignore these entirely.
    const supportsMedia = kind === "media" || kind === "resource";
    const mediaType = supportsMedia
      ? isMediaType(body.mediaType)
        ? body.mediaType
        : "article"
      : undefined;

    // Mirrored for "media" (one asset, two languages), per-locale for
    // "resource" (a French course video is not the English one). Falling back
    // to the shared field keeps an older client working.
    const sharedMediaUrl = body.mediaUrl?.trim() || undefined;
    const mediaUrlFr = !supportsMedia
      ? undefined
      : kind === "resource"
        ? body.mediaUrlFr?.trim() || sharedMediaUrl
        : sharedMediaUrl;
    const mediaUrlEn = !supportsMedia
      ? undefined
      : kind === "resource"
        ? body.mediaUrlEn?.trim() || sharedMediaUrl
        : sharedMediaUrl;

    if (body.isPremium === true && !canBePremium(kind)) {
      return NextResponse.json(
        { error: "Only resources can be sold" },
        { status: 400 },
      );
    }
    const isPremium = body.isPremium === true;
    let priceCents = 0;
    if (isPremium) {
      const validated = validatePriceCents(body.priceCents);
      if (validated === null) {
        return NextResponse.json(
          { error: "priceCents must be a whole number of cents above 0" },
          { status: 400 },
        );
      }
      priceCents = validated;
    }

    const common = {
      kind,
      slug,
      iconUrl: body.iconUrl,
      mediaType,
      // isPremium/priceCents are mirrored: the entitlement is keyed on the
      // logical (kind, slug), so the two locale rows must agree or ?locale=en
      // becomes a paywall bypass.
      isPremium,
      priceCents,
      status,
      sortOrder,
      publishedAt: status === "published" ? now : undefined,
      updatedBy: auth.userId,
    };

    await ContentEntry.insertMany([
      {
        ...common,
        locale: "fr",
        title: body.titleFr.trim(),
        summary: (body.summaryFr ?? "").trim(),
        contentHtml: body.contentHtmlFr ?? "",
        previewHtml: body.previewHtmlFr ?? "",
        mediaUrl: mediaUrlFr,
      },
      {
        ...common,
        locale: "en",
        title: body.titleEn.trim(),
        summary: (body.summaryEn ?? "").trim(),
        contentHtml: body.contentHtmlEn ?? "",
        previewHtml: body.previewHtmlEn ?? "",
        mediaUrl: mediaUrlEn,
      },
    ]);

    try {
      const listPath = listingPath(kind);
      if (listPath) revalidatePath(listPath);
      revalidatePath(`${CONTENT_KIND_PUBLIC_BASE[kind]}/${slug}`);
    } catch {}

    return NextResponse.json({ kind, slug }, { status: 201 });
  } catch (error) {
    console.error("Create content error:", error);
    return NextResponse.json(
      {
        error: "Failed to create content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
