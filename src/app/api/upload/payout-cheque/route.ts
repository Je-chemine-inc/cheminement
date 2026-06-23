import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import StoredFile from "@/models/StoredFile";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Spec: a void cheque / specimen as PDF, PNG or JPG.
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

/**
 * A professional uploads their direct-deposit void cheque (specimen). Stored
 * privately in StoredFile and served (auth-gated) via /api/files/[id]. The
 * returned URL is saved on the Profile (payoutChequeUrl) so an admin can view
 * it when processing the manual payout.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const prepared = await prepareAndScanUpload(file, {
      allowedTypes: ALLOWED_TYPES,
      maxSize: MAX_FILE_SIZE,
    });
    if (!prepared.ok) {
      return NextResponse.json(
        { error: prepared.error },
        { status: prepared.status },
      );
    }

    const stored = await StoredFile.create({
      fileName: prepared.value.fileName,
      fileType: file.type,
      fileSize: file.size,
      data: prepared.value.buffer,
      kind: "payout-cheque",
      uploadedBy: session.user.id,
      scanStatus: prepared.value.scanStatus,
    });

    return NextResponse.json({
      success: true,
      url: `/api/files/${stored._id.toString()}`,
      fileName: prepared.value.fileName,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error("Payout cheque upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
