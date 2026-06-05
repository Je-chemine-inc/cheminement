import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import LegalDocument from "@/models/LegalDocument";

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

function pathForKey(key: string): string | null {
  if (key === "terms") return "/terms";
  if (key === "privacy") return "/privacy";
  if (key === "professionalTerms") return "/professional-terms";
  if (key === "cookies") return "/cookies";
  // The emergency/consultation-rapide conditions render inline on /emergency.
  if (key === "emergencyConditions") return "/emergency";
  return null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(locale: string): string {
  const d = new Date();
  if (locale === "fr") {
    return d.toLocaleDateString("fr-CA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const doc = await LegalDocument.findById(id);
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: doc._id.toString(),
      documentKey: doc.documentKey,
      locale: doc.locale,
      title: doc.title,
      subtitle: doc.subtitle,
      lastUpdated: doc.lastUpdated,
      version: doc.version,
      contentHtml: doc.contentHtml,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    console.error("Get legal document error:", error);
    return NextResponse.json(
      { error: "Failed to load document" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireContentAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();
    const { title, subtitle, contentHtml, bumpVersion } = body as {
      title?: string;
      subtitle?: string;
      contentHtml?: string;
      bumpVersion?: boolean;
    };

    const doc = await LegalDocument.findById(id);
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (typeof title === "string" && title.trim()) {
      doc.title = title.trim();
    }
    if (typeof subtitle === "string") {
      doc.subtitle = subtitle.trim() || undefined;
    }
    if (typeof contentHtml === "string") {
      doc.contentHtml = contentHtml;
    }

    // Always bump lastUpdated + version on save (auto-track changes)
    doc.lastUpdated = formatDisplayDate(doc.locale);
    if (bumpVersion !== false) {
      doc.version = todayIsoDate();
    }

    doc.updatedBy = new mongoose.Types.ObjectId(auth.userId);
    await doc.save();

    // Revalidate the public page + the root layout so footers everywhere pick up the new title
    const path = pathForKey(doc.documentKey);
    try {
      if (path) revalidatePath(path);
      revalidatePath("/", "layout");
    } catch (err) {
      console.warn("revalidatePath failed:", err);
    }

    return NextResponse.json({
      id: doc._id.toString(),
      documentKey: doc.documentKey,
      locale: doc.locale,
      title: doc.title,
      subtitle: doc.subtitle,
      lastUpdated: doc.lastUpdated,
      version: doc.version,
      contentHtml: doc.contentHtml,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    console.error("Update legal document error:", error);
    return NextResponse.json(
      { error: "Failed to save document" },
      { status: 500 },
    );
  }
}
