/**
 * Match incoming Interac e-Transfer notifications to invoices, and settle the
 * ones that match exactly.
 *
 * The pieces already existed and were never joined up: the on-box IMAP fetcher
 * stores every mail from `paiement@jechemine.ca` as an inbound ExternalMessage,
 * `payment.interacReferenceCode` is an indexed per-appointment key, and
 * `settleInteracPayment` is the same idempotent path the admin's "marquer comme
 * payé" button uses. Nothing read the notifications, so every transfer was
 * reconciled by hand.
 *
 * Safety properties, in order of importance:
 *   - Only mail genuinely FROM @payments.interac.ca is considered. A body is
 *     forgeable; the sender is the gate (see interac-notification.ts).
 *   - A transfer settles only on an EXACT amount match against a named,
 *     unsettled session. Everything else is left for a human, with the reason.
 *   - Every notification is processed at most once, keyed on the stored
 *     Message-Id, so a re-run of the 5-minute cron can never double-settle.
 *   - The outcome is written back onto the ExternalMessage, so the admin
 *     Réception panel shows what happened to each transfer and why.
 */
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import ExternalMessage from "@/models/ExternalMessage";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import {
  isOrganizationInvoiceReference,
  parseInteracNotification,
  type ParsedInteracNotification,
} from "@/lib/interac-notification";
import {
  decideInteracReconciliation,
  decideOrganizationInteracReconciliation,
  type ReconciliationReason,
} from "@/lib/interac-reconciliation";
import { settleInteracPayment } from "@/lib/payment-settlement";
import { recordReceivedOrganizationMoney } from "@/lib/organization-invoice-settlement";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back to look. The fetcher re-sends a rolling window, and the
 * processed-marker below makes re-runs free, so this only bounds the first run
 * after deploy.
 */
const LOOKBACK_DAYS = 30;

export interface ReconciliationRun {
  examined: number;
  settled: number;
  review: number;
  skipped: number;
  outcomes: Array<{
    messageId?: string;
    reason: ReconciliationReason;
    amountCad: number;
    referenceCode: string | null;
    appointmentId?: string;
    organizationInvoiceId?: string;
  }>;
}

/**
 * A transfer naming an organization invoice (JCO-…, spec 002). Settles only on
 * the exact balance, through the same recorder as a card payment, keyed on
 * Interac's own transfer reference so it can never count twice.
 */
async function reconcileOrganizationTransfer(
  parsed: ParsedInteracNotification,
  msg: { _id: unknown; emailMessageId?: string },
  run: ReconciliationRun,
): Promise<void> {
  const invoice = await OrganizationInvoice.findOne({ number: parsed.referenceCode })
    .select("_id number status balanceCents")
    .lean();
  const decision = decideOrganizationInteracReconciliation(
    { amountCad: parsed.amountCad, referenceCode: parsed.referenceCode, payerName: parsed.payerName },
    invoice
      ? { number: invoice.number ?? "", status: invoice.status, balanceCents: invoice.balanceCents }
      : null,
  );

  if (decision.action === "settle" && invoice) {
    const recorded = await recordReceivedOrganizationMoney({
      invoiceId: String(invoice._id),
      amountCents: Math.round(parsed.amountCad * 100),
      method: "interac",
      source: "interac_reconciler",
      externalRef: `interac:${parsed.interacTransactionRef ?? msg.emailMessageId ?? String(msg._id)}`,
      reference: parsed.interacTransactionRef ?? undefined,
    });
    // A race (a cheque recorded a moment ago) still records the money, but a
    // person is asked to look — count it where it belongs.
    if (recorded.outcome === "applied") run.settled++;
    else run.review++;
    console.log(
      `[interac-reconciler] settled ${parsed.referenceCode} — ${decision.detail} (${recorded.outcome})`,
    );
  } else {
    run.review++;
    console.warn(`[interac-reconciler] review (${decision.reason}): ${decision.detail}`);
  }

  run.outcomes.push({
    messageId: msg.emailMessageId,
    reason: decision.reason,
    amountCad: parsed.amountCad,
    referenceCode: parsed.referenceCode,
    organizationInvoiceId: invoice ? String(invoice._id) : undefined,
  });
  await markProcessed(msg._id, {
    reason: decision.reason,
    action: decision.action,
    detail: decision.detail,
    amount: String(parsed.amountCad),
    reference: parsed.referenceCode ?? "",
    interacRef: parsed.interacTransactionRef ?? "",
    organizationInvoiceId: invoice ? String(invoice._id) : "",
  });
}

export async function runInteracReconciliation(
  nowMs: number = Date.now(),
): Promise<ReconciliationRun> {
  await connectToDatabase();

  const since = new Date(nowMs - LOOKBACK_DAYS * DAY_MS);

  const notifications = await ExternalMessage.find({
    source: "email",
    direction: "inbound",
    senderEmail: /@payments\.interac\.ca$/i,
    createdAt: { $gte: since },
    // Never look at one twice: the marker is written for EVERY outcome below.
    "metadata.interacReconciledAt": { $exists: false },
  })
    .sort({ createdAt: 1 })
    .limit(200);

  const run: ReconciliationRun = {
    examined: notifications.length,
    settled: 0,
    review: 0,
    skipped: 0,
    outcomes: [],
  };

  for (const msg of notifications) {
    const parsed = parseInteracNotification({
      from: msg.senderEmail,
      subject: msg.subject,
      text: msg.message,
    });

    if (!parsed) {
      // Interac sends more than deposit advices (declines, reminders). Mark it
      // seen so we don't re-parse it forever, but count it apart.
      run.skipped++;
      await markProcessed(msg._id, { reason: "unparsed" });
      continue;
    }

    if (isOrganizationInvoiceReference(parsed.referenceCode)) {
      await reconcileOrganizationTransfer(parsed, msg, run);
      continue;
    }

    const appointment = parsed.referenceCode
      ? await Appointment.findOne({
          "payment.interacReferenceCode": parsed.referenceCode,
        })
      : null;

    const decision = decideInteracReconciliation(
      {
        amountCad: parsed.amountCad,
        referenceCode: parsed.referenceCode,
        payerName: parsed.payerName,
      },
      appointment
        ? {
            paymentStatus: appointment.payment?.status,
            priceCad: appointment.payment?.price,
            appointmentStatus: appointment.status,
          }
        : null,
    );

    if (decision.action === "settle" && appointment) {
      await settleInteracPayment(String(appointment._id), {
        payerName: parsed.payerName ?? undefined,
        note: `${decision.detail} Réf. Interac ${parsed.interacTransactionRef ?? "—"}.`,
      });
      run.settled++;
      console.log(
        `[interac-reconciler] settled ${parsed.referenceCode} — ${decision.detail}`,
      );
    } else {
      run.review++;
      console.warn(
        `[interac-reconciler] review (${decision.reason}): ${decision.detail}`,
      );
    }

    run.outcomes.push({
      messageId: msg.emailMessageId,
      reason: decision.reason,
      amountCad: parsed.amountCad,
      referenceCode: parsed.referenceCode,
      appointmentId: appointment ? String(appointment._id) : undefined,
    });

    await markProcessed(msg._id, {
      reason: decision.reason,
      action: decision.action,
      detail: decision.detail,
      amount: String(parsed.amountCad),
      reference: parsed.referenceCode ?? "",
      interacRef: parsed.interacTransactionRef ?? "",
      appointmentId: appointment ? String(appointment._id) : "",
    });
  }

  return run;
}

/**
 * Stamp the outcome onto the notification. This is BOTH the idempotency marker
 * and the admin's audit trail — a transfer left for review carries the reason
 * it was not settled.
 */
async function markProcessed(
  id: unknown,
  fields: Record<string, string>,
): Promise<void> {
  const $set: Record<string, string> = {
    "metadata.interacReconciledAt": new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(fields)) {
    $set[`metadata.interac_${k}`] = v;
  }
  await ExternalMessage.findByIdAndUpdate(id, { $set }).catch((err) =>
    console.error("[interac-reconciler] failed to mark processed:", err),
  );
}
