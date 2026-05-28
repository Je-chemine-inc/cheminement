import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ClientDocument from "@/models/ClientDocument";
import StoredFile from "@/models/StoredFile";

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

    await connectToDatabase();

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await StoredFile.create({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      data: buffer,
      kind: "client-document",
      uploadedBy: session.user.id,
    });

    const doc = await ClientDocument.create({
      clientId: session.user.id,
      name: file.name,
      fileUrl: `/api/files/${stored._id.toString()}`,
      fileType: file.type,
      fileSize: file.size,
      sharedBy: "client",
      sharedByUserId: session.user.id,
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
