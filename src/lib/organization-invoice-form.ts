/**
 * The organization's own claim form (spec 002, phase 7) — the pure rules.
 *
 * Some organizations want their own form with each invoice or statement. The
 * admin fills it in by hand and attaches ONE PDF; it goes out with the
 * invoice, under a fixed name. For an organization that requires it, nothing
 * is sent — the hourly auto-send included — until it is attached, unless an
 * admin explicitly sends without it (recorded in the send log).
 *
 * No database here: the invoice service, the serializer and the email all
 * decide with these same functions.
 */
import crypto from "crypto";
import type {
  IOrganizationInvoiceAttachment,
  IOrganizationInvoiceLine,
} from "@/models/OrganizationInvoice";

/** A PDF form, 5 MB at most (the email carries it next to the invoice). */
export const ORG_FORM_MAX_BYTES = 5 * 1024 * 1024;

/** Statuses in which an invoice can still be sent or resent, so its form may change. */
export const ORG_FORM_EDITABLE_STATUSES = ["draft", "issuing", "sent", "overdue", "partially_paid"] as const;

export function isFormEditable(status: string | null | undefined): boolean {
  return (ORG_FORM_EDITABLE_STATUSES as readonly string[]).includes(status ?? "");
}

export function sha256Hex(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

type FingerprintLine = Pick<
  IOrganizationInvoiceLine,
  | "appointmentId"
  | "sessionDate"
  | "patientFullName"
  | "caseNumber"
  | "professionalName"
  | "professionalLicence"
  | "durationMinutes"
  | "amountCents"
>;

/**
 * What the form was filled in from: the sessions, who was seen, by whom, for
 * how long and how much. Order does not matter; the professional's title does
 * not count (a cosmetic change must not make every form stale).
 */
export function linesFingerprint(lines: readonly FingerprintLine[]): string {
  const canonical = lines
    .map((l) => [
      String(l.appointmentId),
      new Date(l.sessionDate).toISOString(),
      l.patientFullName ?? "",
      l.caseNumber ?? "",
      l.professionalName ?? "",
      l.professionalLicence ?? "",
      l.durationMinutes ?? null,
      l.amountCents,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return sha256Hex(JSON.stringify(canonical));
}

/**
 * The name the form goes out under. Never the uploaded name, which may carry
 * a patient's name or an internal note.
 */
export function organizationFormFileName(number: string | null | undefined, lang: "fr" | "en"): string {
  const safe = (number ?? "").replace(/[^A-Za-z0-9-]/g, "");
  if (!safe) return lang === "en" ? "draft-form.pdf" : "brouillon-formulaire.pdf";
  return `${safe}-${lang === "en" ? "form" : "formulaire"}.pdf`;
}

/**
 * The bytes of a stored file as a Buffer. `.lean()` hands back either a Buffer
 * or a BSON Binary (payload under `.buffer`, `.length` a method) — the same
 * trap /api/files/[id] normalizes.
 */
export function storedFileBytes(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw && typeof raw === "object" && "buffer" in raw) {
    return Buffer.from((raw as { buffer: Uint8Array }).buffer);
  }
  return Buffer.from(raw as Uint8Array);
}

export type FormSendDecision =
  | { kind: "attach" }
  | { kind: "none" }
  | { kind: "without" }
  | { kind: "refuse"; code: "OWN_FORM_MISSING" | "OWN_FORM_STALE" };

/**
 * What goes out with this invoice, in this order:
 *   1. the admin chose to send without the form → nothing, and it is recorded;
 *   2. a form is attached and still matches the lines → it goes out;
 *   3. a form is attached but the lines changed since → refused (stale);
 *   4. no form, and the organization requires one → refused (missing);
 *   5. otherwise → the invoice alone.
 */
export function decideFormForSend(args: {
  requiresOwnForm: boolean;
  attachment: Pick<IOrganizationInvoiceAttachment, "linesFingerprint"> | null | undefined;
  lines: readonly FingerprintLine[];
  withoutOwnForm?: boolean;
}): FormSendDecision {
  const attached = Boolean(args.attachment);
  if (args.withoutOwnForm && (args.requiresOwnForm || attached)) return { kind: "without" };
  if (args.attachment) {
    return args.attachment.linesFingerprint === linesFingerprint(args.lines)
      ? { kind: "attach" }
      : { kind: "refuse", code: "OWN_FORM_STALE" };
  }
  if (args.requiresOwnForm) return { kind: "refuse", code: "OWN_FORM_MISSING" };
  return { kind: "none" };
}
