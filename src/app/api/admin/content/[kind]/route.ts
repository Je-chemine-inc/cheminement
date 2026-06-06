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
  mediaUrl?: string;
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

    // Media-only fields; ignored for the other kinds.
    const mediaType =
      kind === "media" && isMediaType(body.mediaType)
        ? body.mediaType
        : kind === "media"
          ? "article"
          : undefined;
    const mediaUrl =
      kind === "media" ? body.mediaUrl?.trim() || undefined : undefined;

    const common = {
      kind,
      slug,
      iconUrl: body.iconUrl,
      mediaType,
      mediaUrl,
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
      },
      {
        ...common,
        locale: "en",
        title: body.titleEn.trim(),
        summary: (body.summaryEn ?? "").trim(),
        contentHtml: body.contentHtmlEn ?? "",
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
