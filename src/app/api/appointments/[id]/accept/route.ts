import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  sendJumelageSuccessEmail,
  sendAppointmentTakenNotification,
} from "@/lib/notifications";
import User from "@/models/User";
import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

/**
 * POST /api/appointments/[id]/accept
 * Professional accepts a proposed or general appointment
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "professional") {
      return NextResponse.json(
        { error: "Only professionals can accept appointments" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const { id } = await params;
    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Check if appointment can be accepted
    if (appointment.status !== "pending") {
      return NextResponse.json(
        { error: "Appointment is no longer pending" },
        { status: 400 },
      );
    }

    if (appointment.professionalId) {
      return NextResponse.json(
        { error: "Appointment already assigned to a professional" },
        { status: 400 },
      );
    }

    // Check if this professional is allowed to accept
    // (either proposed to them, or in general list)
    // A pro may accept ONLY a request that is actively proposed to them OR sitting
    // in the general pool. Keying isProposed on routingStatus too (not just
    // proposedTo membership) ensures a dossier returned to the admin queue
    // (routingStatus "awaiting_admin") can never be accepted by a pro even if a
    // stale proposedTo entry survived — it is an admin-only decision.
    const isProposed =
      appointment.routingStatus === "proposed" &&
      (appointment.proposedTo?.some(
        (pId: { toString: () => string }) => pId.toString() === session.user.id,
      ) ??
        false);
    const isGeneral =
      appointment.routingStatus === "general" ||
      appointment.routingStatus === "refused";

    if (!isProposed && !isGeneral) {
      return NextResponse.json(
        { error: "You are not authorized to accept this appointment" },
        { status: 403 },
      );
    }

    // NOTE: self-claiming from the general pool is open to EVERY professional,
    // even one with "accepting new clients" OFF (client feedback §2 — the pool
    // is an always-available PULL). The toggle gates only the automatic PUSH
    // (cascade proposals + broadcast emails), handled in the matcher.

    // Accept = MATCH only. We deliberately keep status "pending" (no real date
    // yet) and just lock in the professional via routingStatus "accepted". The
    // first appointment date is set later by the pro via the dedicated
    // "Confirmer le 1er RDV" action (POST /api/appointments/[id]/schedule-first),
    // which is what flips status to "scheduled" and sends the confirmation +
    // payment-invitation email. Acceptance sends ONLY the jumelage email.
    // Atomic claim: only succeeds if the request is STILL unassigned and pending.
    // The pre-checks above can race — with the general pool now open to every
    // pro (§2), two pros can "piger" the same client at the same instant. The
    // filter (professionalId null + status pending) lets exactly one win; the
    // loser gets the null below → 409, instead of silently overwriting the match.
    const updatedAppointment = await Appointment.findOneAndUpdate(
      {
        _id: id,
        professionalId: null,
        status: "pending",
        // Belt-and-suspenders: only acceptable routing states can be claimed, so
        // a row mid-re-route ("pending") or returned to the admin queue
        // ("awaiting_admin") can't be claimed even if the checks above raced.
        routingStatus: { $in: ["proposed", "general", "refused"] },
      },
      {
        $set: {
          professionalId: session.user.id,
          routingStatus: "accepted",
          matchedAt: new Date(),
          // Start the urgent 12h take-charge clock fresh (reset its soft-SLA
          // alert dedup) so a re-accepted urgent request can alert again.
          takeChargeSlaAlertSent: false,
        },
        // Clear the targeted-proposal bookkeeping now that a pro is locked in.
        $unset: { proposedTo: "", proposedAt: "" },
      },
      { new: true },
    )
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

    if (!updatedAppointment) {
      // Lost the race — another professional claimed this request first.
      return NextResponse.json(
        { error: "Appointment already assigned to a professional" },
        { status: 409 },
      );
    }

    if (updatedAppointment && updatedAppointment.clientId) {
      const client = updatedAppointment.clientId as unknown as {
        _id: { toString: () => string };
        firstName: string;
        lastName: string;
        email: string;
      };
      const professional = updatedAppointment.professionalId as {
        firstName?: string;
        lastName?: string;
        email?: string;
      } | null;
      const professionalName = professional
        ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim()
        : undefined;

      const clientUser = await User.findById(client._id)
        .select("language role")
        .lean();
      const wasProspectOrGuest =
        (clientUser as { role?: string } | null)?.role === "guest" ||
        (clientUser as { role?: string } | null)?.role === "prospect";

      // Provision an account for prospects/guests who never completed signup so
      // the "Compléter mon compte" CTA in the jumelage email has a claim target.
      // Stays inactive until the client claims it via the invitation link.
      if (wasProspectOrGuest) {
        await provisionGuestAsClient(client._id.toString(), {
          issueType: updatedAppointment.issueType,
          activate: false,
        });
      }

      const freshClientUser = await User.findById(client._id)
        .select("role status")
        .lean();
      const isActiveClient =
        (freshClientUser as { role?: string } | null)?.role === "client" &&
        (freshClientUser as { status?: string } | null)?.status === "active";

      // Quebec LSSSS art. 14: for adult loved-one bookings, all transactional
      // emails go EXCLUSIVELY to the beneficiary, not the requester.
      const recipient = resolveAppointmentRecipient(
        {
          bookingFor: updatedAppointment.bookingFor,
          lovedOneInfo: updatedAppointment.lovedOneInfo,
        },
        {
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          language: (clientUser as { language?: string } | null)?.language,
        },
      );

      const base = getBaseUrl();
      // "Compléter mon compte" CTA:
      //   - unclaimed account → /signup/member?email=... (the claim flow)
      //   - active client     → /client/dashboard/profile (finalize profile)
      const completeAccountUrl = isActiveClient
        ? `${base}/client/dashboard/profile`
        : `${base}/signup/member?email=${encodeURIComponent(recipient.email)}`;

      // Acceptance sends ONLY the jumelage (match) email — NO payment CTA, since
      // no first-appointment date exists yet. The payment invitation rides along
      // with the 1st-RDV confirmation email sent from schedule-first.
      const jumelageArgs = {
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName,
        locale: recipient.language,
        completeAccountUrl,
        // Active clients can add a payment method now (Interac/card). Guests must
        // claim their account first (completeAccountUrl above), so no billing
        // deep-link for them — the dashboard is auth-gated.
        addPaymentMethodUrl: isActiveClient
          ? `${base}/client/dashboard/billing?action=addPaymentMethod&lang=${
              recipient.language === "en" ? "en" : "fr"
            }`
          : undefined,
      };
      after(() =>
        sendJumelageSuccessEmail(jumelageArgs).catch((err) =>
          console.error("Error sending jumelage success email:", err),
        ),
      );
    }

    // Notify other proposed professionals that this request is no longer available
    if (updatedAppointment) {
      const otherProposedIds = (appointment.proposedTo ?? []).filter(
        (pId: { toString: () => string }) => pId.toString() !== session.user.id,
      );

      if (otherProposedIds.length > 0) {
        const { default: User } = await import("@/models/User");
        const otherPros = await User.find({
          _id: { $in: otherProposedIds },
        }).select("firstName lastName email");

        for (const pro of otherPros) {
          const takenArgs = {
            professionalName: `${pro.firstName} ${pro.lastName}`,
            professionalEmail: pro.email,
          };
          const proIdStr = pro._id.toString();
          after(() =>
            sendAppointmentTakenNotification(takenArgs).catch((err) =>
              console.error(
                `[accept] Failed to notify professional ${proIdStr}:`,
                err,
              ),
            ),
          );
        }
      }
    }

    return NextResponse.json({
      message: "Appointment accepted successfully",
      appointment: updatedAppointment,
    });
  } catch (error) {
    console.error("Accept appointment error:", error);
    return NextResponse.json(
      { error: "Failed to accept appointment" },
      { status: 500 },
    );
  }
}
