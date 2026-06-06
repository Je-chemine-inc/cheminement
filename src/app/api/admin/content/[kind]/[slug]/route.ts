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
  mediaUrl?: string | null;
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
