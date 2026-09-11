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
 * What the booking funnel (`src/app/appointment/page.tsx`) sends. `professionalId`,
 * `date`, `time` and `duration` are kept because the guest route deliberately
 * supports booking straight into a professional's slot, with its own existence
 * and availability checks. Money and state fields are never in this list: the
 * routes compute them server-side.
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
  "professionalId",
  "date",
  "time",
  "duration",
] as const;

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
