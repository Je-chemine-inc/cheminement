import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import StoredFile from "@/models/StoredFile";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";

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
 * Used by the appointment booking form when a referral letter (PDF/image) is
 * attached. The returned URL is stored on the Appointment via the standard
 * booking flow. The booking form is PUBLIC (guests can book before they have an
 * account), so a session is optional here; we rate-limit by IP and keep the
 * strict type/size checks to prevent open-relay abuse. The stored file is only
 * served (via /api/files/[id]) to authenticated admins/professionals.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`referral-upload:${ip}`, 15, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        },
      );
    }
    const session = await getServerSession(authOptions);

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

    await connectToDatabase();
    const stored = await StoredFile.create({
      fileName: prepared.value.fileName,
      fileType: file.type,
      fileSize: file.size,
      data: prepared.value.buffer,
      kind: "referral",
      uploadedBy: session?.user?.id,
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
    console.error("Referral upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
