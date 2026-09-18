import { ORG_BILLING_CONSENT_VERSION } from "@/models/OrganizationCoverage";
import { isDayKey, isSlotTime } from "@/lib/available-slots";
import {
  isDirectRequestService,
  type DirectRequestService,
} from "@/lib/direct-request-rules";

/**
 * Which appointment fields a caller is allowed to set — one allow-list per route.
 *
 * Three routes used to write the request body straight into the appointment:
 *
 *   - POST /api/appointments         `new Appointment(data)` with the whole body
 *   - POST /api/appointments/guest   `{ ...appointmentData }` spread into the doc
 *   - PATCH /api/appointments/[id]   `findByIdAndUpdate(id, data)`, unfiltered
 *
 * So a client could book with `payment: { status: "paid" }` — nothing is charged
 * at closure and an official receipt is emailed for a session never paid — or
 * PATCH `{ "$set": { "payment.status": "paid" } }`, or overwrite the
 * professional's session notes. Each route now copies ONLY the fields its real
 * callers send (inventoried 2026-09-11 from every caller in the app). Anything
 * else is dropped and logged, so a legitimate caller that was missed shows up in
 * the logs instead of silently gaining write access.
 *
 * These are allow-lists on purpose: a field added to the Appointment model later
 * is not writable through these routes until someone decides it should be.
 */

/**
 * What the booking funnel (`src/app/appointment/page.tsx`) sends. Money, state
 * and scheduling fields are never in this list: the routes compute them
 * server-side.
 *
 * `professionalId`, `date`, `time` and `duration` used to be kept for booking
 * straight into a professional's slot. No screen ever sent them, and through the
 * guest route anyone could attach any professional to a request as already
 * accepted, with no hold on the time. A request for a professional's slot now
 * arrives as `direct` (see parseDirectIntent), and the route checks, holds and
 * proposes it itself (spec 003 phase 3).
 */
export const BOOKING_INTAKE_FIELDS = [
  "type",
  "therapyType",
  "issueType",
  "needs",
  "reason",
  "notes",
  "bookingFor",
  "preferredAvailability",
  "preferredPaymentMethod",
  "paymentMethod",
  "notificationLocale",
  "changeProfessional",
  "emergency",
  "isEmergency",
  "lovedOneInfo",
  "linkGuardian",
  "guardianUserId",
  "referralInfo",
] as const;

/**
 * Spec 002: the client says a third party pays (employer, PAE, school…). The
 * funnel sends `thirdPartyPayer: { organizationName, caseNumber?, consent }`;
 * the server builds the stored `payerDeclaration` itself — its status, date and
 * consent version are never taken from the browser, and `payerDeclaration`
 * sent directly is dropped like any other non-intake field. Without the consent
 * box ticked there is no declaration: the organization may not be billed.
 */
export function buildPayerDeclaration(
  value: unknown,
  now: Date = new Date(),
): {
  organizationName: string;
  caseNumber?: string;
  consentGiven: true;
  consentTextVersion: string;
  declaredAt: Date;
  source: "client_booking";
  status: "pending";
} | null {
  if (!isPlainObject(value)) return null;
  const name =
    typeof value.organizationName === "string" ? value.organizationName.trim().slice(0, 120) : "";
  if (name.length < 2 || value.consent !== true) return null;
  const caseNumber =
    typeof value.caseNumber === "string" ? value.caseNumber.trim().slice(0, 60) : "";
  return {
    organizationName: name,
    ...(caseNumber ? { caseNumber } : {}),
    consentGiven: true,
    consentTextVersion: ORG_BILLING_CONSENT_VERSION,
    declaredAt: now,
    source: "client_booking",
    status: "pending",
  };
}

/** A request for one professional's slot, from their showcase page (spec 003). */
export interface DirectIntent {
  slug: string;
  service: DirectRequestService;
  /** Montréal calendar day, "YYYY-MM-DD". */
  date: string;
  /** Montréal wall-clock start, "HH:mm". */
  time: string;
  /** The client ticked « send my request to the general list » (phase 3b); absent unless ticked. */
  fallbackToGeneral?: true;
}

const SHOWCASE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The funnel sends `direct: { slug, service, date, time }` when the visitor
 * chose a time on a showcase page. Only the shape is checked here; the route
 * re-checks the time against the professional's free slots and holds it.
 * Absent is fine (an ordinary request); present but malformed is refused.
 */
export function parseDirectIntent(
  value: unknown,
): { ok: true; intent: DirectIntent | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, intent: null };
  if (!isPlainObject(value)) return { ok: false };
  const { slug, service, date, time, fallbackToGeneral } = value;
  if (
    typeof slug !== "string" ||
    slug.length > 80 ||
    !SHOWCASE_SLUG.test(slug) ||
    !isDirectRequestService(service) ||
    !isDayKey(date) ||
    !isSlotTime(time)
  ) {
    return { ok: false };
  }
  // Only an explicit true is consent; anything else is its absence (phase 3b).
  return { ok: true, intent: { slug, service, date, time, ...(fallbackToGeneral === true ? { fallbackToGeneral: true as const } : {}) } };
}

/** Payment methods a client may pick at booking. Never "manual" — that one means
 *  "settled by an admin" and skips every charge. */
export const CLIENT_CHOOSABLE_PAYMENT_METHODS = [
  "card",
  "transfer",
  "direct_debit",
] as const;

/** What the professional screens send through PATCH /api/appointments/[id]:
 *  status changes, rescheduling, the meeting link, session notes, cancellation. */
const STAFF_PATCH_FIELDS = [
  "status",
  "date",
  "time",
  "meetingLink",
  "notes",
  "cancelReason",
] as const;

/** A client (or their guardian) only ever cancels through this route — see
 *  CancelAppointmentDialog. Confirming uses its own `/confirm` route. */
const CLIENT_PATCH_FIELDS = ["status", "cancelReason"] as const;
const CLIENT_SETTABLE_STATUSES = new Set(["cancelled"]);

export type AppointmentWriterRole = "client" | "professional" | "admin";

/** Maps a session role onto the three writer kinds this module knows. */
export function toWriterRole(role: string | undefined): AppointmentWriterRole {
  if (role === "admin") return "admin";
  if (role === "professional") return "professional";
  return "client";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** A MongoDB update operator (`$set`) or a dotted path (`payment.status`) at the
 *  top level of a body. Neither is ever legitimate from a browser. */
function isPathOrOperatorKey(key: string): boolean {
  return key.startsWith("$") || key.includes(".");
}

/**
 * Keep only the booking-intake fields. Works for both booking routes; the result
 * keeps the input's type so the long route handlers read it exactly as before.
 */
export function pickBookingIntake<T extends object>(
  body: T,
): { data: Partial<T>; dropped: string[] } {
  if (!isPlainObject(body)) return { data: {}, dropped: [] };
  const allowed = new Set<string>(BOOKING_INTAKE_FIELDS);
  const data: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === "thirdPartyPayer") {
      const declaration = buildPayerDeclaration(value);
      if (declaration) data.payerDeclaration = declaration;
      else if (value !== null && value !== undefined) dropped.push(key);
      continue;
    }
    // Read by parseDirectIntent, never copied into the appointment.
    if (key === "direct") continue;
    if (allowed.has(key) && !isPathOrOperatorKey(key)) data[key] = value;
    else dropped.push(key);
  }
  if (
    data.paymentMethod !== undefined &&
    !(CLIENT_CHOOSABLE_PAYMENT_METHODS as readonly unknown[]).includes(
      data.paymentMethod,
    )
  ) {
    delete data.paymentMethod;
    dropped.push("paymentMethod");
  }
  return { data: data as Partial<T>, dropped };
}

type StaffPatchField = (typeof STAFF_PATCH_FIELDS)[number];

/** The narrowed PATCH body: only these keys, only string or null values. */
export type AppointmentPatchInput = Partial<Record<StaffPatchField, string | null>>;

export type AppointmentPatchResult =
  | { ok: true; data: AppointmentPatchInput; dropped: string[] }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Validate and narrow a PATCH /api/appointments/[id] body for this caller.
 * Unknown fields are dropped; operator keys, dotted paths and non-string values
 * are refused outright, as is a client trying to set any status but "cancelled".
 */
export function pickAppointmentPatch(
  body: unknown,
  role: AppointmentWriterRole,
): AppointmentPatchResult {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, error: "Invalid request body" };
  }
  const allowed = new Set<string>(
    role === "client" ? CLIENT_PATCH_FIELDS : STAFF_PATCH_FIELDS,
  );
  const data: Record<string, string | null> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (isPathOrOperatorKey(key)) {
      return { ok: false, status: 400, error: `Field not allowed: ${key}` };
    }
    if (!allowed.has(key)) {
      dropped.push(key);
      continue;
    }
    if (value !== null && typeof value !== "string") {
      return { ok: false, status: 400, error: `Invalid value for ${key}` };
    }
    data[key] = value;
  }

  if (
    role === "client" &&
    data.status !== undefined &&
    !CLIENT_SETTABLE_STATUSES.has(String(data.status))
  ) {
    return {
      ok: false,
      status: 403,
      error: "Clients can only cancel an appointment through this route.",
    };
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: "No updatable fields in request" };
  }
  // Every key in `data` passed the allow-list above, so it is a StaffPatchField.
  return { ok: true, data: data as AppointmentPatchInput, dropped };
}
