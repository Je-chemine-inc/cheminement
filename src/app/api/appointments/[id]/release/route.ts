import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { sendAdminAppointmentMovedToGeneralAlert } from "@/lib/notifications";

/**
 * POST /api/appointments/[id]/release
 *
 * Escape hatch: a professional who ACCEPTED a client (matched) but hasn't yet
 * confirmed the first appointment can release the request back to the general
 * pool — e.g. they realize they can't take it after talking to the client.
 * Only valid in the matched state (status "pending" + routingStatus "accepted").
 * Once a date is scheduled, the normal cancel/reschedule flow applies instead.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const appointment = await Appointment.findById(id).populate(
      "clientId",
      "firstName lastName email language",
    );
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (appointment.professionalId?.toString() !== session.user.id) {
      return NextResponse.json(
        { error: "You are not assigned to this request" },
        { status: 403 },
      );
    }
    if (
      appointment.status !== "pending" ||
      appointment.routingStatus !== "accepted"
    ) {
      return NextResponse.json(
        {
          error:
            "Only a matched request without a confirmed date can be released",
        },
        { status: 400 },
      );
    }

    // Back to the general pool: unset the pro, add them to refusedBy so they
    // aren't re-shown the same request, and reset the schedule-reminder flag so
    // the next pro who picks it up gets a fresh reminder window.
    await Appointment.findByIdAndUpdate(id, {
      $set: { routingStatus: "general", firstRdvReminderSent: false },
      $unset: { professionalId: "", proposedTo: "", proposedAt: "" },
      $addToSet: { refusedBy: session.user.id },
    });

    // Alert admins so a released match doesn't sit unwatched in the general queue.
    const clientPop = appointment.clientId as unknown as {
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
    } | null;
    const clientName =
      `${clientPop?.firstName ?? ""} ${clientPop?.lastName ?? ""}`.trim() ||
      "Client";
    after(() =>
      sendAdminAppointmentMovedToGeneralAlert({
        clientName,
        clientEmail: clientPop?.email?.trim() || "—",
        motif: appointment.issueType,
        appointmentId: String(appointment._id),
        refusalCount: (appointment.refusedBy?.length ?? 0) + 1,
      }).catch((err) =>
        console.error("[release] moved-to-general alert error:", err),
      ),
    );

    // §3.1: the client is NOT emailed when a pro steps back. The release stays
    // silent to the client (admins are alerted above) to avoid the confusing
    // "your match changed / cancelled" message. The client's next email is the
    // jumelage confirmation once a NEW pro accepts.

    return NextResponse.json({ id: String(appointment._id), released: true });
  } catch (error) {
    console.error("Release appointment error:", error);
    return NextResponse.json(
      {
        error: "Failed to release appointment",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
