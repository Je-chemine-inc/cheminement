import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";
import StoredFile from "@/models/StoredFile";

/**
 * POST /api/professional/products/uploads (form data: `file`) — an image in a
 * professional's product text or its cover (spec 003 phase 5). PNG, JPEG or
 * WebP by content, 2 MB at most, scanned; never SVG or GIF. Served publicly
 * like the team's content images, so a scan that cannot answer is refused.
 */
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file in form data" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported file type. Allowed: PNG, JPEG, WebP." }, { status: 415 });
  }
  const prepared = await prepareAndScanUpload(file, { allowedTypes: ALLOWED, maxSize: MAX_BYTES });
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
  if (prepared.value.scanStatus === "error") {
    return NextResponse.json({ error: "SCAN_UNAVAILABLE" }, { status: 503 });
  }
  const stored = await StoredFile.create({
    fileName: prepared.value.fileName || "image",
    fileType: file.type,
    fileSize: file.size,
    data: prepared.value.buffer,
    kind: "product-image",
    uploadedBy: gate.userId,
    scanStatus: prepared.value.scanStatus,
  });
  return NextResponse.json({ url: `/api/files/${String(stored._id)}` });
}
