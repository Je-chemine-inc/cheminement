/**
 * What the admin's per-session payer choice (patient file) shows and offers.
 *
 * The client pays by default. The choice used to read « Choisir le payeur »
 * — nothing — on a closed session, and « Selon la couverture » on every
 * upcoming one, even for a client with no coverage while organization billing
 * was off and the client always pays; an admin set « Client » by hand on
 * JC-2026-000014 to be sure (2026-09-11). « Selon la couverture » now appears
 * only when a coverage applies.
 *
 * While organization billing is off, closure ignores any payer chosen ahead
 * (session-payer-plan returns nothing), so an upcoming session offers only the
 * client — choosing « Hors plateforme » there used to be silently overridden
 * by a card charge. After closure the payer can still be changed (the reassign
 * route does not depend on the switch).
 *
 * Pure — no DB.
 */
export type PayerDecisionChoice = "organization" | "client" | "external";
export type PayerOption = "auto" | PayerDecisionChoice;

export function payerChoice(args: {
  closed: boolean;
  /** Who paid, per the closure's payer record; null when there is none. */
  payerKind: PayerDecisionChoice | null;
  /** The payer an admin chose ahead of closure, if any. */
  billingOverride: PayerDecisionChoice | null;
  /** An active coverage exists for this session's beneficiary. */
  coverageApplies: boolean;
  organizationBilling: boolean;
}): { value: PayerOption; options: PayerOption[] } {
  if (args.closed) {
    const value: PayerOption = args.payerKind ?? "client";
    const options: PayerOption[] = args.organizationBilling
      ? ["organization", "client", "external"]
      : ["client", "external"];
    return { value, options: options.includes(value) ? options : [value, ...options] };
  }
  if (!args.organizationBilling) return { value: "client", options: ["client"] };
  const byDefault: PayerOption = args.coverageApplies ? "auto" : "client";
  return {
    value: args.billingOverride ?? byDefault,
    options: args.coverageApplies
      ? ["auto", "organization", "client", "external"]
      : ["organization", "client", "external"],
  };
}

/**
 * What to store for a choice made on an upcoming session: the default stores
 * nothing, so a coverage added later still applies.
 */
export function overrideFor(
  choice: PayerOption,
  coverageApplies: boolean,
): PayerDecisionChoice | null {
  if (choice === "auto") return null;
  if (choice === "client" && !coverageApplies) return null;
  return choice;
}
