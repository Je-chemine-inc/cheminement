import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import StoredFile from "@/models/StoredFile";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
];

/**
 * POST /api/upload/referral
 *
 * Used by the appointment booking form when a referring professional attaches
 * a referral letter (PDF/image). The returned URL is stored on the Appointment
 * via the standard booking flow. Authenticated to prevent open-relay abuse —
 * the booking pages already require a session.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only PDF, JPEG, and PNG are allowed." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 10MB limit" },
        { status: 400 },
      );
    }

    await connectToDatabase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await StoredFile.create({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      data: buffer,
      kind: "referral",
      uploadedBy: session.user.id,
    });

    return NextResponse.json({
      success: true,
      url: `/api/files/${stored._id.toString()}`,
      fileName: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error("Referral upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
