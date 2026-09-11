/**
 * Change who pays for an already-closed session (spec 002) — how an admin
 * resolves a session held for a payer decision, or corrects a wrong one.
 *
 * It recomputes with the same resolver as closure, so an admin's decision can
 * never produce amounts closure would not. It refuses anything that would need
 * money moved first: a client payment already made (refund it), or a session
 * already on an organization invoice (void it). The professional's ledger is
 * never rewritten — a change in what they are owed becomes an ADJUSTMENT row,
 * because each session's original credit is unique per appointment.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import ClientReceipt from "@/models/ClientReceipt";
import { stripe } from "@/lib/stripe";
import {
  beneficiaryKeyOf,
  findApplicableCoverage,
  hasConsent,
  releaseCoverageSlot,
  reserveCoverageSlot,
  toCoverageTerms,
  toOrgTerms,
} from "@/lib/organization-coverage";
import {
  resolveSessionPayers,
  wouldConsumeCapSlot,
  type PayerPlan,
  type SessionOutcome,
} from "@/lib/third-party-billing";
import { toThirdPartyBillingSnapshot } from "@/lib/session-payer-plan";
import { runSessionClosureSideEffects } from "@/lib/session-post-closure";
import { fromCents, toCents } from "@/lib/money-cents";
import { cycleKeyFromDateOrNow } from "@/lib/ledger-cycle";

export type PayerDecision = "organization" | "client" | "external";
export const PAYER_DECISIONS: readonly PayerDecision[] = [
  "organization",
  "client",
  "external",
];

/** Client payment states where money already moved: refund before reassigning. */
const CLIENT_MONEY_MOVED = ["paid", "processing", "refunded", "partially_refunded"];

export type ReassignResult =
  | { ok: true; plan: PayerPlan; ledgerAdjustmentCents: number }
  | { ok: false; status: 404 | 409; code: string; error: string };

const refuse = (
  status: 404 | 409,
  code: string,
  error: string,
): ReassignResult => ({ ok: false, status, code, error });

export async function reassignSessionPayer(args: {
  appointmentId: string;
  decision: PayerDecision;
  adminUserId: string;
  note?: string;
  now?: Date;
}): Promise<ReassignResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();

  const apt = await Appointment.findById(args.appointmentId).select(
    "+thirdPartyBilling +billingOverride",
  );
  if (!apt) return refuse(404, "NOT_FOUND", "Appointment not found");

  if (!apt.sessionCompletedAt) {
    return refuse(
      409,
      "NOT_CLOSED",
      "This session is not closed yet — set the payer for the session instead.",
    );
  }
  const outcome = apt.sessionOutcome as SessionOutcome | undefined;
  if (!outcome) return refuse(409, "NOT_CLOSED", "This session has no outcome.");
  if (outcome !== "completed" && args.decision !== "client") {
    return refuse(
      409,
      "LATE_OR_NO_SHOW_IS_CLIENTS",
      "A late cancellation or a no-show is always billed to the client.",
    );
  }
  if (CLIENT_MONEY_MOVED.includes(apt.payment?.status)) {
    return refuse(
      409,
      "CLIENT_ALREADY_PAID",
      "The client has already paid this session. Refund them before changing the payer.",
    );
  }
  const previous = apt.thirdPartyBilling;
  if (previous?.orgInvoiceId) {
    return refuse(
      409,
      "ON_ORGANIZATION_INVOICE",
      "This session is on an organization invoice. Void that invoice first.",
    );
  }

  const coverage = await findApplicableCoverage({
    clientId: apt.clientId,
    beneficiaryKey: beneficiaryKeyOf(apt),
    appointmentId: apt._id,
    sessionDate: apt.date ? new Date(apt.date) : now,
  });
  const org = coverage ? await Organization.findById(coverage.organizationId) : null;
  if (args.decision === "organization") {
    if (!coverage) {
      return refuse(409, "NO_COVERAGE", "Attach a coverage to this client first.");
    }
    if (!org || !org.active) {
      return refuse(409, "NO_ACTIVE_ORGANIZATION", "The coverage's organization is archived.");
    }
    if (!hasConsent(coverage)) {
      return refuse(
        409,
        "CONSENT_MISSING",
        "Record the client's consent before billing the organization (Loi 25).",
      );
    }
  }

  // Same inputs closure used: the billed list price and the professional share.
  const listPriceCents =
    previous?.listPriceCents ??
    toCents(apt.payment?.listPrice ?? apt.payment?.price ?? 0);
  const proShareRatio =
    previous && previous.proBasisCents > 0
      ? previous.proPayoutTotalCents / previous.proBasisCents
      : apt.payment?.price > 0
        ? (apt.payment.professionalPayout ?? 0) / apt.payment.price
        : 0;

  const base = {
    outcome,
    listPriceCents,
    proShareRatio,
    coverage: coverage ? toCoverageTerms(coverage) : null,
    org: org ? toOrgTerms(org) : null,
    override: args.decision,
    declarationPending: false,
  };

  const aptId = String(apt._id);
  const holdsSlot =
    !!coverage &&
    coverage.consumedAppointmentIds.some((id) => String(id) === aptId);
  const needsSlot = !!coverage && wouldConsumeCapSlot(base);
  let reservedNow = false;
  if (needsSlot && !holdsSlot) {
    const reservation = await reserveCoverageSlot(coverage!._id, apt._id);
    if (!reservation.granted) {
      return refuse(409, "CAP_REACHED", "This coverage has used all its sessions.");
    }
    reservedNow = true;
  }

  const plan = resolveSessionPayers({
    ...base,
    capSlot: needsSlot ? "granted" : "not_needed",
  });

  const snapshot = {
    ...toThirdPartyBillingSnapshot(
      plan,
      {
        organizationId: org ? String(org._id) : null,
        coverageId: coverage ? String(coverage._id) : null,
        caseNumber: coverage?.caseNumber ?? null,
      },
      now,
    ),
    resolvedAt: now,
    resolvedBy: new mongoose.Types.ObjectId(args.adminUserId),
  };

  const $set: Record<string, unknown> = {
    "payment.price": fromCents(plan.client.priceCents),
    "payment.platformFee": fromCents(plan.client.platformFeeCents),
    "payment.professionalPayout": fromCents(plan.client.professionalPayoutCents),
    "payment.status": plan.clientPaymentStatus,
    thirdPartyBilling: snapshot,
    billingOverride: {
      payer: args.decision,
      setBy: new mongoose.Types.ObjectId(args.adminUserId),
      setAt: now,
      ...(args.note ? { note: args.note.slice(0, 500) } : {}),
    },
  };
  if (plan.kind === "external") {
    $set["payment.method"] = "manual";
    $set["payment.paidAt"] = now;
  }

  // Conditional on nothing having changed since we read it — a double click or
  // a concurrent payment must not apply twice or over a payment.
  const filter: Record<string, unknown> = {
    _id: apt._id,
    sessionCompletedAt: { $ne: null },
    "payment.status": { $nin: CLIENT_MONEY_MOVED },
    "thirdPartyBilling.orgInvoiceId": { $exists: false },
  };
  if (previous?.plannedAt) {
    filter["thirdPartyBilling.plannedAt"] = previous.plannedAt;
  } else {
    filter.thirdPartyBilling = { $exists: false };
  }
  const res = await Appointment.updateOne(filter, { $set });
  if (res.modifiedCount !== 1) {
    if (reservedNow) await releaseCoverageSlot(coverage!._id, apt._id, now);
    return refuse(409, "CHANGED_MEANWHILE", "This session changed meanwhile — reload and try again.");
  }

  // The session no longer uses the cap slot it held.
  if (holdsSlot && !plan.consumesCapSlot) {
    await releaseCoverageSlot(coverage!._id, apt._id, now);
  }

  // What the client owes changed: an open card payment for the old amount must
  // not still go through (a /pay tab left open), and the Interac tracking row
  // carries the old amount — the side effects below recreate both as needed.
  const clientChanged =
    plan.client.priceCents !== toCents(apt.payment?.price ?? 0) ||
    plan.clientPaymentStatus !== apt.payment?.status;
  if (clientChanged) {
    const piId = apt.payment?.stripePaymentIntentId;
    if (piId) {
      await stripe.paymentIntents.cancel(piId).catch((e: unknown) => {
        // Already succeeded/cancelled: the status guard above caught "paid";
        // anything else is logged for a human.
        console.warn("[reassign-payer] could not cancel", piId, e);
      });
    }
    await ClientReceipt.deleteOne({
      appointmentId: apt._id,
      status: "pending_transfer",
    });
  }

  // What the professional is owed may have changed (e.g. "paid on the org rate").
  // Each session's original credit is unique, so a change is an adjustment row;
  // with no original credit, the side effects below write the full one.
  const hasCredit = apt.professionalId
    ? !!(await ProfessionalLedgerEntry.exists({ appointmentId: apt._id }))
    : true;
  const previousProCents = previous
    ? previous.proPayoutTotalCents
    : toCents(apt.payment?.professionalPayout ?? 0);
  const deltaCents = plan.proPayoutTotalCents - previousProCents;
  let ledgerAdjustmentCents = 0;
  if (deltaCents !== 0 && apt.professionalId && hasCredit) {
    await ProfessionalLedgerEntry.create({
      professionalId: apt.professionalId,
      entryKind: "credit",
      cycleKey: cycleKeyFromDateOrNow(now),
      adjustsAppointmentId: apt._id,
      grossAmountCad: 0,
      platformFeeCad: 0,
      netToProfessionalCad: fromCents(deltaCents),
      paymentChannel: "none",
      note: `Payeur modifié : ${args.decision}`,
    });
    ledgerAdjustmentCents = deltaCents;
  }

  // Only when the client's side changed (or the credit is missing): the side
  // effects send the client a payment request — or, for an external session,
  // their receipt — and re-choosing the same payer must not email them again.
  if (clientChanged || !hasCredit) {
    await runSessionClosureSideEffects(aptId).catch((e) =>
      console.error("[reassign-payer] side effects:", e),
    );
  }

  return { ok: true, plan, ledgerAdjustmentCents };
}
