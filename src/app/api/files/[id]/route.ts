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

    // `.lean()` returns the raw driver value for `data`: a Node Buffer when the
    // bytes are promoted, but otherwise a BSON `Binary` whose payload lives under
    // `.buffer` (and whose `.length` is a method, so `Buffer.from(binary)` yields
    // an EMPTY buffer — a 200 with no body). Normalize to a real Buffer.
    const raw = file.data as unknown;
    const bytes = Buffer.isBuffer(raw)
      ? raw
      : raw && typeof raw === "object" && "buffer" in raw
        ? Buffer.from((raw as { buffer: Uint8Array }).buffer)
        : Buffer.from(raw as Uint8Array);
    const body = new Uint8Array(bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": file.fileType || "application/octet-stream",
        "Content-Length": String(body.length),
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
