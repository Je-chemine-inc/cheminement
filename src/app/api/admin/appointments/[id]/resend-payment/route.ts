import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import {
  sendInteracTransferInstructionsEmail,
  sendSessionInvoiceEmail,
} from "@/lib/notifications";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { resolveBillingUrl } from "@/lib/client-portal-urls";

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

    const { id } = await params;
    const apt = await Appointment.findById(id)
      .populate("clientId", "firstName lastName email language")
      .populate("professionalId", "firstName lastName");

    if (!apt) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    if (apt.payment.method !== "transfer") {
      return NextResponse.json(
        { error: "This appointment does not use Interac" },
        { status: 400 },
      );
    }

    const client = apt.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
      language?: string;
    };
    const pro = apt.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;

    if (!client?.email) {
      return NextResponse.json({ error: "Client email not found" }, { status: 400 });
    }

    // LSSSS art. 14: route to the beneficiary inbox for adult loved-one bookings.
    // The legal name on the bank-instruction line still uses the payer.
    const recipient = resolveAppointmentRecipient(
      {
        bookingFor: apt.bookingFor,
        lovedOneInfo: apt.lovedOneInfo,
      },
      client,
    );

    const depositEmail = await getInteracDepositEmail();

    const aptDate = apt.date ? new Date(apt.date) : null;
    const dateLabel = aptDate
      ? `${aptDate.toLocaleDateString("fr-CA", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}${apt.time ? ` à ${apt.time}` : ""}`
      : "—";

    const clientLegalName = `${client.firstName} ${client.lastName}`.trim();
    const professionalName = pro
      ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
      : "—";

    // Relancing MUST reuse the SAME reference the client already received — not
    // mint a new one — or they end up with two different "mandatory note" codes
    // for one payment and the orphan-transfer reconciliation can't match.
    //
    // For a completed session (it has an invoiceNumber), re-send the unified
    // post-session payment email with that SAME invoice number — the canonical
    // Interac note, also what the reconciliation searches on. Only the older
    // pre-session guarantee flow (no invoice yet) keeps the Interac-instructions
    // email, reusing its existing reference code.
    let ok: boolean;
    if (apt.invoiceNumber) {
      const base =
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000";
      const payUrl = await resolveBillingUrl({
        userStatus: undefined,
        appointment: apt as Parameters<
          typeof resolveBillingUrl
        >[0]["appointment"],
        base,
        recipientLocale: recipient.language,
        forceTokenLink: true,
      });
      ok = await sendSessionInvoiceEmail({
        clientEmail: recipient.email,
        clientName: recipient.name,
        amountCad: apt.payment.price,
        invoiceNumber: apt.invoiceNumber,
        appointmentDateLabel: dateLabel,
        payUrl,
        depositEmail,
        clientLegalName,
        professionalName,
        reminderNumber: 1,
        locale: recipient.language,
      });
    } else {
      ok = await sendInteracTransferInstructionsEmail({
        clientName: recipient.name,
        clientEmail: recipient.email,
        clientLegalName,
        depositEmail,
        amountCad: apt.payment.price,
        interacReferenceCode: apt.payment.interacReferenceCode || "",
        professionalName,
        appointmentDateLabel: dateLabel,
        locale: recipient.language,
      });
    }

    if (!ok) {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("resend-payment admin API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
