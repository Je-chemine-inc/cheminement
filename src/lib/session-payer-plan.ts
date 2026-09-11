/**
 * Gathers the facts `resolveSessionPayers` needs for one closing session, and
 * reserves a coverage cap slot when one is needed (spec 002).
 *
 * Returns null — meaning "run today's closure maths, untouched" — when the
 * feature flag is off, or when nothing about the session involves a third
 * party: no coverage, no admin override, no pending payer declaration.
 *
 * Called by complete-session AFTER the atomic closure claim and BEFORE any card
 * charge. If the closure later fails, the caller must give back a reserved slot
 * with `releaseCoverageSlot` (see `reservedSlot`).
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment, { type IThirdPartyBilling } from "@/models/Appointment";
import Organization from "@/models/Organization";
import PlatformSettings from "@/models/PlatformSettings";
import {
  beneficiaryKeyOf,
  findApplicableCoverage,
  releaseCoverageSlot,
  reserveCoverageSlot,
  toCoverageTerms,
  toOrgTerms,
} from "@/lib/organization-coverage";
import {
  resolveSessionPayers,
  wouldConsumeCapSlot,
  type CapSlot,
  type PayerOverride,
  type PayerPlan,
  type SessionOutcome,
} from "@/lib/third-party-billing";

export async function isOrganizationBillingEnabled(): Promise<boolean> {
  const settings = await PlatformSettings.findOne()
    .select("organizationBillingEnabled")
    .lean();
  return settings?.organizationBillingEnabled === true;
}

export interface PlannedPayers {
  plan: PayerPlan;
  /** The server-only snapshot to $set as `thirdPartyBilling`. */
  snapshot: IThirdPartyBilling;
  coverageId?: string;
  /** A cap slot was taken for this closure — give it back if closure fails. */
  reservedSlot: boolean;
  /** This closure took the coverage's LAST slot. */
  slotExhaustedNow: boolean;
}

/** The resolver's plan, as the record stored on the appointment. */
export function toThirdPartyBillingSnapshot(
  plan: PayerPlan,
  refs: {
    organizationId?: string | null;
    coverageId?: string | null;
    caseNumber?: string | null;
  },
  now: Date,
): IThirdPartyBilling {
  const oid = (id?: string | null) =>
    id ? new mongoose.Types.ObjectId(id) : undefined;
  return {
    kind: plan.kind,
    state: plan.state,
    reason: plan.reason,
    organizationId: oid(refs.organizationId),
    coverageId: oid(refs.coverageId),
    caseNumber: refs.caseNumber ?? undefined,
    externalPayerLabel: plan.externalPayerLabel,
    listPriceCents:
      plan.client.priceCents +
      plan.org.priceCents +
      plan.clinicAbsorbedCents -
      plan.clinicSurplusCents,
    orgAmountCents: plan.org.priceCents,
    clientAmountCents: plan.client.priceCents,
    clinicAbsorbedCents: plan.clinicAbsorbedCents,
    clinicSurplusCents: plan.clinicSurplusCents,
    proBasisCents: plan.proBasisCents,
    proPayoutTotalCents: plan.proPayoutTotalCents,
    platformFeeTotalCents: plan.platformFeeTotalCents,
    orgProfessionalPayoutCents: plan.org.professionalPayoutCents,
    orgPlatformFeeCents: plan.org.platformFeeCents,
    gapPolicy: plan.gapPolicy,
    consumedCapSlot: plan.consumesCapSlot,
    orgStatus: "unbilled",
    plannedAt: now,
  };
}

export async function planSessionPayers(args: {
  appointmentId: string;
  outcome: SessionOutcome;
  listPriceCents: number;
  proShareRatio: number;
  now: Date;
}): Promise<PlannedPayers | null> {
  await connectToDatabase();
  if (!(await isOrganizationBillingEnabled())) return null;

  // billingOverride is `select: false` on the schema — ask for it by name.
  const apt = await Appointment.findById(args.appointmentId)
    .select("+billingOverride payerDeclaration bookingFor lovedOneInfo clientId date")
    .lean();
  if (!apt) return null;

  const override = (apt.billingOverride?.payer ?? null) as PayerOverride | null;
  const declarationPending = apt.payerDeclaration?.status === "pending";

  let coverage = await findApplicableCoverage({
    clientId: apt.clientId,
    beneficiaryKey: beneficiaryKeyOf(apt),
    appointmentId: args.appointmentId,
    sessionDate: apt.date ? new Date(apt.date) : args.now,
  });

  if (!coverage && !override && !declarationPending) return null;

  // A coverage whose organization is gone or archived cannot be invoiced.
  // Hold the session for an admin rather than guess.
  let org = coverage ? await Organization.findById(coverage.organizationId) : null;
  let effectiveOverride = override;
  if (coverage && (!org || !org.active)) {
    coverage = null;
    org = null;
    if (effectiveOverride !== "client" && effectiveOverride !== "external") {
      effectiveOverride = "organization";
    }
  }

  const base = {
    outcome: args.outcome,
    listPriceCents: args.listPriceCents,
    proShareRatio: args.proShareRatio,
    coverage: coverage ? toCoverageTerms(coverage) : null,
    org: org ? toOrgTerms(org) : null,
    override: effectiveOverride,
    declarationPending,
  };

  let capSlot: CapSlot = "not_needed";
  let reservedSlot = false;
  let slotExhaustedNow = false;
  if (coverage && wouldConsumeCapSlot(base)) {
    const reservation = await reserveCoverageSlot(coverage._id, args.appointmentId);
    capSlot = reservation.granted ? "granted" : "denied";
    if (reservation.granted) {
      reservedSlot = true;
      slotExhaustedNow = reservation.exhaustedNow;
    }
  }

  const plan = resolveSessionPayers({ ...base, capSlot });

  // Defensive: never hold a slot the plan does not use.
  if (reservedSlot && !plan.consumesCapSlot && coverage) {
    await releaseCoverageSlot(coverage._id, args.appointmentId, args.now);
    reservedSlot = false;
    slotExhaustedNow = false;
  }

  return {
    plan,
    snapshot: toThirdPartyBillingSnapshot(
      plan,
      {
        organizationId: org ? String(org._id) : null,
        coverageId: coverage ? String(coverage._id) : null,
        caseNumber: coverage?.caseNumber ?? null,
      },
      args.now,
    ),
    coverageId: coverage ? String(coverage._id) : undefined,
    reservedSlot,
    slotExhaustedNow,
  };
}
