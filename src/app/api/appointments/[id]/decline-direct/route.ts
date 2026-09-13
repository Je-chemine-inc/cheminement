import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { notifyDirectRequestReleased, releaseDirectRequest } from "@/lib/direct-request";
import { afterSlotFreed } from "@/lib/waitlist-slot-freed";
import {
  DIRECT_REQUEST_DECLINE_NOTE_MAX,
  isDirectRequestDeclineReason,
} from "@/lib/direct-request-rules";

/**
 * POST /api/appointments/[id]/decline-direct — the professional declines a
 * request a client made for one of their slots (spec 003 phase 3).
 * `{ reason: slot_unavailable | not_a_fit | not_accepting | other, note? }`.
 *
 * The slot is freed and the request returns to the admin queue; the client is
 * emailed another time or Je chemine's matching, never the reason. The note is
 * for the team only.
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
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as { reason?: unknown; note?: unknown } | null;
    if (!isDirectRequestDeclineReason(body?.reason)) {
      return NextResponse.json({ error: "A reason is required", code: "INVALID_REASON" }, { status: 400 });
    }
    const note = body?.note;
    if (note !== undefined && note !== null && (typeof note !== "string" || note.length > DIRECT_REQUEST_DECLINE_NOTE_MAX)) {
      return NextResponse.json({ error: "The note is too long", code: "INVALID_NOTE" }, { status: 400 });
    }

    const released = await releaseDirectRequest({
      appointmentId: id,
      outcome: "declined",
      professionalId: session.user.id,
      reason: body.reason,
      note: typeof note === "string" ? note : undefined,
    });

    if (!released) {
      await connectToDatabase();
      const mine = await Appointment.exists({ _id: id, "directRequest.professionalId": session.user.id });
      return mine
        ? NextResponse.json(
            { error: "This request is no longer waiting for an answer", code: "DIRECT_REQUEST_CLOSED" },
            { status: 409 },
          )
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    after(() =>
      notifyDirectRequestReleased(id, released.rerouteToken).catch((error) =>
        console.error("[decline-direct] emails failed:", error),
      ),
    );
    // The freed time goes to the professional's waitlist (phase 4).
    const professionalId = session.user.id;
    after(() => afterSlotFreed(professionalId));
    return NextResponse.json({ id, state: "declined" });
  } catch (error) {
    console.error("decline-direct error:", error);
    return NextResponse.json({ error: "Failed to decline the request" }, { status: 500 });
  }
}
