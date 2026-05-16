import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";

const ALLOWED_FOLDERS = new Set(["content", "problematiques", "misc"]);
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });
    if (!admin?.permissions?.manageContent) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const folderRaw = (form.get("folder") as string | null) ?? "content";
    const folder = ALLOWED_FOLDERS.has(folderRaw) ? folderRaw : "content";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file in form data" },
        { status: 400 },
      );
    }

    const ext = ALLOWED_MIME[file.type];
    if (!ext) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type}. Allowed: PNG, JPEG, WebP, GIF, SVG.`,
        },
        { status: 415 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).` },
        { status: 413 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = `${randomUUID()}.${ext}`;
    const targetDir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, filename), bytes);

    const url = `/uploads/${folder}/${filename}`;
    return NextResponse.json({ url, filename, size: file.size, mime: file.type });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      {
        error: "Upload failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
