import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ClientDocument from "@/models/ClientDocument";
import Appointment from "@/models/Appointment";

/**
 * GET /api/clients/[id]/documents
 *
 * Lists every document attached to a given client, regardless of who shared
 * it (client themselves, professional, platform). Used by the professional
 * portal's patient profile modal to show the patient's document history.
 *
 * Authorization: the requester must be:
 *   - the client themselves, or
 *   - a professional who has at least one appointment with this client, or
 *   - an admin.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id: clientId } = await params;
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await connectToDatabase();

    if (session.user.role === "professional") {
      const hasRelationship = await Appointment.exists({
        professionalId: session.user.id,
        clientId,
      });
      if (!hasRelationship) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (
      session.user.role !== "admin" &&
      session.user.id !== clientId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const docs = await ClientDocument.find({ clientId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return NextResponse.json(docs);
  } catch (error) {
    console.error("GET /api/clients/[id]/documents:", error);
    return NextResponse.json(
      { error: "Failed to list documents" },
      { status: 500 },
    );
  }
}
