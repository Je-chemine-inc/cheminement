/**
 * Rules of a direct request (spec 003 phase 3): a client asks one professional
 * for one slot from the professional's page, the slot is held, and the
 * professional confirms or declines. Pure and client-safe.
 */

export const DIRECT_REQUEST_SERVICES = ["standard", "quick"] as const;
export type DirectRequestService = (typeof DIRECT_REQUEST_SERVICES)[number];

/** How long the professional has to answer, from the request. */
export const DIRECT_REQUEST_RESPONSE_HOURS: Readonly<Record<DirectRequestService, number>> = {
  standard: 24,
  quick: 12,
};

/** The answer is due at least this long before the slot starts. */
export const DIRECT_REQUEST_LAST_ANSWER_BEFORE_START_MINUTES = 60;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * When the professional must have answered: 24 hours after the request (12
 * for a quick consultation), and never later than one hour before the slot.
 * Null when that moment has already passed — the slot is too close to ask.
 */
export function directRequestDeadline(input: {
  now: Date;
  startsAt: Date;
  service: DirectRequestService;
}): Date | null {
  const window = input.now.getTime() + DIRECT_REQUEST_RESPONSE_HOURS[input.service] * HOUR_MS;
  const latest = input.startsAt.getTime() - DIRECT_REQUEST_LAST_ANSWER_BEFORE_START_MINUTES * MINUTE_MS;
  const deadline = Math.min(window, latest);
  return deadline > input.now.getTime() ? new Date(deadline) : null;
}

export function isDirectRequestService(value: unknown): value is DirectRequestService {
  return typeof value === "string" && (DIRECT_REQUEST_SERVICES as readonly string[]).includes(value);
}

/**
 * Where a request stands. Only "pending" holds the slot and bypasses the
 * matcher; "rerouted" hands the request back to the ordinary matching.
 */
export const DIRECT_REQUEST_STATES = ["pending", "accepted", "declined", "expired", "withdrawn", "rerouted"] as const;
export type DirectRequestState = (typeof DIRECT_REQUEST_STATES)[number];

/** Why a professional declines. */
export const DIRECT_REQUEST_DECLINE_REASONS = ["slot_unavailable", "not_a_fit", "not_accepting", "other"] as const;
export type DirectRequestDeclineReason = (typeof DIRECT_REQUEST_DECLINE_REASONS)[number];

export function isDirectRequestDeclineReason(value: unknown): value is DirectRequestDeclineReason {
  return typeof value === "string" && (DIRECT_REQUEST_DECLINE_REASONS as readonly string[]).includes(value);
}

/**
 * Whether the matcher should stop proposing this client to the professional:
 * yes when they said the client is not for them or they take no one new, or
 * let the request lapse — not when only the time did not suit.
 */
export function directRequestExcludesProfessional(
  outcome: "declined" | "expired",
  reason?: DirectRequestDeclineReason,
): boolean {
  return outcome === "expired" || reason === "not_a_fit" || reason === "not_accepting";
}

/** How long the "let Je chemine match me" link in the client's email stays valid. */
export const DIRECT_REQUEST_REROUTE_TOKEN_DAYS = 14;

/** The longest note a professional can add when declining. */
export const DIRECT_REQUEST_DECLINE_NOTE_MAX = 500;

/** What the booking routes answer when a showcase request cannot be made. */
export const DIRECT_REQUEST_ERROR_MESSAGES = {
  INVALID_DIRECT_REQUEST: "Invalid direct request",
  SHOWCASE_NOT_FOUND: "This professional's page is not available",
  SERVICE_UNAVAILABLE: "This consultation is not offered right now",
  SLOT_TAKEN: "This time is no longer available",
} as const;
export type DirectRequestErrorCode = keyof typeof DIRECT_REQUEST_ERROR_MESSAGES;
