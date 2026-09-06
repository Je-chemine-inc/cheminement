import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import ContentEntry, {
  CONTENT_KIND_PUBLIC_BASE,
} from "@/models/ContentEntry";
import { getContentPair, isContentKind } from "@/lib/content-entry";
import { isMediaType } from "@/lib/content-kind";
import { canBePremium, validatePriceCents } from "@/lib/content-premium";
import ResourceEntitlement from "@/models/ResourceEntitlement";

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
  { params }: { params: Promise<{ kind: string; slug: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { kind, slug } = await params;
    if (!isContentKind(kind)) {
      return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    }
    const pair = await getContentPair(kind, slug);
    if (!pair) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(pair);
  } catch (error) {
    console.error("Get content error:", error);
    return NextResponse.json(
      {
        error: "Failed to load content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

interface UpdateBody {
  titleFr?: string;
  titleEn?: string;
  summaryFr?: string;
  summaryEn?: string;
  iconUrl?: string | null;
  contentHtmlFr?: string;
  contentHtmlEn?: string;
  mediaType?: string;
  /** Mirrored across locales for kind "media". */
  mediaUrl?: string | null;
  /** Per-locale, for kind "resource": a FR and an EN video are different assets. */
  mediaUrlFr?: string | null;
  mediaUrlEn?: string | null;
  previewHtmlFr?: string;
  previewHtmlEn?: string;
  isPremium?: boolean;
  priceCents?: number;
  /** Required to change the price of something people have already bought. */
  confirmPriceChange?: boolean;
  status?: "draft" | "published";
  sortOrder?: number;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; slug: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { kind, slug } = await params;
    if (!isContentKind(kind)) {
      return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    }

    const docs = await ContentEntry.find({ kind, slug });
    if (docs.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const frDoc = docs.find((d) => d.locale === "fr");
    const enDoc = docs.find((d) => d.locale === "en");
    if (!frDoc || !enDoc) {
      return NextResponse.json(
        { error: "Incomplete locale pair — contact support" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as UpdateBody;

    if (typeof body.titleFr === "string" && body.titleFr.trim())
      frDoc.title = body.titleFr.trim();
    if (typeof body.titleEn === "string" && body.titleEn.trim())
      enDoc.title = body.titleEn.trim();
    if (typeof body.summaryFr === "string")
      frDoc.summary = body.summaryFr.trim();
    if (typeof body.summaryEn === "string")
      enDoc.summary = body.summaryEn.trim();
    if (typeof body.contentHtmlFr === "string")
      frDoc.contentHtml = body.contentHtmlFr;
    if (typeof body.contentHtmlEn === "string")
      enDoc.contentHtml = body.contentHtmlEn;

    if (body.iconUrl !== undefined) {
      const value =
        body.iconUrl === null || body.iconUrl === "" ? undefined : body.iconUrl;
      frDoc.iconUrl = value;
      enDoc.iconUrl = value;
    }

    if (kind === "media") {
      if (isMediaType(body.mediaType)) {
        frDoc.mediaType = body.mediaType;
        enDoc.mediaType = body.mediaType;
      }
      if (body.mediaUrl !== undefined) {
        const value =
          body.mediaUrl === null || body.mediaUrl.trim() === ""
            ? undefined
            : body.mediaUrl.trim();
        frDoc.mediaUrl = value;
        enDoc.mediaUrl = value;
      }
    }

    if (kind === "resource") {
      if (isMediaType(body.mediaType)) {
        // Mirrored: a resource is a video in both languages or in neither.
        frDoc.mediaType = body.mediaType;
        enDoc.mediaType = body.mediaType;
      }
      // Per-locale, unlike "media": the French and English assets differ.
      const norm = (v: string | null | undefined) =>
        v === null || v === undefined || v.trim() === "" ? undefined : v.trim();
      if (body.mediaUrlFr !== undefined) frDoc.mediaUrl = norm(body.mediaUrlFr);
      if (body.mediaUrlEn !== undefined) enDoc.mediaUrl = norm(body.mediaUrlEn);
      if (typeof body.previewHtmlFr === "string")
        frDoc.previewHtml = body.previewHtmlFr;
      if (typeof body.previewHtmlEn === "string")
        enDoc.previewHtml = body.previewHtmlEn;
    }

    // Access and price. Mirrored across both locale rows — see the model note.
    if (body.isPremium !== undefined || body.priceCents !== undefined) {
      if (body.isPremium === true && !canBePremium(kind)) {
        return NextResponse.json(
          { error: "Only resources can be sold" },
          { status: 400 },
        );
      }

      const nextIsPremium =
        body.isPremium === undefined ? frDoc.isPremium === true : body.isPremium === true;

      let nextPriceCents = 0;
      if (nextIsPremium) {
        const raw =
          body.priceCents === undefined ? frDoc.priceCents : body.priceCents;
        const validated = validatePriceCents(raw);
        if (validated === null) {
          return NextResponse.json(
            { error: "priceCents must be a whole number of cents above 0" },
            { status: 400 },
          );
        }
        nextPriceCents = validated;
      }

      const changed =
        nextIsPremium !== (frDoc.isPremium === true) ||
        nextPriceCents !== (frDoc.priceCents ?? 0);

      if (changed && !body.confirmPriceChange) {
        // Existing buyers keep what they paid — the entitlement snapshots its
        // own amount — but the admin should not discover that by accident.
        const paid = await ResourceEntitlement.countDocuments({
          slug,
          status: "paid",
        });
        if (paid > 0) {
          return NextResponse.json(
            { error: "RESOURCE_HAS_PURCHASES", paid },
            { status: 409 },
          );
        }
      }

      frDoc.isPremium = nextIsPremium;
      enDoc.isPremium = nextIsPremium;
      frDoc.priceCents = nextPriceCents;
      enDoc.priceCents = nextPriceCents;

      // A premium entry with no teaser would show a price above a blank page.
      // Fall back to the summary rather than refusing to publish.
      if (nextIsPremium) {
        if (!frDoc.previewHtml?.trim() && frDoc.summary?.trim()) {
          frDoc.previewHtml = `<p>${frDoc.summary.trim()}</p>`;
        }
        if (!enDoc.previewHtml?.trim() && enDoc.summary?.trim()) {
          enDoc.previewHtml = `<p>${enDoc.summary.trim()}</p>`;
        }
      }
    }

    if (typeof body.sortOrder === "number") {
      frDoc.sortOrder = body.sortOrder;
      enDoc.sortOrder = body.sortOrder;
    }

    if (body.status === "draft" || body.status === "published") {
      const now = new Date();
      const wasPublished = frDoc.status === "published";
      frDoc.status = body.status;
      enDoc.status = body.status;
      if (body.status === "published" && !wasPublished) {
        frDoc.publishedAt = now;
        enDoc.publishedAt = now;
      }
    }

    const updatedById = new mongoose.Types.ObjectId(auth.userId);
    frDoc.updatedBy = updatedById;
    enDoc.updatedBy = updatedById;

    await Promise.all([frDoc.save(), enDoc.save()]);

    try {
      const listPath = listingPath(kind);
      if (listPath) revalidatePath(listPath);
      revalidatePath(`${CONTENT_KIND_PUBLIC_BASE[kind]}/${slug}`);
    } catch {}

    const pair = await getContentPair(kind, slug);
    return NextResponse.json(pair);
  } catch (error) {
    console.error("Update content error:", error);
    return NextResponse.json(
      {
        error: "Failed to save content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ kind: string; slug: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { kind, slug } = await params;
    if (!isContentKind(kind)) {
      return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
    }
    // Never delete something people have paid to read. Unpublishing keeps the
    // buyers' access intact; deleting would strand it.
    if (kind === "resource") {
      const paid = await ResourceEntitlement.countDocuments({
        slug,
        status: "paid",
      });
      if (paid > 0) {
        return NextResponse.json(
          {
            error: "RESOURCE_HAS_PURCHASES",
            paid,
            hint: "Unpublish this resource instead of deleting it.",
          },
          { status: 409 },
        );
      }
    }

    const result = await ContentEntry.deleteMany({ kind, slug });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const listPath = listingPath(kind);
      if (listPath) revalidatePath(listPath);
      revalidatePath(`${CONTENT_KIND_PUBLIC_BASE[kind]}/${slug}`);
    } catch {}

    return NextResponse.json({ deleted: result.deletedCount });
  } catch (error) {
    console.error("Delete content error:", error);
    return NextResponse.json(
      {
        error: "Failed to delete content",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
