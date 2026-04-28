import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import crypto from "crypto";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  sendJumelageSuccessEmail,
  sendAppointmentTakenNotification,
  sendGuestPaymentConfirmation,
  sendPaymentInvitation,
} from "@/lib/notifications";
import User from "@/models/User";
import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";

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
    const isProposed = appointment.proposedTo?.some(
      (pId: { toString: () => string }) => pId.toString() === session.user.id,
    );
    const isGeneral =
      appointment.routingStatus === "general" ||
      appointment.routingStatus === "refused";

    if (!isProposed && !isGeneral) {
      return NextResponse.json(
        { error: "You are not authorized to accept this appointment" },
        { status: 403 },
      );
    }

    // Accept the appointment and set it as scheduled
    const updatedAppointment = await Appointment.findByIdAndUpdate(
      id,
      {
        professionalId: session.user.id,
        routingStatus: "accepted",
        status: "scheduled",
      },
      { new: true },
    )
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

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

      const clientUser = await User.findById(client._id).select("language role").lean();
      const locale: "fr" | "en" = (clientUser as { language?: string } | null)?.language === "fr" ? "fr" : "en";
      const wasProspectOrGuest =
        (clientUser as { role?: string } | null)?.role === "guest" ||
        (clientUser as { role?: string } | null)?.role === "prospect";

      // Provision an account for prospects/guests who never completed signup.
      // Account is created as inactive so it exists in the system but the client
      // isn't considered "active" until they claim it via the invitation link.
      if (wasProspectOrGuest) {
        await provisionGuestAsClient(client._id.toString(), {
          issueType: updatedAppointment.issueType,
          activate: false,
        });
      }

      // Mark appointment as awaiting payment guarantee
      await Appointment.findByIdAndUpdate(id, { awaitingPaymentGuarantee: true, firstScheduledAt: new Date() });

      // Send jumelage confirmation email
      void sendJumelageSuccessEmail({
        clientName: `${client.firstName} ${client.lastName}`.trim(),
        clientEmail: client.email,
        professionalName,
        locale,
      }).catch((err) => console.error("Error sending jumelage success email:", err));

      // Send payment invitation — with a tokenized link for unclaimed accounts,
      // or a dashboard link for already-active clients.
      const freshClientUser = await User.findById(client._id).select("role status stripeCustomerId").lean();
      const isActiveClient = (freshClientUser as { role?: string; status?: string } | null)?.role === "client" &&
        (freshClientUser as { status?: string } | null)?.status === "active";

      const base = getBaseUrl();

      if (!isActiveClient) {
        // Client hasn't claimed their account — send tokenized /pay link
        const paymentToken = crypto.randomBytes(32).toString("hex");
        const paymentTokenExpiry = new Date();
        paymentTokenExpiry.setDate(paymentTokenExpiry.getDate() + 7);
        await Appointment.findByIdAndUpdate(id, {
          "payment.paymentToken": paymentToken,
          "payment.paymentTokenExpiry": paymentTokenExpiry,
        });
        const paymentLink = `${base}/pay?token=${paymentToken}`;
        void sendGuestPaymentConfirmation({
          guestName: `${client.firstName} ${client.lastName}`.trim(),
          guestEmail: client.email,
          professionalName,
          date: updatedAppointment.date?.toISOString(),
          time: updatedAppointment.time,
          duration: updatedAppointment.duration || 60,
          type: updatedAppointment.type as "video" | "in-person" | "phone" | "both",
          therapyType: (updatedAppointment.therapyType as "solo" | "couple" | "group") || "solo",
          price: updatedAppointment.payment?.price ?? 0,
          paymentLink,
          locale,
        }).catch((err) => console.error("Error sending payment invitation (unclaimed):", err));
      } else {
        // Active client — send dashboard billing link
        void sendPaymentInvitation({
          clientName: `${client.firstName} ${client.lastName}`.trim(),
          clientEmail: client.email,
          professionalName: professionalName ?? "",
          professionalEmail: professional?.email ?? "",
          date: updatedAppointment.date?.toISOString(),
          time: updatedAppointment.time,
          duration: updatedAppointment.duration || 60,
          type: updatedAppointment.type as "video" | "in-person" | "phone" | "both",
          price: updatedAppointment.payment?.price ?? 0,
          paymentUrl: `${base}/client/dashboard/billing`,
        }).catch((err) => console.error("Error sending payment invitation (active):", err));
      }
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
          void sendAppointmentTakenNotification({
            professionalName: `${pro.firstName} ${pro.lastName}`,
            professionalEmail: pro.email,
          }).catch((err) =>
            console.error(
              `[accept] Failed to notify professional ${pro._id}:`,
              err,
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
