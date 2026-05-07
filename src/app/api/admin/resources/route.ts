import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import { Resource } from "@/models/Resource";

const VALID_TYPES = ["ebook", "video", "course", "worksheet", "guide", "tool"] as const;

async function requireContentAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  await connectToDatabase();
  const permissions = await getActiveAdminPermissions(session.user.id);
  if (!permissions?.manageContent) {
    return {
      error: NextResponse.json(
        { error: "Forbidden - missing permission: manageContent" },
        { status: 403 },
      ),
    };
  }
  return { session };
}

function serialize(doc: {
  _id: unknown;
  title: string;
  description: string;
  type: string;
  category: string;
  price: number;
  currency: string;
  fileUrl?: string;
  contentUrl?: string;
  previewUrl?: string;
  tags?: string[];
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: String(doc._id),
    title: doc.title,
    description: doc.description,
    type: doc.type,
    category: doc.category,
    price: doc.price,
    currency: doc.currency,
    fileUrl: doc.fileUrl ?? "",
    contentUrl: doc.contentUrl ?? "",
    previewUrl: doc.previewUrl ?? "",
    tags: doc.tags ?? [],
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function GET() {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const docs = await Resource.find({})
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({ resources: docs.map(serialize) });
  } catch (error) {
    console.error("Admin list resources error:", error);
    return NextResponse.json(
      { error: "Failed to load resources" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const type = VALID_TYPES.includes(body?.type) ? body.type : null;
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const price = Number.isFinite(body?.price) ? Number(body.price) : NaN;
    const currency = typeof body?.currency === "string" && body.currency.trim()
      ? body.currency.trim()
      : "CAD";
    const fileUrl = typeof body?.fileUrl === "string" ? body.fileUrl.trim() : "";
    const contentUrl = typeof body?.contentUrl === "string" ? body.contentUrl.trim() : "";
    const previewUrl = typeof body?.previewUrl === "string" ? body.previewUrl.trim() : "";
    const tags = normalizeTags(body?.tags);
    const isActive = body?.isActive !== false;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (!type) {
      return NextResponse.json({ error: "type is required and must be valid" }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "category is required" }, { status: 400 });
    }
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
    }

    const created = await Resource.create({
      title,
      description,
      type,
      category,
      price,
      currency,
      fileUrl: fileUrl || undefined,
      contentUrl: contentUrl || undefined,
      previewUrl: previewUrl || undefined,
      tags,
      isActive,
      createdBy: auth.session!.user.id,
    });

    return NextResponse.json({ resource: serialize(created) }, { status: 201 });
  } catch (error) {
    console.error("Admin create resource error:", error);
    return NextResponse.json(
      { error: "Failed to create resource" },
      { status: 500 },
    );
  }
}
