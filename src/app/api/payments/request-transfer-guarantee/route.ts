import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import {
  sendAdminInteracTrustRequestAlert,
  sendInteracTransferInstructionsEmail,
} from "@/lib/notifications";
import { buildInteracReferenceCode } from "@/lib/interac-reference";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { canSessionUserActForClient } from "@/lib/guardian-utils";

function appointmentClientUserId(clientRef: unknown): string {
  if (
    typeof clientRef === "object" &&
    clientRef !== null &&
    "_id" in clientRef
  ) {
    return String(
      (clientRef as { _id: { toString: () => string } })._id,
    );
  }
  return String(clientRef);
}

export async function POST(req: NextRequest) {
  try {
    await connectToDatabase();

    const body = await req.json();
    const { appointmentId, token } = body as {
      appointmentId?: string;
      token?: string;
    };

    if (!appointmentId) {
      return NextResponse.json(
        { error: "appointmentId is required" },
        { status: 400 },
      );
    }

    const session = await getServerSession(authOptions);

    const appointment = await Appointment.findById(appointmentId)
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName");

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    let clientUserId: string;

    if (token) {
      const t = appointment.payment?.paymentToken;
      const exp = appointment.payment?.paymentTokenExpiry;
      const valid =
        t === token && exp && new Date(exp) > new Date();
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid or expired payment link" },
          { status: 403 },
        );
      }
      clientUserId = appointmentClientUserId(appointment.clientId);
    } else {
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      clientUserId = appointmentClientUserId(appointment.clientId);
      const allowed = await canSessionUserActForClient(
        session.user.id,
        clientUserId,
      );
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (appointment.status !== "scheduled") {
      return NextResponse.json(
        {
          error:
            "Cette option est disponible uniquement pour un rendez-vous confirmé.",
        },
        { status: 400 },
      );
    }

    const user = await User.findById(clientUserId);
    if (!user) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (
      user.paymentGuaranteeStatus === "green" &&
      user.paymentGuaranteeSource === "stripe"
    ) {
      return NextResponse.json(
        {
          error:
            "Une carte ou un PAD est déjà enregistré. Utilisez la facturation pour gérer vos moyens de paiement.",
        },
        { status: 400 },
      );
    }

    if (
      user.paymentGuaranteeStatus === "green" &&
      user.paymentGuaranteeSource === "interac_trust"
    ) {
      return NextResponse.json(
        { error: "Une entente de confiance est déjà en place." },
        { status: 400 },
      );
    }

    const prevStatus = user.paymentGuaranteeStatus;

    const proDoc = appointment.professionalId as unknown as {
      _id: { toString: () => string };
      firstName?: string;
      lastName?: string;
    } | null;

    const interacReferenceCode =
      appointment.payment?.interacReferenceCode ||
      buildInteracReferenceCode(
        String(appointment._id),
        proDoc?._id?.toString(),
      );

    await Appointment.findByIdAndUpdate(appointmentId, {
      "payment.method": "transfer",
      "payment.interacReferenceCode": interacReferenceCode,
      awaitingPaymentGuarantee: false,
    });

    await User.findByIdAndUpdate(clientUserId, {
      $set: {
        paymentGuaranteeStatus: "pending_admin",
        preferredPaymentMethod: "interac",
      },
      $unset: { paymentGuaranteeSource: "" },
    });

    const client = appointment.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
    };

    if (prevStatus !== "pending_admin") {
      sendAdminInteracTrustRequestAlert({
        clientName: `${client.firstName} ${client.lastName}`,
        clientEmail: client.email,
        appointmentId: String(appointment._id),
      }).catch((err) =>
        console.error("sendAdminInteracTrustRequestAlert:", err),
      );
    }

    const depositEmail = await getInteracDepositEmail();
    const aptDate = appointment.date
      ? new Date(appointment.date)
      : null;
    const dateLabel =
      aptDate && !isNaN(aptDate.getTime())
        ? `${aptDate.toLocaleDateString("fr-CA", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}${appointment.time ? ` à ${appointment.time}` : ""}`
        : "—";

    sendInteracTransferInstructionsEmail({
      clientName: `${client.firstName} ${client.lastName}`,
      clientEmail: client.email,
      clientLegalName: `${client.firstName} ${client.lastName}`,
      depositEmail,
      amountCad: appointment.payment?.price ?? 0,
      interacReferenceCode,
      professionalName: proDoc
        ? `${proDoc.firstName ?? ""} ${proDoc.lastName ?? ""}`.trim()
        : "Votre professionnel",
      appointmentDateLabel: dateLabel,
    }).catch((err) =>
      console.error("sendInteracTransferInstructionsEmail:", err),
    );

    return NextResponse.json({ success: true, interacReferenceCode });
  } catch (error: unknown) {
    console.error("request-transfer-guarantee:", error);
    return NextResponse.json(
      {
        error: "Failed to submit request",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
