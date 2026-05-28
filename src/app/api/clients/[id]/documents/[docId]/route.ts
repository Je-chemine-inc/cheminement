import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ClientDocument from "@/models/ClientDocument";
import StoredFile from "@/models/StoredFile";
import Appointment from "@/models/Appointment";

/**
 * DELETE /api/clients/[id]/documents/[docId]
 *
 * Removes a ClientDocument link and (best-effort) its backing StoredFile.
 * Authorization: only the uploader or the client themselves or an admin.
 * Professionals can delete docs they shared even if they no longer have an
 * appointment with the client (they uploaded it, they may retract it).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id: clientId, docId } = await params;
    if (
      !mongoose.Types.ObjectId.isValid(clientId) ||
      !mongoose.Types.ObjectId.isValid(docId)
    ) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await connectToDatabase();

    const doc = await ClientDocument.findOne({ _id: docId, clientId });
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isUploader = doc.sharedByUserId?.toString() === session.user.id;
    const isOwnerClient =
      doc.clientId.toString() === session.user.id &&
      (session.user.role === "client" ||
        session.user.role === "guest" ||
        session.user.role === "prospect");
    const isAdmin = session.user.role === "admin";
    let isPro = false;
    if (!isUploader && !isOwnerClient && !isAdmin && session.user.role === "professional") {
      isPro = Boolean(
        await Appointment.exists({
          professionalId: session.user.id,
          clientId,
        }),
      );
    }
    if (!isUploader && !isOwnerClient && !isAdmin && !isPro) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Best-effort: also drop the StoredFile bytes when the fileUrl points to one.
    const match = doc.fileUrl?.match(/^\/api\/files\/([a-f0-9]{24})$/i);
    if (match) {
      await StoredFile.findByIdAndDelete(match[1]).catch(() => undefined);
    }

    await ClientDocument.deleteOne({ _id: doc._id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/clients/[id]/documents/[docId]:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 },
    );
  }
}
