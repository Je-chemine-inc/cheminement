/**
 * The cancellation rule clients are held to, in one place: the appointment
 * route enforces it and the showcase pages state it (spec 003).
 *
 * A client may cancel for free until this many hours before the session.
 * Inside that window self-cancellation is refused, and a late cancellation or
 * a no-show recorded at closure is billed (see `getBillingFraction` in
 * session-closure.ts).
 *
 * ⚠ `PlatformSettings.cancellationPolicy` (24 h / 100 %, editable in
 * Admin → Settings) is read by nothing — see the debt-map. Changing it there
 * changes nothing; changing this constant changes both the rule and the text.
 */
export const FREE_CANCELLATION_HOURS = 48;
