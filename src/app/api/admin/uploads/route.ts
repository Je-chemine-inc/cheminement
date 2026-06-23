import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import StoredFile from "@/models/StoredFile";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";

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

    // Confirm the bytes match the declared image type and scan for malware
    // (content images are served PUBLICLY, so a disguised payload here is the
    // highest-risk upload path).
    const prepared = await prepareAndScanUpload(file, {
      allowedTypes: Object.keys(ALLOWED_MIME),
      maxSize: MAX_BYTES,
    });
    if (!prepared.ok) {
      return NextResponse.json(
        { error: prepared.error },
        { status: prepared.status },
      );
    }

    // Persist in MongoDB (not the filesystem) so uploads work on serverless
    // hosts with a read-only filesystem (Vercel) and survive redeploys. Served
    // publicly via /api/files/[id]. `folder` is kept for backward-compatible
    // bookkeeping only.
    const stored = await StoredFile.create({
      fileName: prepared.value.fileName || `image.${ext}`,
      fileType: file.type,
      fileSize: file.size,
      data: prepared.value.buffer,
      kind: "content-image",
      uploadedBy: session.user.id,
      scanStatus: prepared.value.scanStatus,
    });

    const url = `/api/files/${stored._id.toString()}`;
    return NextResponse.json({
      url,
      filename: file.name || `image.${ext}`,
      size: file.size,
      mime: file.type,
      folder,
    });
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
