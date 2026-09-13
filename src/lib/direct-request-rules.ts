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
