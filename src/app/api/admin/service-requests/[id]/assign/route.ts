import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { sendProfessionalNotification } from "@/lib/notifications";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

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
    if (!admin?.permissions?.manageUsers) {
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
    // A request can be (re)assigned while still "pending" (no real date). If a
    // pro already accepted it (matched) but never scheduled, the admin may
    // reassign to a different pro. Once scheduled, reassignment goes through
    // cancel/rebook instead — refuse here.
    const isReassignment = Boolean(appointment.professionalId);
    if (isReassignment) {
      if (appointment.status !== "pending") {
        return NextResponse.json(
          { error: "A scheduled appointment cannot be reassigned here" },
          { status: 409 },
        );
      }
      if (appointment.professionalId?.toString() === professionalId) {
        return NextResponse.json(
          { error: "Request is already assigned to this professional" },
          { status: 409 },
        );
      }
    }

    const pricing = await calculateAppointmentPricing(
      professionalId,
      appointment.therapyType,
    );

    // Propose to the chosen professional (no lock-in). Overwrite proposedTo so
    // this is a targeted proposal even if the request had been auto-routed to
    // several pros earlier. The match/payment email is intentionally NOT sent
    // here — it fires only once this pro accepts (status → "scheduled").
    const update: Record<string, unknown> = {
      $set: {
        routingStatus: "proposed",
        proposedTo: [new mongoose.Types.ObjectId(professionalId)],
        // Stamp the proposal time so the 48h no-response timeout can fire.
        proposedAt: new Date(),
        "payment.price": pricing.sessionPrice,
        "payment.platformFee": pricing.platformFee,
        "payment.professionalPayout": pricing.professionalPayout,
      },
    };
    if (isReassignment) {
      const previousProId = appointment.professionalId;
      // Hand off to a different pro: drop the current one, reset the matched
      // timestamp + reminder/escalation flags (fresh window for the new pro),
      // and exclude the previous pro from re-matching this request.
      const set = update.$set as Record<string, unknown>;
      set.firstRdvReminderSent = false;
      set.firstRdvAdminEscalatedSent = false;
      update.$unset = { professionalId: "", matchedAt: "" };
      if (previousProId) update.$addToSet = { refusedBy: previousProId };
    }
    await Appointment.findByIdAndUpdate(id, update);

    const client = appointment.clientId as unknown as {
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
    } | null;

    // §3.1: do NOT email the client on reassignment. Moving them to another pro
    // (proposed, not yet accepted) stays SILENT — the client's only matching
    // email is the jumelage confirmation once the NEW pro actually accepts.
    // Admins still track the move in their dashboard.

    // Notify the chosen professional that a request was routed to them so they
    // can review and accept it. The request has no date/time yet (booking
    // happens after acceptance), so the email carries assignment context only.
    if (professional.email) {
      const clientNameForPro =
        `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() ||
        "Client";
      after(() =>
        sendProfessionalNotification({
          clientName: clientNameForPro,
          clientEmail: client?.email ?? "",
          professionalName: `${professional.firstName ?? ""} ${
            professional.lastName ?? ""
          }`.trim(),
          professionalEmail: professional.email,
          duration: appointment.duration || 60,
          type: appointment.type as "video" | "in-person" | "phone" | "both",
        }).catch((err) =>
          console.error("[admin manual jumelage] pro notify error:", err),
        ),
      );
    }

    return NextResponse.json({
      id: appointment._id.toString(),
      proposedTo: professionalId,
      routingStatus: "proposed",
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
