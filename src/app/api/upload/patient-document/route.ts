import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import StoredFile from "@/models/StoredFile";
import ClientDocument from "@/models/ClientDocument";
import Appointment from "@/models/Appointment";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
];

/**
 * POST /api/upload/patient-document
 *
 * Professional uploads a document FOR one of their patients. Form fields:
 *   - file:     PDF/JPEG/PNG, ≤10MB
 *   - clientId: ObjectId of the patient (required)
 *
 * Bytes are persisted to MongoDB (`StoredFile`) and a `ClientDocument`
 * record links the file to the patient with `sharedBy: "professional"`.
 * Returns the ClientDocument document (with `fileUrl: /api/files/<id>`).
 *
 * Authorization: the requester must be a professional who has at least one
 * appointment with this client. Admins can upload for anyone.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientId = (formData.get("clientId") as string | null)?.trim();

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      return NextResponse.json(
        { error: "Missing or invalid clientId" },
        { status: 400 },
      );
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

    if (session.user.role === "professional") {
      const hasRelationship = await Appointment.exists({
        professionalId: session.user.id,
        clientId,
      });
      if (!hasRelationship) {
        return NextResponse.json(
          { error: "Forbidden: you have no appointment with this client" },
          { status: 403 },
        );
      }
    } else if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const stored = await StoredFile.create({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      data: buffer,
      kind: "patient-document",
      uploadedBy: session.user.id,
    });

    const doc = await ClientDocument.create({
      clientId,
      name: file.name,
      fileUrl: `/api/files/${stored._id.toString()}`,
      fileType: file.type,
      fileSize: file.size,
      sharedBy: "professional",
      sharedByUserId: session.user.id,
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    console.error("Patient document upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
