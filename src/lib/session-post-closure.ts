import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Profile from "@/models/Profile";
import ClientReceipt from "@/models/ClientReceipt";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import {
  sendAdminThirdPartyDecisionAlert,
  sendFiscalReceiptEmail,
  sendSessionInvoiceEmail,
} from "@/lib/notifications";
import { sendSessionInvoiceSms } from "@/lib/sms";
import {
  buildFiscalReceiptPdfBuffer,
  buildFiscalReceiptInputFromPopulatedAppointment,
} from "@/lib/receipt-pdf";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { getPlatformContactInfo } from "@/lib/platform-contact";
import { formatStandardAddressBlock } from "@/lib/format-platform-contact";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import { notifyCoverageCap } from "@/lib/coverage-notices";
import { resolveBillingUrl } from "@/lib/client-portal-urls";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { resolveInteracReferenceCode } from "@/lib/interac-reference";
import mongoose from "mongoose";
import { cycleKeyFromDateOrNow } from "@/lib/ledger-cycle";
import { fromCents } from "@/lib/money-cents";

const BILLABLE_OUTCOMES = new Set(["completed", "cancelled_late", "no_show"]);

function appUrlBase(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

function buildDateLabel(date?: Date | null, time?: string): string {
  const d = date ? new Date(date) : null;
  if (!d || isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}${time ? ` à ${time}` : ""}`;
}

/**
 * GOLDEN RULE — issue + SEND the official fiscal receipt for an appointment,
 * STRICTLY gated on a confirmed payment (`payment.status === "paid"`). No
 * official receipt is ever sent (or made client-visible) before the payment is
 * actually confirmed.
 *
 * Idempotent and safe to call from every confirmation path:
 *  - session closure, when a saved-card charge settled synchronously at H+0;
 *  - the Stripe webhook (`payment_intent.succeeded`) for manual / async card pay;
 *  - the Interac "marquer comme payé" admin action (settleInteracPayment).
 *
 * Only a closed, billable session (completed / cancelled_late / no_show) yields
 * a receipt — so a pre-paid-but-not-yet-held appointment never produces one.
 */
export async function issueFiscalReceipt(appointmentId: string): Promise<void> {
  await connectToDatabase();

  // `+thirdPartyBilling` (select:false): an external session's receipt names
  // who paid outside the platform (spec 002).
  const appointment = await Appointment.findById(appointmentId)
    .select("+thirdPartyBilling")
    .populate("clientId", "firstName lastName email language")
    .populate("professionalId", "firstName lastName email");

  if (!appointment) return;

  // Golden rule: a confirmed payment is the ONLY trigger for an official receipt.
  if (appointment.payment?.status !== "paid") return;

  const price = appointment.payment?.price ?? 0;
  const outcome = appointment.sessionOutcome as string | undefined;
  if (price <= 0 || !outcome || !BILLABLE_OUTCOMES.has(outcome)) return;

  // Idempotency: never send/create a second receipt.
  if (appointment.fiscalReceiptIssuedAt) return;
  const existingPaid = await ClientReceipt.findOne({
    appointmentId,
    status: "paid",
  });
  if (existingPaid) return;

  const client = appointment.clientId as unknown as {
    _id: { toString: () => string };
    firstName: string;
    lastName: string;
    email: string;
    language?: string;
  };
  const professional = appointment.professionalId as unknown as {
    _id: { toString: () => string };
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
  if (!professional) return;

  // LSSSS art. 14: route the receipt email envelope to the beneficiary for
  // adult loved-one bookings. The PDF payer name is unchanged.
  const recipient = resolveAppointmentRecipient(
    { bookingFor: appointment.bookingFor, lovedOneInfo: appointment.lovedOneInfo },
    client,
  );

  const profile = await Profile.findOne({ userId: professional._id }).lean();
  const platformContact = await getPlatformContactInfo();

  const pdfInput = buildFiscalReceiptInputFromPopulatedAppointment(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appointment.toObject() as any,
    profile?.license?.trim(),
    profile?.specialty?.trim(),
  );
  pdfInput.issuedAt = new Date();
  pdfInput.platformAddressLines = formatStandardAddressBlock(
    platformContact.physicalAddress,
    platformContact.companyName,
  );
  pdfInput.platformPhoneNumber = platformContact.phoneNumber;
  pdfInput.platformSupportEmail = platformContact.supportEmail;
  pdfInput.invoiceNumber = appointment.invoiceNumber;

  const pdfBuffer = buildFiscalReceiptPdfBuffer(pdfInput);

  await sendFiscalReceiptEmail({
    clientEmail: recipient.email,
    clientName: recipient.name,
    amountCad: price,
    pdfBuffer,
    appointmentId: String(appointment._id),
    // Always a confirmed payment here — the receipt is never sent "pending".
    paymentPendingTransfer: false,
    locale: recipient.language,
  }).catch((err) => console.error("sendFiscalReceiptEmail:", err));

  // Create the client-visible receipt. Scoped `$ne: refunded` so we never
  // resurrect a voided/refunded receipt; the unique appointmentId index plus
  // the guards above keep this idempotent.
  await ClientReceipt.findOneAndUpdate(
    { appointmentId: appointment._id, status: { $ne: "refunded" } },
    {
      $set: { status: "paid" },
      $setOnInsert: {
        clientId: client._id,
        appointmentId: appointment._id,
        issuedAt: new Date(),
        amountCad: price,
        invoiceNumber: appointment.invoiceNumber,
      },
    },
    { upsert: true },
  ).catch((e: unknown) => {
    const code = (e as { code?: number })?.code;
    if (code !== 11000) console.error("ClientReceipt upsert:", e);
  });

  await Appointment.findByIdAndUpdate(appointmentId, {
    fiscalReceiptIssuedAt: new Date(),
  });
}

/**
 * Après enregistrement Mongo de la clôture : grand livre pro, numéro de facture,
 * puis — selon que le paiement est déjà confirmé ou non — émission du reçu
 * (paid) OU envoi d'une demande de paiement épurée (courriel + SMS) SANS reçu.
 * Idempotent.
 */
export async function runSessionClosureSideEffects(
  appointmentId: string,
): Promise<void> {
  await connectToDatabase();

  const appointment = await Appointment.findById(appointmentId)
    .select("+thirdPartyBilling")
    .populate("clientId", "firstName lastName email language phone status")
    .populate("professionalId", "firstName lastName email");

  if (!appointment) return;

  const price = appointment.payment?.price ?? 0;
  // The receipt + ledger entry fire for every billing-eligible outcome:
  //  - completed   (session held, 100% billed)
  //  - cancelled_late (<48h cancel, 100% billed as management fees)
  //  - no_show     (client absence, 100% billed as management fees)
  // 48h-plus cancellation has fraction 0 → no receipt, no ledger entry.
  const outcome = appointment.sessionOutcome as string | undefined;
  const billable = price > 0 && !!outcome && BILLABLE_OUTCOMES.has(outcome);

  const client = appointment.clientId as unknown as {
    _id: { toString: () => string };
    firstName: string;
    lastName: string;
    email: string;
    language?: string;
    phone?: string;
    status?: string;
  };
  const recipient = resolveAppointmentRecipient(
    { bookingFor: appointment.bookingFor, lovedOneInfo: appointment.lovedOneInfo },
    client,
  );
  const clientLocale = recipient.language;
  const professional = appointment.professionalId as unknown as {
    _id: { toString: () => string };
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;

  // Spec 002: when a third party pays part or all of the session, the client's
  // `payment` holds only their share — 0 when an organization pays in full. The
  // professional is still owed for the whole session, so the ledger reads the
  // payer snapshot's TOTALS. Gating it on `price > 0` alone would silently stop
  // paying professionals for every covered session.
  const tpb = appointment.thirdPartyBilling;
  const orgCents = tpb?.orgAmountCents ?? 0;
  const sessionBillable =
    (price > 0 || orgCents > 0) && !!outcome && BILLABLE_OUTCOMES.has(outcome);

  const proId = professional?._id?.toString();
  if (proId && sessionBillable) {
    const clientChannel =
      appointment.payment.method === "transfer"
        ? "transfer"
        : appointment.payment.method === "card" ||
            appointment.payment.method === "direct_debit"
          ? "stripe"
          : "none";
    try {
      await ProfessionalLedgerEntry.create({
        professionalId: new mongoose.Types.ObjectId(proId),
        entryKind: "credit",
        cycleKey: cycleKeyFromDateOrNow(
          appointment.sessionCompletedAt ?? new Date(),
        ),
        appointmentId: appointment._id,
        sessionActNature: appointment.sessionActNature,
        ...(tpb
          ? {
              grossAmountCad: fromCents(tpb.clientAmountCents + tpb.orgAmountCents),
              platformFeeCad: fromCents(tpb.platformFeeTotalCents),
              netToProfessionalCad: fromCents(tpb.proPayoutTotalCents),
              paymentChannel: orgCents > 0 ? "organization" : clientChannel,
              clientAmountCad: fromCents(tpb.clientAmountCents),
              orgAmountCad: fromCents(orgCents),
            }
          : {
              grossAmountCad: price,
              platformFeeCad: appointment.payment.platformFee,
              netToProfessionalCad: appointment.payment.professionalPayout,
              paymentChannel: clientChannel,
            }),
      });
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code !== 11000) {
        console.error("ProfessionalLedgerEntry create:", e);
      }
    }
  }

  // Nobody has decided who pays: nothing was charged, so the team must be told
  // — exactly once. The claim is the stamp; a failed send gives it back.
  if (tpb?.state === "awaiting_decision" && !tpb.decisionAlertSentAt) {
    const claim = await Appointment.updateOne(
      {
        _id: appointment._id,
        "thirdPartyBilling.state": "awaiting_decision",
        "thirdPartyBilling.decisionAlertSentAt": { $exists: false },
      },
      { $set: { "thirdPartyBilling.decisionAlertSentAt": new Date() } },
    );
    if (claim.modifiedCount === 1) {
      const sent = await sendAdminThirdPartyDecisionAlert({
        clientName: recipient.name,
        appointmentId: String(appointment._id),
        appointmentDateLabel: buildDateLabel(appointment.date, appointment.time),
        reason: tpb.reason,
        organizationName: appointment.payerDeclaration?.organizationName,
      }).catch(() => false);
      if (!sent) {
        await Appointment.updateOne(
          { _id: appointment._id },
          { $unset: { "thirdPartyBilling.decisionAlertSentAt": "" } },
        );
      }
    }
  }

  // A capped coverage just used a session: one left, or none — tell the
  // client (and the team at one left). Claimed on the coverage, so a retry of
  // these side effects never sends it twice.
  if (tpb?.consumedCapSlot && tpb.coverageId) {
    await notifyCoverageCap(String(tpb.coverageId), { recipient }).catch((e) =>
      console.error("notifyCoverageCap:", e),
    );
  }

  // `billable` is the CLIENT's share. When a third party pays everything it is
  // 0: no invoice number, no payment request, no email to the client.
  if (!billable || !professional) {
    return;
  }

  // Allocate a unique invoice number ONCE, the moment the session is validated.
  // It is referenced by both the payment request and the eventual receipt.
  if (!appointment.invoiceNumber) {
    const inv = await nextInvoiceNumber(
      appointment.sessionCompletedAt ?? new Date(),
    );
    appointment.invoiceNumber = inv;
    await Appointment.findByIdAndUpdate(appointmentId, { invoiceNumber: inv });
  }

  // GOLDEN RULE: if (and only if) the payment is already confirmed — e.g. a
  // saved card charged synchronously at H+0 — issue the official receipt now.
  if (appointment.payment?.status === "paid") {
    await issueFiscalReceipt(appointmentId);
    return;
  }

  // An async charge (ACSS/PAD) sits in "processing": already authorized and
  // settling out-of-band. Don't ask the client to pay again — the
  // payment_intent.succeeded webhook will issue the receipt once it settles.
  if (appointment.payment?.status === "processing") {
    return;
  }

  // Otherwise the payment is still pending: send a clean payment REQUEST
  // (email + SMS) referencing the invoice number — never a receipt. The
  // official receipt follows once Stripe / the admin confirms the payment.
  const dateLabel = buildDateLabel(appointment.date, appointment.time);
  const invoiceNumber = appointment.invoiceNumber as string;
  const base = appUrlBase();
  // Always a no-login link: many clients pay without ever owning an account,
  // and even account-holders shouldn't have to log in to settle one invoice.
  const payUrl = await resolveBillingUrl({
    userStatus: client.status,
    appointment,
    base,
    recipientLocale: clientLocale,
    forceTokenLink: true,
  });

  const depositEmail = await getInteracDepositEmail();
  const platformContact = await getPlatformContactInfo();
  const professionalName = `${professional.firstName ?? ""} ${
    professional.lastName ?? ""
  }`.trim();
  const clientLegalName = `${client.firstName} ${client.lastName}`.trim();

  // ONE unified payment request offering BOTH options — a credit-card button
  // (no-login Stripe link) and Interac instructions (deposit email + the INT-
  // reference as the mandatory transfer note). No receipt is attached: the
  // official receipt follows only once Stripe / the admin confirms payment.
  //
  // The transfer note is the INT- code, NOT the invoice number: it is the same
  // reference the pre-session Interac instructions gave, so a client who pays
  // before the session and one who pays after quote the same thing.
  const interacReferenceCode = resolveInteracReferenceCode(
    appointment.payment?.interacReferenceCode,
    String(appointment._id),
    appointment.professionalId,
  );
  if (appointment.payment?.interacReferenceCode !== interacReferenceCode) {
    // Persist so the admin can search a transfer note back to its appointment.
    await Appointment.findByIdAndUpdate(appointmentId, {
      $set: { "payment.interacReferenceCode": interacReferenceCode },
    });
  }
  await sendSessionInvoiceEmail({
    clientEmail: recipient.email,
    clientName: recipient.name,
    amountCad: price,
    invoiceNumber,
    interacReferenceCode,
    appointmentDateLabel: dateLabel,
    payUrl,
    depositEmail,
    clientLegalName,
    professionalName,
    locale: clientLocale,
  }).catch((err) => console.error("sendSessionInvoiceEmail:", err));

  // Internal, CLIENT-HIDDEN tracking row so the admin reconciliation list shows
  // every unpaid session that may receive an Interac transfer. This is NOT an
  // official receipt — the receipt is issued only once payment is confirmed.
  await ClientReceipt.findOneAndUpdate(
    { appointmentId: appointment._id },
    {
      $setOnInsert: {
        clientId: client._id,
        appointmentId: appointment._id,
        issuedAt: new Date(),
        amountCad: price,
        invoiceNumber,
        status: "pending_transfer",
      },
    },
    { upsert: true },
  ).catch((e: unknown) => {
    const code = (e as { code?: number })?.code;
    if (code !== 11000) console.error("ClientReceipt pending_transfer:", e);
  });

  // Companion SMS (best-effort): same two options, short Interac block at the end.
  if (client.phone) {
    await sendSessionInvoiceSms(client.phone, {
      invoiceNumber,
      interacReferenceCode,
      amountCad: price,
      payUrl,
      depositEmail,
      supportEmail: platformContact.supportEmail,
      supportPhone: platformContact.phoneNumber,
      lang: clientLocale,
    }).catch((err) => console.error("sendSessionInvoiceSms:", err));
  }
}
