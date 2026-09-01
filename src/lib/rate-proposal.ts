/**
 * Rules for professional rate-change proposals.
 *
 * A proposal is a request, not a change: submitting one never touches
 * `Profile.rates`. Only an admin acceptance does, and only for future bookings —
 * existing appointments are re-priced separately and deliberately
 * (`/api/admin/appointments/[id]/reprice`).
 */
import { roundMoney } from "@/lib/session-closure";
import { THERAPY_TYPES, type TherapyType } from "@/lib/professional-pricing";

const MAX_RATE = 100_000;
const MAX_NOTE = 1000;

export type ProposalRefusal =
  | "INVALID_THERAPY_TYPE"
  | "INVALID_RATE"
  | "RATE_EXCEEDS_CLIENT_PRICE"
  | "NOTE_TOO_LONG"
  | "ALREADY_PENDING"
  | "NOT_PENDING";

export interface ParsedProposal {
  therapyType: TherapyType;
  proposedRate: number;
  note?: string;
}

/**
 * Validate a professional's submission.
 *
 * `clientPrice` is the effective client price for that therapy type. A proposal
 * above it is refused up front rather than accepted and then found unacceptable
 * — the platform can never pay out more than it collects, so such a request
 * could never be granted and it is kinder to say so immediately.
 */
export function parseProposal(
  input: unknown,
  clientPrice: number | undefined,
): { ok: true; proposal: ParsedProposal } | { ok: false; reason: ProposalRefusal } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "INVALID_THERAPY_TYPE" };
  }

  const { therapyType, proposedRate, note } = input as Record<string, unknown>;

  if (
    typeof therapyType !== "string" ||
    !(THERAPY_TYPES as readonly string[]).includes(therapyType)
  ) {
    return { ok: false, reason: "INVALID_THERAPY_TYPE" };
  }

  const raw =
    typeof proposedRate === "string" ? Number(proposedRate) : proposedRate;
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < 0 ||
    raw > MAX_RATE
  ) {
    return { ok: false, reason: "INVALID_RATE" };
  }
  const rate = roundMoney(raw);

  if (typeof clientPrice === "number" && rate > clientPrice) {
    return { ok: false, reason: "RATE_EXCEEDS_CLIENT_PRICE" };
  }

  if (note !== undefined && note !== null) {
    if (typeof note !== "string") return { ok: false, reason: "NOTE_TOO_LONG" };
    if (note.length > MAX_NOTE) return { ok: false, reason: "NOTE_TOO_LONG" };
  }

  return {
    ok: true,
    proposal: {
      therapyType: therapyType as TherapyType,
      proposedRate: rate,
      note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    },
  };
}

/** Only a pending proposal can be decided; re-deciding one is refused. */
export function canDecide(
  proposal: { status?: string } | null,
): { ok: true } | { ok: false; reason: ProposalRefusal } {
  if (!proposal || proposal.status !== "pending") {
    return { ok: false, reason: "NOT_PENDING" };
  }
  return { ok: true };
}

/**
 * The `$set` an acceptance writes to the professional's profile.
 *
 * Only `professionalRate` — accepting a proposal must never touch the client
 * price, which is the platform's to set.
 */
export function acceptanceSetPaths(
  therapyType: TherapyType,
  proposedRate: number,
): Record<string, number> {
  return { [`rates.${therapyType}.professionalRate`]: proposedRate };
}
