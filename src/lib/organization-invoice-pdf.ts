import "server-only";
import jsPDF from "jspdf";
import { formatCanadianPhone } from "@/lib/format-platform-contact";
import type { IOrganizationInvoiceLine } from "@/models/OrganizationInvoice";

/**
 * The invoice or statement an organization receives (spec 002).
 *
 * Its input type is the disclosure boundary: it has NO field for the motif, the
 * nature of the act, the therapy type or any note, so there is nothing to print
 * even by mistake. Lines are read field by field, never spread.
 */
export type OrganizationInvoicePdfLine = Pick<
  IOrganizationInvoiceLine,
  | "sessionDate"
  | "patientFullName"
  | "caseNumber"
  | "professionalName"
  | "professionalTitle"
  | "professionalLicence"
  | "durationMinutes"
  | "amountCents"
>;

export type OrganizationInvoicePdfInput = {
  language: "fr" | "en";
  kind: "session" | "statement";
  number: string;
  issuedAt: Date;
  dueAt?: Date | null;
  periodLabel?: string | null;
  billTo: { name: string; contactName?: string | null; addressLines?: string[] };
  platform: {
    name: string;
    addressLines: string[];
    phone?: string | null;
    email?: string | null;
  };
  lines: OrganizationInvoicePdfLine[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** Interac deposit address; the invoice number is the transfer note. */
  interacEmail?: string | null;
  printedNote?: string | null;
};

const T = {
  fr: {
    invoice: "FACTURE",
    statement: "RELEVÉ DE FACTURATION",
    number: "N°",
    issued: "Date d’émission",
    due: "Échéance",
    period: "Période",
    billTo: "Facturé à",
    attention: "À l’attention de",
    date: "Date",
    patient: "Client (dossier)",
    professional: "Professionnel",
    duration: "Durée",
    amount: "Montant",
    total: "Total",
    paid: "Payé",
    balance: "Solde dû",
    minutes: "min",
    licence: "permis",
    payTitle: "Paiement",
    payInterac: (email: string, ref: string) =>
      `Virement Interac à ${email} — indiquez « ${ref} » en message.`,
    payCheque: (name: string) => `Chèque à l’ordre de ${name}, en indiquant le numéro de facture.`,
    confidential:
      "Document confidentiel. Les renseignements personnels ci-dessus sont transmis avec le consentement du client, aux seules fins de facturation.",
    page: (n: number, of: number) => `Page ${n} / ${of}`,
  },
  en: {
    invoice: "INVOICE",
    statement: "BILLING STATEMENT",
    number: "No.",
    issued: "Issue date",
    due: "Due date",
    period: "Period",
    billTo: "Bill to",
    attention: "Attention",
    date: "Date",
    patient: "Client (case)",
    professional: "Professional",
    duration: "Length",
    amount: "Amount",
    total: "Total",
    paid: "Paid",
    balance: "Balance due",
    minutes: "min",
    licence: "licence",
    payTitle: "Payment",
    payInterac: (email: string, ref: string) =>
      `Interac e-Transfer to ${email} — write “${ref}” as the message.`,
    payCheque: (name: string) => `Cheque payable to ${name}, quoting the invoice number.`,
    confidential:
      "Confidential. The personal information above is shared with the client’s consent, for billing purposes only.",
    page: (n: number, of: number) => `Page ${n} of ${of}`,
  },
} as const;

export function formatMoney(cents: number, lang: "fr" | "en"): string {
  const v = (cents / 100).toFixed(2);
  return lang === "fr" ? `${v.replace(".", ",")} $` : `$${v}`;
}

/** A session's calendar day (stored UTC-anchored) as the day it says. */
export function formatDay(date: Date, lang: "fr" | "en"): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatDateTime(date: Date, lang: "fr" | "en"): string {
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export function buildOrganizationInvoicePdfBuffer(input: OrganizationInvoicePdfInput): Buffer {
  const t = T[input.language];
  const lang = input.language;
  const doc = new jsPDF();
  const text: [number, number, number] = [31, 41, 55];
  const gray: [number, number, number] = [107, 114, 128];
  const light: [number, number, number] = [243, 244, 246];
  const M = 20;
  const RIGHT = 190;

  // Header: logo (or name) left, platform block right.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const logo = fs.readFileSync(path.join(process.cwd(), "public", "Logo.png"));
    const w = logo.readUInt32BE(16);
    const h = logo.readUInt32BE(20);
    doc.addImage(`data:image/png;base64,${logo.toString("base64")}`, "PNG", M, 9, h > 0 ? Math.round((12 * w) / h) : 60, 12);
  } catch {
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...text);
    doc.text(input.platform.name, M, 18);
  }
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  let y = 10;
  for (const line of [
    input.platform.name,
    ...input.platform.addressLines,
    ...(input.platform.phone ? [formatCanadianPhone(input.platform.phone) || input.platform.phone] : []),
    ...(input.platform.email ? [input.platform.email] : []),
  ]) {
    doc.text(line, RIGHT, y, { align: "right" });
    y += 4;
  }

  // Title and references.
  y = Math.max(y, 30) + 6;
  doc.setDrawColor(...light);
  doc.line(M, y - 4, RIGHT, y - 4);
  doc.setTextColor(...text);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(input.kind === "statement" ? t.statement : t.invoice, M, y + 4);
  doc.setFontSize(10);
  doc.text(`${t.number} ${input.number}`, RIGHT, y + 4, { align: "right" });
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const refs: Array<[string, string]> = [[t.issued, formatDateTime(input.issuedAt, lang)]];
  if (input.dueAt) refs.push([t.due, formatDateTime(input.dueAt, lang)]);
  if (input.periodLabel) refs.push([t.period, input.periodLabel]);
  for (const [label, value] of refs) {
    doc.setTextColor(...gray);
    doc.text(`${label} :`, 120, y);
    doc.setTextColor(...text);
    doc.text(value, RIGHT, y, { align: "right" });
    y += 5;
  }

  // Bill to.
  let by = y - 5 * refs.length;
  doc.setTextColor(...gray);
  doc.text(t.billTo, M, by);
  by += 5;
  doc.setTextColor(...text);
  doc.setFont("helvetica", "bold");
  doc.text(input.billTo.name, M, by);
  doc.setFont("helvetica", "normal");
  by += 5;
  if (input.billTo.contactName) {
    doc.text(`${t.attention} : ${input.billTo.contactName}`, M, by);
    by += 5;
  }
  for (const line of input.billTo.addressLines ?? []) {
    doc.text(line, M, by);
    by += 5;
  }
  y = Math.max(y, by) + 6;

  // Lines table.
  const COLS = { date: M, patient: M + 26, pro: M + 82, dur: 158, amount: RIGHT };
  const header = () => {
    doc.setFillColor(...light);
    doc.rect(M - 2, y - 5, RIGHT - M + 4, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...text);
    doc.text(t.date, COLS.date, y);
    doc.text(t.patient, COLS.patient, y);
    doc.text(t.professional, COLS.pro, y);
    doc.text(t.duration, COLS.dur, y, { align: "right" });
    doc.text(t.amount, COLS.amount, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 8;
  };
  header();
  const sorted = [...input.lines].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime(),
  );
  for (const line of sorted) {
    const patient = doc.splitTextToSize(
      line.caseNumber ? `${line.patientFullName} (${line.caseNumber})` : line.patientFullName,
      54,
    ) as string[];
    const proParts = [line.professionalName];
    if (line.professionalTitle) proParts.push(line.professionalTitle);
    if (line.professionalLicence) proParts.push(`${t.licence} ${line.professionalLicence}`);
    const pro = doc.splitTextToSize(proParts.join(", "), 52) as string[];
    const rows = Math.max(patient.length, pro.length);
    if (y + rows * 4.5 > 262) {
      doc.addPage();
      y = 24;
      header();
    }
    doc.setFontSize(8.5);
    doc.setTextColor(...text);
    doc.text(formatDay(line.sessionDate, lang), COLS.date, y);
    doc.text(patient, COLS.patient, y);
    doc.text(pro, COLS.pro, y);
    doc.text(line.durationMinutes ? `${line.durationMinutes} ${t.minutes}` : "—", COLS.dur, y, { align: "right" });
    doc.text(formatMoney(line.amountCents, lang), COLS.amount, y, { align: "right" });
    y += rows * 4.5 + 2;
    doc.setDrawColor(...light);
    doc.line(M, y - 3, RIGHT, y - 3);
  }

  // Totals.
  if (y > 240) {
    doc.addPage();
    y = 24;
  }
  y += 4;
  doc.setFontSize(10);
  const totals: Array<[string, number, boolean]> = [[t.total, input.totalCents, false]];
  if (input.paidCents > 0) totals.push([t.paid, input.paidCents, false]);
  totals.push([t.balance, input.balanceCents, true]);
  for (const [label, cents, bold] of totals) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, 140, y);
    doc.text(formatMoney(cents, lang), RIGHT, y, { align: "right" });
    y += 6;
  }

  // Payment instructions.
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(t.payTitle, M, y);
  doc.setFont("helvetica", "normal");
  y += 5;
  const payLines = [
    ...(input.interacEmail ? [t.payInterac(input.interacEmail, input.number)] : []),
    t.payCheque(input.platform.name),
  ];
  for (const p of payLines) {
    const wrapped = doc.splitTextToSize(p, RIGHT - M) as string[];
    doc.text(wrapped, M, y);
    y += wrapped.length * 4.5;
  }
  if (input.printedNote) {
    y += 3;
    const wrapped = doc.splitTextToSize(input.printedNote, RIGHT - M) as string[];
    doc.text(wrapped, M, y);
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...gray);
    doc.text(doc.splitTextToSize(t.confidential, RIGHT - M - 30) as string[], M, 284);
    doc.text(t.page(p, pages), RIGHT, 284, { align: "right" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
