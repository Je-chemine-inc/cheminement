/**
 * What an organization's invoice may say about a session (spec 002, Loi 25).
 *
 * The owner approved exactly: the patient's name, the organization's case
 * number, the professional's name, title and licence, the date, the duration
 * and the amount. Nothing else — never the motif, the nature of the act, the
 * therapy type, notes or contact details. `buildInvoiceLine` copies those
 * fields BY NAME from whatever it is handed, so a richer object can never leak
 * a field through a spread. Pure: no DB.
 */
import mongoose from "mongoose";
import type { IOrganizationInvoiceLine } from "@/models/OrganizationInvoice";

export type InvoiceLineSource = {
  appointmentId: mongoose.Types.ObjectId | string;
  coverageId?: mongoose.Types.ObjectId | string | null;
  sessionDate: Date;
  patientFullName: string;
  caseNumber?: string | null;
  professionalName: string;
  professionalTitle?: string | null;
  professionalLicence?: string | null;
  durationMinutes?: number | null;
  amountCents: number;
};

const oid = (v: mongoose.Types.ObjectId | string) =>
  typeof v === "string" ? new mongoose.Types.ObjectId(v) : v;
const clean = (v: string | null | undefined, max = 160) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || undefined;
};

/** The ONLY way a line is made. Field by field — never a spread. */
export function buildInvoiceLine(src: InvoiceLineSource): IOrganizationInvoiceLine {
  if (!Number.isInteger(src.amountCents) || src.amountCents < 0) {
    throw new Error("amountCents must be whole, non-negative cents");
  }
  const line: IOrganizationInvoiceLine = {
    appointmentId: oid(src.appointmentId),
    sessionDate: new Date(src.sessionDate),
    patientFullName: clean(src.patientFullName) ?? "—",
    professionalName: clean(src.professionalName) ?? "—",
    amountCents: src.amountCents,
  };
  if (src.coverageId) line.coverageId = oid(src.coverageId);
  const caseNumber = clean(src.caseNumber, 60);
  if (caseNumber) line.caseNumber = caseNumber;
  const title = clean(src.professionalTitle);
  if (title) line.professionalTitle = title;
  const licence = clean(src.professionalLicence, 60);
  if (licence) line.professionalLicence = licence;
  if (typeof src.durationMinutes === "number" && src.durationMinutes > 0) {
    line.durationMinutes = Math.round(src.durationMinutes);
  }
  return line;
}

/**
 * Whose name goes on the line: the person who received the care. For a loved
 * one booked through a guardian's account that is the loved one, not the
 * account holder.
 */
export function patientNameFor(
  apt: {
    bookingFor?: string | null;
    lovedOneInfo?: { firstName?: string | null; lastName?: string | null } | null;
  },
  client: { firstName?: string | null; lastName?: string | null } | null,
): string {
  const name =
    apt.bookingFor === "loved-one"
      ? `${apt.lovedOneInfo?.firstName ?? ""} ${apt.lovedOneInfo?.lastName ?? ""}`
      : `${client?.firstName ?? ""} ${client?.lastName ?? ""}`;
  return name.trim() || "—";
}

export const sumLineCents = (lines: Pick<IOrganizationInvoiceLine, "amountCents">[]) =>
  lines.reduce((sum, l) => sum + l.amountCents, 0);

/**
 * The consent gate: the lines that may NOT be sent, because the coverage they
 * bill has no consent on record (never given, or withdrawn). An invoice with
 * any such line is not sent — there is no override.
 */
export function blockedLines<T extends Pick<IOrganizationInvoiceLine, "coverageId">>(
  lines: T[],
  consentByCoverage: Map<string, boolean>,
): T[] {
  return lines.filter(
    (l) => !l.coverageId || consentByCoverage.get(String(l.coverageId)) !== true,
  );
}

/**
 * "YYYY-MM" of a session's calendar day. Appointment dates are stored as the
 * calendar day (UTC-noon anchor, or UTC midnight on legacy rows), so the UTC
 * parts ARE the intended day — converting to Toronto time would move a legacy
 * midnight row to the previous day, and possibly the previous month.
 */
export function periodKeyOf(date: Date): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriodKey(v: unknown): v is string {
  return typeof v === "string" && PERIOD_RE.test(v);
}

/** [start, end) of a period, in the same calendar-day convention. */
export function periodBounds(key: string): { start: Date; end: Date } {
  const m = PERIOD_RE.exec(key);
  if (!m) throw new Error(`Invalid period ${key}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)) };
}

/** The month before `now`'s calendar month — what a statement run bills. */
export function previousPeriodKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return periodKeyOf(d);
}
