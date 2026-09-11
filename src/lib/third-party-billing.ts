/**
 * Who pays for a closed session — the client, an organization, or someone
 * outside the platform — and how much each side owes.
 *
 * This is the ONE place that decision is made (spec 002). It is pure: no models,
 * no Stripe, integer cents only. The closure route gathers the facts (coverage,
 * organization terms, admin override, cap slot) and applies the plan it returns.
 *
 * Money model:
 *   - `client` is what goes on `Appointment.payment` — the client's account.
 *   - `org` is what the organization is invoiced.
 *   - `clinicAbsorbedCents` is list price nobody is billed for (a rate gap the
 *     clinic chose to absorb); `clinicSurplusCents` is what an organization pays
 *     ABOVE list price (the clinic keeps it).
 *   - Invariant: client + org + absorbed − surplus = the billed list price.
 *   - The professional is paid on `proBasisCents` at the stored share ratio,
 *     split across the two sides in proportion to what each pays, so each side
 *     keeps `price = platformFee + professionalPayout`.
 *
 * A side's platform fee can be negative only on the organization side, and only
 * under "clinic absorbs, professional paid in full": the clinic pays the
 * professional more than the organization pays the clinic. That is a real
 * negative margin the owner chose; the admin form warns about it.
 */

export type SessionOutcome =
  | "completed"
  | "cancelled_48h_plus"
  | "cancelled_late"
  | "no_show";

export type CoverageMode = "full" | "split" | "per_session" | "external";

export type GapPolicy =
  | "client_copay"
  | "clinic_absorbs_pro_full"
  | "clinic_absorbs_pro_org_rate";

export type PayerOverride = "organization" | "client" | "external";

export type CapSlot = "not_needed" | "granted" | "denied";

export interface CoverageTerms {
  id: string;
  mode: CoverageMode;
  split?: { type: "fixed" | "percent"; value: number } | null;
  /** Rate agreed for this patient specifically; beats the organization's rate. */
  rateCentsOverride?: number | null;
  /** Recorded, not withdrawn (Loi 25). Without it nothing may be disclosed. */
  consentGiven: boolean;
  /** The coverage has a session cap (maxSessions). */
  hasCap: boolean;
  caseNumber?: string | null;
}

export interface OrgTerms {
  id: string;
  name: string;
  negotiatedRateCents?: number | null;
  gapPolicy: GapPolicy;
}

export interface PayerInput {
  outcome: SessionOutcome;
  /** Full list price of the session, in cents, before the outcome fraction. */
  listPriceCents: number;
  /** Professional share at booking: storedPayout / storedPrice, in [0, 1]. */
  proShareRatio: number;
  coverage: CoverageTerms | null;
  org: OrgTerms | null;
  override: PayerOverride | null;
  /** The client declared a payer at booking and no admin has decided yet. */
  declarationPending: boolean;
  /** Result of reserving a cap slot, when one was needed. */
  capSlot: CapSlot;
}

export type PayerReason =
  | "free_cancellation"
  | "late_or_no_show"
  | "client_override"
  | "no_coverage"
  | "external"
  | "cap_exhausted"
  | "consent_missing"
  | "declaration_pending"
  | "per_session_undecided"
  | "organization_without_coverage"
  | "org_full"
  | "org_split"
  | "org_rate_gap"
  | "org_rate_above_list";

export interface SideAmounts {
  priceCents: number;
  platformFeeCents: number;
  professionalPayoutCents: number;
}

export interface PayerPlan {
  kind: "client" | "organization" | "external";
  /** "awaiting_decision": nothing is charged or invoiced until an admin decides. */
  state: "confirmed" | "awaiting_decision";
  reason: PayerReason;
  client: SideAmounts;
  org: SideAmounts;
  clinicAbsorbedCents: number;
  clinicSurplusCents: number;
  proBasisCents: number;
  proPayoutTotalCents: number;
  platformFeeTotalCents: number;
  consumesCapSlot: boolean;
  /** What `Appointment.payment.status` becomes at closure. */
  clientPaymentStatus: "pending" | "covered" | "paid" | "cancelled";
  /** Set for external: the client side is recorded as settled by hand. */
  clientPaymentMethod?: "manual";
  /** Printed on the client's receipt for external sessions. */
  externalPayerLabel?: string;
  gapPolicy?: GapPolicy;
}

const EXTERNAL_FALLBACK_LABEL = "Hors plateforme";

/** Share of the list price billed for each outcome (mirrors session-closure). */
function billingFraction(outcome: SessionOutcome): 0 | 1 {
  return outcome === "cancelled_48h_plus" ? 0 : 1;
}

function isLateOrNoShow(outcome: SessionOutcome): boolean {
  return outcome === "cancelled_late" || outcome === "no_show";
}

/**
 * Split the professional's total across the two paying sides in proportion to
 * what each pays. Rounding lands on the organization side so the client side —
 * which is `Appointment.payment` — always keeps a non-negative fee.
 */
function buildPlan(args: {
  kind: PayerPlan["kind"];
  state?: PayerPlan["state"];
  reason: PayerReason;
  clientCents: number;
  orgCents: number;
  absorbedCents?: number;
  surplusCents?: number;
  proBasisCents: number;
  proShareRatio: number;
  consumesCapSlot: boolean;
  clientPaymentStatus: PayerPlan["clientPaymentStatus"];
  clientPaymentMethod?: "manual";
  externalPayerLabel?: string;
  gapPolicy?: GapPolicy;
}): PayerPlan {
  const ratio = Math.min(1, Math.max(0, args.proShareRatio));
  const proTotal = Math.round(args.proBasisCents * ratio);
  const billed = args.clientCents + args.orgCents;
  const clientPayout =
    billed > 0 ? Math.round((proTotal * args.clientCents) / billed) : 0;
  const orgPayout = proTotal - clientPayout;

  return {
    kind: args.kind,
    state: args.state ?? "confirmed",
    reason: args.reason,
    client: {
      priceCents: args.clientCents,
      professionalPayoutCents: clientPayout,
      platformFeeCents: args.clientCents - clientPayout,
    },
    org: {
      priceCents: args.orgCents,
      professionalPayoutCents: orgPayout,
      platformFeeCents: args.orgCents - orgPayout,
    },
    clinicAbsorbedCents: args.absorbedCents ?? 0,
    clinicSurplusCents: args.surplusCents ?? 0,
    proBasisCents: args.proBasisCents,
    proPayoutTotalCents: proTotal,
    platformFeeTotalCents: billed - proTotal,
    consumesCapSlot: args.consumesCapSlot,
    clientPaymentStatus: args.clientPaymentStatus,
    ...(args.clientPaymentMethod
      ? { clientPaymentMethod: args.clientPaymentMethod }
      : {}),
    ...(args.externalPayerLabel
      ? { externalPayerLabel: args.externalPayerLabel }
      : {}),
    ...(args.gapPolicy ? { gapPolicy: args.gapPolicy } : {}),
  };
}

/** The whole session billed to the client — today's behaviour. */
function clientPlan(
  input: PayerInput,
  billedCents: number,
  reason: PayerReason,
): PayerPlan {
  return buildPlan({
    kind: "client",
    reason,
    clientCents: billedCents,
    orgCents: 0,
    proBasisCents: billedCents,
    proShareRatio: input.proShareRatio,
    consumesCapSlot: false,
    clientPaymentStatus: billedCents > 0 ? "pending" : "cancelled",
  });
}

/**
 * What the organization and the client each owe when the organization pays,
 * from the coverage mode, the negotiated rate and the organization's gap policy.
 */
function organizationAmounts(
  listCents: number,
  coverage: CoverageTerms | null,
  org: OrgTerms | null,
): {
  orgCents: number;
  clientCents: number;
  absorbedCents: number;
  surplusCents: number;
  proBasisCents: number;
  reason: PayerReason;
  gapPolicy?: GapPolicy;
} {
  if (coverage?.mode === "split" && coverage.split) {
    const { type, value } = coverage.split;
    const orgCents =
      type === "fixed"
        ? Math.min(Math.max(0, Math.round(value)), listCents)
        : Math.round((listCents * Math.min(100, Math.max(0, value))) / 100);
    return {
      orgCents,
      clientCents: listCents - orgCents,
      absorbedCents: 0,
      surplusCents: 0,
      proBasisCents: listCents,
      reason: "org_split",
    };
  }

  const rate =
    coverage?.rateCentsOverride ?? org?.negotiatedRateCents ?? listCents;
  const rateCents = Math.max(0, Math.round(rate));

  if (rateCents === listCents) {
    return {
      orgCents: listCents,
      clientCents: 0,
      absorbedCents: 0,
      surplusCents: 0,
      proBasisCents: listCents,
      reason: "org_full",
    };
  }

  if (rateCents > listCents) {
    // Owner's rule: bill the organization its rate, pay the professional on
    // the normal price, the clinic keeps the difference.
    return {
      orgCents: rateCents,
      clientCents: 0,
      absorbedCents: 0,
      surplusCents: rateCents - listCents,
      proBasisCents: listCents,
      reason: "org_rate_above_list",
    };
  }

  const gap = listCents - rateCents;
  const gapPolicy = org?.gapPolicy ?? "client_copay";
  switch (gapPolicy) {
    case "client_copay":
      return {
        orgCents: rateCents,
        clientCents: gap,
        absorbedCents: 0,
        surplusCents: 0,
        proBasisCents: listCents,
        reason: "org_rate_gap",
        gapPolicy,
      };
    case "clinic_absorbs_pro_full":
      return {
        orgCents: rateCents,
        clientCents: 0,
        absorbedCents: gap,
        surplusCents: 0,
        proBasisCents: listCents,
        reason: "org_rate_gap",
        gapPolicy,
      };
    case "clinic_absorbs_pro_org_rate":
      return {
        orgCents: rateCents,
        clientCents: 0,
        absorbedCents: gap,
        surplusCents: 0,
        proBasisCents: rateCents,
        reason: "org_rate_gap",
        gapPolicy,
      };
  }
}

/**
 * Would this session take one of the coverage's capped slots? Asked BEFORE
 * reserving, so the caller only reserves when the answer is yes.
 */
export function wouldConsumeCapSlot(
  input: Omit<PayerInput, "capSlot">,
): boolean {
  if (!input.coverage?.hasCap) return false;
  if (billingFraction(input.outcome) === 0 || isLateOrNoShow(input.outcome)) {
    return false;
  }
  if (input.override === "client") return false;
  const mode = input.override === "external" ? "external" : input.coverage.mode;
  if (mode === "per_session" && input.override !== "organization") {
    // Undecided per-session sessions don't hold a slot until an admin decides.
    return false;
  }
  return true;
}

export function resolveSessionPayers(input: PayerInput): PayerPlan {
  const listCents = Math.max(0, Math.round(input.listPriceCents));
  const billedCents = listCents * billingFraction(input.outcome);

  // 1. Free cancellation: nothing is owed by anyone.
  if (billedCents === 0) {
    return clientPlan(input, 0, "free_cancellation");
  }

  // 2. Late cancellation / no-show: always the client, whatever the coverage.
  if (isLateOrNoShow(input.outcome)) {
    return clientPlan(input, billedCents, "late_or_no_show");
  }

  // 3. An admin decided this one is the client's.
  if (input.override === "client") {
    return clientPlan(input, billedCents, "client_override");
  }

  const { coverage, org } = input;
  const capped = wouldConsumeCapSlot(input);
  if (capped && input.capSlot === "denied") {
    return clientPlan(input, billedCents, "cap_exhausted");
  }

  // 4. Settled outside the platform: recorded as paid, receipt to the client.
  const external =
    input.override === "external" ||
    (input.override === null && coverage?.mode === "external");
  if (external) {
    return buildPlan({
      kind: "external",
      reason: "external",
      clientCents: billedCents,
      orgCents: 0,
      proBasisCents: billedCents,
      proShareRatio: input.proShareRatio,
      consumesCapSlot: capped,
      clientPaymentStatus: "paid",
      clientPaymentMethod: "manual",
      externalPayerLabel: org?.name?.trim() || EXTERNAL_FALLBACK_LABEL,
    });
  }

  // 5. Nobody has decided yet: hold. Nothing is charged; the professional is
  //    credited provisionally on the full price (the organization side stands
  //    in for "to be decided") and an admin is alerted.
  const awaiting = (reason: PayerReason): PayerPlan =>
    buildPlan({
      kind: "organization",
      state: "awaiting_decision",
      reason,
      clientCents: 0,
      orgCents: billedCents,
      proBasisCents: billedCents,
      proShareRatio: input.proShareRatio,
      consumesCapSlot: capped,
      clientPaymentStatus: "covered",
    });

  if (!coverage) {
    if (input.override === "organization") {
      return awaiting("organization_without_coverage");
    }
    if (input.declarationPending) return awaiting("declaration_pending");
    return clientPlan(input, billedCents, "no_coverage");
  }

  if (coverage.mode === "per_session" && input.override !== "organization") {
    return awaiting("per_session_undecided");
  }
  if (!coverage.consentGiven) {
    return awaiting("consent_missing");
  }

  // 6. The organization pays, by its terms.
  const split = organizationAmounts(billedCents, coverage, org);
  return buildPlan({
    kind: "organization",
    reason: split.reason,
    clientCents: split.clientCents,
    orgCents: split.orgCents,
    absorbedCents: split.absorbedCents,
    surplusCents: split.surplusCents,
    proBasisCents: split.proBasisCents,
    proShareRatio: input.proShareRatio,
    consumesCapSlot: capped,
    clientPaymentStatus: split.clientCents > 0 ? "pending" : "covered",
    ...(split.gapPolicy ? { gapPolicy: split.gapPolicy } : {}),
  });
}
