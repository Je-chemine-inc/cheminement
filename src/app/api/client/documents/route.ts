import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ClientDocument from "@/models/ClientDocument";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
];

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const docs = await ClientDocument.find({ clientId: session.user.id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return NextResponse.json(docs);
  } catch (e) {
    console.error("GET /api/client/documents:", e);
    return NextResponse.json(
      { error: "Failed to list documents" },
      { status: 500 },
    );
  }
}

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
        { error: "File size exceeds 10 MB limit." },
        { status: 400 },
      );
    }

    const ext = file.name.split(".").pop() || "bin";
    const uniqueFilename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
    const uploadsDir = path.join(
      process.cwd(),
      "public",
      "uploads",
      "client-documents",
    );
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(
      path.join(uploadsDir, uniqueFilename),
      Buffer.from(await file.arrayBuffer()),
    );

    const fileUrl = `/uploads/client-documents/${uniqueFilename}`;

    await connectToDatabase();

    const doc = await ClientDocument.create({
      clientId: session.user.id,
      name: file.name,
      fileUrl,
      fileType: file.type,
      fileSize: file.size,
      sharedBy: "client",
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (e) {
    console.error("POST /api/client/documents:", e);
    return NextResponse.json(
      { error: "Failed to upload document" },
      { status: 500 },
    );
  }
}
