import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import StoredFile from "@/models/StoredFile";

/**
 * GET /api/files/[id]
 *
 * Streams a binary file persisted in MongoDB. Authentication required.
 * Access control is intentionally coarse here: any signed-in user may fetch
 * any file. Documents are referenced by hard-to-guess ObjectIds, and access
 * gating happens at the consumer-facing endpoints (e.g. /api/clients/[id]
 * /documents only returns IDs the caller is allowed to see). If we ever
 * surface file IDs to unauthenticated contexts, tighten this to check the
 * file's `kind` + the requester's role.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await connectToDatabase();
    const file = await StoredFile.findById(id).lean();
    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Content images are referenced from PUBLIC pages (nouveautés, problématiques,
    // etc.), so they must be served without a session. Every other kind stays
    // behind authentication.
    const isPublic = file.kind === "content-image";
    if (!isPublic) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Mongoose `Buffer` types come back as Node Buffers under .data
    const bytes = file.data instanceof Buffer ? file.data : Buffer.from(file.data);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": file.fileType || "application/octet-stream",
        "Content-Length": String(file.fileSize ?? bytes.length),
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
        "Cache-Control": isPublic
          ? "public, max-age=86400, immutable"
          : "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("GET /api/files/[id]:", error);
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 },
    );
  }
}
