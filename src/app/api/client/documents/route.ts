import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ClientDocument from "@/models/ClientDocument";

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

// Client-initiated uploads are disabled for safety (malware risk). Documents are
// shared with a client only by their professional or the platform through
// dedicated, vetted endpoints — never uploaded by the client directly.
export async function POST() {
  return NextResponse.json(
    { error: "Clients are not allowed to upload documents." },
    { status: 403 },
  );
}
