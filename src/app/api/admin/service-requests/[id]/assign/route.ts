import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import {
  sendProfessionalNotification,
  sendJumelageSuccessEmail,
} from "@/lib/notifications";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";
import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";

/**
 * Manually route a pending service-request to a specific professional.
 *
 * This does NOT lock the professional in or confirm the match. It *proposes*
 * the request to the chosen professional (routingStatus → "proposed",
 * proposedTo → [professionalId]) and notifies them. The professional must
 * still accept via POST /api/appointments/[id]/accept — that's what flips the
 * appointment to "scheduled" and sends the client the jumelage / payment
 * email. Sending that email here would dead-end the payment CTA, which is
 * gated on status === "scheduled". Pricing is refreshed to the chosen pro's
 * rate so it's already correct the moment they accept.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();
    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });
    // The matching queue is patient/request management — accept either
    // permission (mirrors the GET /service-requests guard) so an admin who can
    // SEE the queue can also assign from it (was manageUsers-only → silent 403).
    if (
      !admin?.permissions?.manageUsers &&
      !admin?.permissions?.managePatients
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { professionalId, mode } = (await req.json()) as {
      professionalId?: string;
      mode?: "auto" | "general";
    };

    // Instead of proposing to one specific pro, the admin can re-run automatic
    // matching ("auto") or drop the request into the public general pool
    // ("general") where any available pro can self-assign it.
    if (mode === "auto" || mode === "general") {
      const appt = await Appointment.findById(id);
      if (!appt) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (appt.status !== "pending") {
        return NextResponse.json(
          { error: "Only a pending request can be re-routed" },
          { status: 409 },
        );
      }

      if (mode === "general") {
        await Appointment.findByIdAndUpdate(id, {
          $set: { routingStatus: "general" },
          $unset: {
            professionalId: "",
            matchedAt: "",
            proposedTo: "",
            proposedAt: "",
          },
        });
        // No email broadcast: professionals are notified ONLY when a client is
        // specifically proposed/assigned to them (sendProfessionalNotification
        // on a targeted jumelage). The general pool is a PULL — pros see new
        // requests in their "Propositions → Général" tab and self-claim there,
        // without an email per new entry (client feedback §3).
        return NextResponse.json({
          id,
          mode: "general",
          routingStatus: "general",
        });
      }

      // mode === "auto": reset to a clean pending state, then run the matcher
      // (it only routes when routingStatus === "pending" && no professionalId).
      // Reset cascadeAttempts so a deliberate admin re-match restarts at Tentative
      // 1 (strict), and CLEAR refusedBy so the re-run retries EVERY professional
      // (incl. anyone who previously declined/let a proposal expire) — a manual
      // re-launch is an explicit "try them all again" (client feedback §4).
      await Appointment.findByIdAndUpdate(id, {
        $set: { routingStatus: "pending", cascadeAttempts: 0, refusedBy: [] },
        $unset: {
          professionalId: "",
          matchedAt: "",
          proposedTo: "",
          proposedAt: "",
        },
      });
      const result = await routeAppointmentToProfessionals(id);
      return NextResponse.json({
        id,
        mode: "auto",
        routingStatus: result.routingStatus,
        matchCount: result.matches.length,
      });
    }

    if (!professionalId || !mongoose.Types.ObjectId.isValid(professionalId)) {
      return NextResponse.json(
        { error: "professionalId is required" },
        { status: 400 },
      );
    }

    const [appointment, professional] = await Promise.all([
      Appointment.findById(id).populate(
        "clientId",
        "firstName lastName email language role status",
      ),
      User.findOne({
        _id: professionalId,
        role: "professional",
        status: { $in: ["active", "pending"] },
      }),
    ]);
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }
    // A request can be (re)assigned while still "pending" (no real date). Once a
    // first date is set (status "scheduled") reassignment goes through
    // cancel/rebook instead — refuse here.
    const isReassignment = Boolean(appointment.professionalId);
    if (appointment.status !== "pending") {
      return NextResponse.json(
        { error: "A scheduled appointment cannot be reassigned here" },
        { status: 409 },
      );
    }
    if (
      isReassignment &&
      appointment.professionalId?.toString() === professionalId
    ) {
      return NextResponse.json(
        { error: "Request is already assigned to this professional" },
        { status: 409 },
      );
    }

    const pricing = await calculateAppointmentPricing(
      professionalId,
      appointment.therapyType,
    );

    // DIRECT ASSIGNMENT (admin override). The admin's pick is final: lock the
    // pro in immediately — exactly like the pro accepting — instead of merely
    // proposing and waiting. Set professionalId + routingStatus "accepted",
    // stamp matchedAt, refresh pricing to the chosen pro's rate, and clear the
    // proposal bookkeeping. The pro then just confirms the first appointment
    // date (schedule-first). (Auto-matching still PROPOSES so its 24h refusal
    // cascade works; a manual admin pick is a deliberate, immediate match.)
    const previousProId = appointment.professionalId;
    const set: Record<string, unknown> = {
      professionalId: new mongoose.Types.ObjectId(professionalId),
      routingStatus: "accepted",
      matchedAt: new Date(),
      // Restart the urgent take-charge clock (reset its soft-SLA alert dedup).
      takeChargeSlaAlertSent: false,
      "payment.price": pricing.sessionPrice,
      "payment.platformFee": pricing.platformFee,
      "payment.professionalPayout": pricing.professionalPayout,
    };
    const update: Record<string, unknown> = {
      $set: set,
      $unset: { proposedTo: "", proposedAt: "" },
    };
    if (isReassignment) {
      // Hand off to a different pro: reset the first-RDV reminder/escalation
      // flags (fresh window) and exclude the previous pro from re-matching.
      set.firstRdvReminderSent = false;
      set.firstRdvAdminEscalatedSent = false;
      if (previousProId) update.$addToSet = { refusedBy: previousProId };
    }

    // Atomic claim: assign only while STILL pending, so a manual assignment can
    // never clobber a match a pro accepted (or the matcher committed) in the
    // same instant.
    const updated = await Appointment.findOneAndUpdate(
      { _id: id, status: "pending" },
      update,
      { new: true },
    ).populate("clientId", "firstName lastName email language role status");
    if (!updated) {
      return NextResponse.json(
        { error: "Request can no longer be assigned" },
        { status: 409 },
      );
    }

    const client = updated.clientId as unknown as {
      _id?: { toString: () => string };
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
      role?: string;
      status?: string;
    } | null;

    const professionalName = `${professional.firstName ?? ""} ${
      professional.lastName ?? ""
    }`.trim();

    // Provision a guest/prospect account in the main flow (awaited) so the
    // "Compléter mon compte" CTA in the jumelage email has a claim target —
    // mirrors the pro→accept flow.
    if (
      client?._id &&
      (client.role === "guest" || client.role === "prospect")
    ) {
      await provisionGuestAsClient(client._id.toString(), {
        issueType: updated.issueType,
        activate: false,
      }).catch((e) => console.error("[admin assign] provision guest:", e));
    }

    const recipient = resolveAppointmentRecipient(
      { bookingFor: updated.bookingFor, lovedOneInfo: updated.lovedOneInfo },
      {
        firstName: client?.firstName ?? "",
        lastName: client?.lastName ?? "",
        email: client?.email ?? "",
        language: client?.language,
      },
    );
    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";
    const isActiveClient =
      client?.role === "client" && client?.status === "active";
    const completeAccountUrl = isActiveClient
      ? `${base}/client/dashboard/profile`
      : `${base}/signup/member?email=${encodeURIComponent(recipient.email)}`;

    // A manual assignment IS a real jumelage: email the CLIENT the match and
    // notify the assigned professional (after the response so SMTP never blocks).
    after(() => {
      if (recipient.email) {
        sendJumelageSuccessEmail({
          clientName: recipient.name,
          clientEmail: recipient.email,
          professionalName,
          locale: recipient.language,
          completeAccountUrl,
          // Active clients can add a payment method now (Interac/card); guests
          // must claim their account first, so no auth-gated billing link.
          addPaymentMethodUrl: isActiveClient
            ? `${base}/client/dashboard/billing?action=addPaymentMethod&lang=${
                recipient.language === "en" ? "en" : "fr"
              }`
            : undefined,
        }).catch((e) => console.error("[admin assign] jumelage email:", e));
      }
      if (professional.email) {
        sendProfessionalNotification({
          clientName:
            `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() ||
            "Client",
          clientEmail: client?.email ?? "",
          professionalName,
          professionalEmail: professional.email,
          duration: updated.duration || 60,
          type: updated.type as "video" | "in-person" | "phone" | "both",
          isEmergency: Boolean(updated.isEmergency),
        }).catch((e) => console.error("[admin assign] pro notify:", e));
      }
    });

    return NextResponse.json({
      id: updated._id.toString(),
      professionalId,
      routingStatus: "accepted",
      reassigned: isReassignment,
    });
  } catch (error) {
    console.error("Admin manual jumelage error:", error);
    return NextResponse.json(
      {
        error: "Failed to assign professional",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
