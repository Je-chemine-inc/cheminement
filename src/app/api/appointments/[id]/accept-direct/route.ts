import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { findSlotCollision, slotCollisionError } from "@/lib/slot-occupancy";
import { releaseSlotHold } from "@/lib/slot-holds";
import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";
import {
  queueFirstAppointmentConfirmation,
  resolveFirstAppointmentLocation,
} from "@/lib/first-appointment-confirmation";

/**
 * POST /api/appointments/[id]/accept-direct — the professional confirms a
 * request a client made for one of their slots on their showcase page (spec 003
 * phase 3). `{ type?, location?, saveAsDefaultOffice? }`.
 *
 * Accepting and scheduling happen in ONE atomic claim: the slot is already
 * chosen, so the request becomes a scheduled first appointment at once, priced
 * at the professional's rate (their quick rate for a quick consultation). The
 * hold is freed, a guest gets their account as on /accept, and the client
 * receives the same first-appointment confirmation with the payment invitation
 * as from schedule-first. No jumelage email: nothing was matched.
 *
 * 404 for anyone but the professional asked; 409 when the request is no longer
 * pending, past its deadline, or its time now collides with a session.
 */

const CLIENT_FIELDS = "firstName lastName email language role status";
const TYPES = ["video", "in-person", "phone", "both"] as const;
type AppointmentType = (typeof TYPES)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const professionalId = session.user.id;

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as {
      type?: string;
      location?: string;
      saveAsDefaultOffice?: boolean;
    };

    await connectToDatabase();
    const appointment = await Appointment.findById(id).populate("clientId", CLIENT_FIELDS);
    const request = appointment?.directRequest;
    if (!appointment || !request || String(request.professionalId) !== professionalId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    if (request.state !== "pending" || appointment.status !== "pending" || appointment.professionalId) {
      return NextResponse.json(
        { error: "This request is no longer waiting for an answer", code: "DIRECT_REQUEST_CLOSED" },
        { status: 409 },
      );
    }
    if (new Date(request.respondBy).getTime() <= now.getTime()) {
      return NextResponse.json(
        { error: "The time to answer this request has passed", code: "DIRECT_REQUEST_EXPIRED" },
        { status: 409 },
      );
    }

    const collision = await findSlotCollision({
      professionalId,
      dayKey: request.dayKey,
      time: request.time,
      durationMinutes: appointment.duration,
      now,
      exceptAppointmentId: id,
    });
    if (collision) {
      return NextResponse.json(slotCollisionError(collision), { status: 409 });
    }

    const type: AppointmentType = (TYPES as readonly string[]).includes(body.type ?? "")
      ? (body.type as AppointmentType)
      : appointment.type;
    let location: string | undefined;
    if (type === "in-person") {
      const resolved = await resolveFirstAppointmentLocation({
        professionalId,
        typed: body.location,
        current: appointment.location,
        saveAsDefaultOffice: body.saveAsDefaultOffice,
        logPrefix: "[accept-direct]",
      });
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              "An address is required for an in-person session. Add your office address, or enter the address for this appointment.",
            code: "OFFICE_ADDRESS_REQUIRED",
          },
          { status: 400 },
        );
      }
      location = resolved;
    }

    const pricing = await calculateAppointmentPricing(professionalId, appointment.therapyType, {
      quick: request.service === "quick",
    });

    const accepted = await Appointment.findOneAndUpdate(
      {
        _id: id,
        status: "pending",
        professionalId: null,
        routingStatus: "proposed",
        "directRequest.state": "pending",
        "directRequest.professionalId": request.professionalId,
        "directRequest.respondBy": { $gt: now },
      },
      {
        $set: {
          professionalId,
          routingStatus: "accepted",
          matchedAt: now,
          takeChargeSlaAlertSent: false,
          status: "scheduled",
          firstScheduledAt: now,
          awaitingPaymentGuarantee: true,
          type,
          ...(location ? { location } : {}),
          "payment.price": pricing.sessionPrice,
          "payment.platformFee": pricing.platformFee,
          "payment.professionalPayout": pricing.professionalPayout,
          "directRequest.state": "accepted",
          "directRequest.answeredAt": now,
        },
        $unset: { proposedTo: "", proposedAt: "" },
      },
      { new: true },
    ).populate("clientId", CLIENT_FIELDS);

    if (!accepted) {
      // A withdrawal or the deadline won the race.
      return NextResponse.json(
        { error: "This request is no longer waiting for an answer", code: "DIRECT_REQUEST_CLOSED" },
        { status: 409 },
      );
    }

    if (request.holdId) {
      await releaseSlotHold(String(request.holdId), { appointmentId: id }).catch((error) =>
        console.error("[accept-direct] hold not released:", error),
      );
    }

    // A guest or prospect gets the account the confirmation email lets them claim.
    const client = accepted.clientId as unknown as {
      _id: { toString: () => string };
      role?: string;
      status?: string;
    } | null;
    if (client && (client.role === "guest" || client.role === "prospect")) {
      await provisionGuestAsClient(client._id.toString(), {
        issueType: accepted.issueType,
        activate: false,
      });
      const fresh = await User.findById(client._id).select("role status").lean();
      if (fresh) {
        client.role = fresh.role;
        client.status = fresh.status;
      }
    }

    await queueFirstAppointmentConfirmation({
      appointment: accepted,
      professionalId,
      logPrefix: "[accept-direct]",
    });

    return NextResponse.json({
      id: String(accepted._id),
      status: accepted.status,
      date: accepted.date?.toISOString(),
      time: accepted.time,
      duration: accepted.duration,
      type: accepted.type,
    });
  } catch (error) {
    console.error("accept-direct error:", error);
    return NextResponse.json({ error: "Failed to accept the request" }, { status: 500 });
  }
}
