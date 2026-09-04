/**
 * Code unique par rendez-vous, lié au professionnel (suffixe) pour le message Interac.
 */
export function buildInteracReferenceCode(
  appointmentId: string,
  professionalId: string | undefined,
): string {
  const p = (professionalId ?? "000000000000000000000000")
    .replace(/[^a-f0-9]/gi, "")
    .slice(-4)
    .toUpperCase()
    .padStart(4, "0");
  const a = appointmentId
    .replace(/[^a-f0-9]/gi, "")
    .slice(-6)
    .toUpperCase()
    .padStart(6, "0");
  return `INT-${p}-${a}`;
}

/**
 * The ONE reference a client is ever asked to write on an Interac transfer,
 * for a given appointment — before the session and after it.
 *
 * There used to be two. The pre-session instructions named this INT- code,
 * while the post-session invoice named the fiscal invoice number, so the same
 * appointment had two different "mandatory" references depending on when the
 * client happened to pay. Nothing could match a transfer automatically, and a
 * client reading both emails had no way to know which one counted.
 *
 * The INT- code is the one that can be unified onto, because it exists from the
 * moment Interac is chosen. The invoice number cannot: `nextInvoiceNumber` is a
 * gap-free fiscal counter allocated at closure, and handing one out for a
 * session that may never happen would punch holes in the sequence.
 *
 * Falls back to deriving the code, because it is a pure function of the
 * appointment: an appointment that never went through the Interac flow still
 * gets the same, stable reference the stored one would have been.
 */
/**
 * The id of a Mongoose ref that may or may not be populated.
 *
 * Every caller of the resolver below loads the appointment with
 * `.populate("professionalId", ...)`, so `appointment.professionalId` is a
 * DOCUMENT, not an ObjectId. Calling `.toString()` on it yields the document,
 * not the hex id — which would have produced a different reference at those
 * call sites than the one `request-transfer-guarantee` stores (it reads
 * `proDoc._id`), quietly re-creating the very two-codes problem this unifies.
 */
function refIdOf(ref: unknown): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === "string") return ref;
  const withId = ref as { _id?: unknown };
  if (withId._id) return String(withId._id);
  // A bare ObjectId stringifies to its hex; anything else is unusable.
  const asString = String(ref);
  return /^[a-f0-9]{24}$/i.test(asString) ? asString : undefined;
}
export function resolveInteracReferenceCode(
  stored: string | null | undefined,
  appointmentId: string,
  /** Accepts an id, an ObjectId, or a POPULATED professional document. */
  professionalRef: unknown,
): string {
  const existing = typeof stored === "string" ? stored.trim() : "";
  if (existing) return existing;
  return buildInteracReferenceCode(appointmentId, refIdOf(professionalRef));
}
