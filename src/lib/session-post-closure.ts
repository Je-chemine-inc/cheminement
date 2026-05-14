import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Profile from "@/models/Profile";
import ClientReceipt from "@/models/ClientReceipt";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import {
  sendInteracTransferInstructionsEmail,
  sendFiscalReceiptEmail,
} from "@/lib/notifications";
import {
  buildFiscalReceiptPdfBuffer,
  buildFiscalReceiptInputFromPopulatedAppointment,
} from "@/lib/receipt-pdf";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { getPlatformContactInfo } from "@/lib/platform-contact";
import { formatStandardAddressBlock } from "@/lib/format-platform-contact";
import mongoose from "mongoose";
import { cycleKeyFromDateOrNow } from "@/lib/ledger-cycle";

/**
 * Après enregistrement Mongo de la clôture : Interac, reçu PDF, grand livre, historique reçus.
 * Idempotent si reçu client déjà créé ou fiscalReceiptIssuedAt présent.
 */
export async function runSessionClosureSideEffects(
  appointmentId: string,
): Promise<void> {
  await connectToDatabase();

  const appointment = await Appointment.findById(appointmentId)
    .populate("clientId", "firstName lastName email language")
    .populate("professionalId", "firstName lastName email");

  if (!appointment) return;

  const price = appointment.payment?.price ?? 0;
  const billable =
    (appointment.status === "completed" || appointment.status === "no-show") &&
    price > 0;

  const client = appointment.clientId as unknown as {
    _id: { toString: () => string };
    firstName: string;
    lastName: string;
    email: string;
    language?: string;
  };
  const clientLocale: "fr" | "en" = client.language === "en" ? "en" : "fr";
  const professional = appointment.professionalId as unknown as {
    _id: { toString: () => string };
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;

  const proId = professional?._id?.toString();
  if (proId && billable) {
    try {
      await ProfessionalLedgerEntry.create({
        professionalId: new mongoose.Types.ObjectId(proId),
        entryKind: "credit",
        cycleKey: cycleKeyFromDateOrNow(appointment.sessionCompletedAt ?? new Date()),
        appointmentId: appointment._id,
        sessionActNature: appointment.sessionActNature,
        grossAmountCad: price,
        platformFeeCad: appointment.payment.platformFee,
        netToProfessionalCad: appointment.payment.professionalPayout,
        paymentChannel:
          appointment.payment.method === "transfer"
            ? "transfer"
            : appointment.payment.method === "card" ||
                appointment.payment.method === "direct_debit"
              ? "stripe"
              : "none",
      });
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code !== 11000) {
        console.error("ProfessionalLedgerEntry create:", e);
      }
    }
  }

  if (!billable || !professional) {
    return;
  }

  const existingReceipt = await ClientReceipt.findOne({ appointmentId });
  if (existingReceipt || appointment.fiscalReceiptIssuedAt) {
    return;
  }

  const profile = await Profile.findOne({ userId: professional._id }).lean();
  const license = profile?.license?.trim();
  const specialty = profile?.specialty?.trim();

  // Platform coordinates (mandatory on receipts) — pulled live from Admin settings.
  const platformContact = await getPlatformContactInfo();

  const pdfInput = buildFiscalReceiptInputFromPopulatedAppointment(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appointment.toObject() as any,
    license,
    specialty,
  );
  pdfInput.issuedAt = new Date();
  pdfInput.platformAddressLines = formatStandardAddressBlock(
    platformContact.physicalAddress,
    platformContact.companyName,
  );
  pdfInput.platformPhoneNumber = platformContact.phoneNumber;
  pdfInput.platformSupportEmail = platformContact.supportEmail;

  const aptDate = appointment.date ? new Date(appointment.date) : null;
  const dateLabel =
    aptDate && !isNaN(aptDate.getTime())
      ? `${aptDate.toLocaleDateString("fr-CA", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}${appointment.time ? ` à ${appointment.time}` : ""}`
      : "—";

  const paymentPendingTransfer =
    appointment.payment.method === "transfer" &&
    appointment.payment.status !== "paid";

  const pdfBuffer = buildFiscalReceiptPdfBuffer(pdfInput);

  if (paymentPendingTransfer) {
    const depositEmail = await getInteracDepositEmail();
    const code = appointment.payment.interacReferenceCode || "";
    await sendInteracTransferInstructionsEmail({
      clientName: `${client.firstName} ${client.lastName}`,
      clientEmail: client.email,
      clientLegalName: `${client.firstName} ${client.lastName}`,
      depositEmail,
      amountCad: price,
      interacReferenceCode: code,
      professionalName: pdfInput.professionalName,
      appointmentDateLabel: dateLabel,
    }).catch((err) =>
      console.error("sendInteracTransferInstructionsEmail:", err),
    );
  }

  await sendFiscalReceiptEmail({
    clientEmail: client.email,
    clientName: pdfInput.clientName,
    amountCad: price,
    pdfBuffer,
    appointmentId: String(appointment._id),
    paymentPendingTransfer,
    locale: clientLocale,
  }).catch((err) => console.error("sendFiscalReceiptEmail:", err));

  await ClientReceipt.create({
    clientId: client._id,
    appointmentId: appointment._id,
    issuedAt: new Date(),
    amountCad: price,
    status: paymentPendingTransfer ? "pending_transfer" : "paid",
  }).catch((e: unknown) => {
    const code = (e as { code?: number })?.code;
    if (code !== 11000) {
      console.error("ClientReceipt create:", e);
    }
  });

  await Appointment.findByIdAndUpdate(appointmentId, {
    fiscalReceiptIssuedAt: new Date(),
  });
}
