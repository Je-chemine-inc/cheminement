import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";
import { attachProductFile } from "@/lib/products";

/**
 * POST /api/professional/products/<slug>/file (form data: `file`, `locale`) —
 * the PDF a professional sells (spec 003 phase 5). PDF by content, 10 MB at
 * most, scanned; refused when the antivirus cannot answer, since the file goes
 * to buyers. Stored privately: only GET /api/products/<slug>/file serves it.
 */
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const locale = form?.get("locale") === "en" ? "en" : "fr";
  if (!(file instanceof File)) return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });

  const prepared = await prepareAndScanUpload(file, { allowedTypes: ["application/pdf"], maxSize: MAX_BYTES });
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });
  if (prepared.value.scanStatus === "error") {
    return NextResponse.json({ error: "SCAN_UNAVAILABLE" }, { status: 503 });
  }

  const result = await attachProductFile({
    professionalId: gate.userId,
    slug,
    locale,
    file: {
      buffer: prepared.value.buffer,
      fileName: prepared.value.fileName || "document.pdf",
      fileType: "application/pdf",
      fileSize: file.size,
      scanStatus: prepared.value.scanStatus,
    },
  });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
  return NextResponse.json({ attached: true, locale });
}
