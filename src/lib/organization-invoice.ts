/**
 * Organization invoices and statements (spec 002, phase 4) — the first time
 * data about a patient leaves the platform.
 *
 * Life of an invoice:
 *   draft   → lines built from closed, organization-paid sessions. Drafts may
 *             overlap; nothing is reserved and no number is used.
 *   issuing → claimed atomically; the sessions are reserved (one invoice per
 *             session, ever, while it is not void) and a JCO- number is taken.
 *   sent    → the PDF reached at least one billing address. `sendLog` records
 *             every disclosure (Loi 25).
 *   partially_paid / paid, or void (sessions released, number kept).
 *
 * Nothing is sent without the client's consent on every line (`blockedLines`),
 * and there is no override.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization, { type IOrganization } from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import OrganizationInvoice, { type IOrganizationInvoice } from "@/models/OrganizationInvoice";
import Profile from "@/models/Profile";
import {
  blockedLines,
  buildInvoiceLine,
  patientNameFor,
  periodBounds,
  sumLineCents,
} from "@/lib/organization-invoice-lines";
import { nextOrganizationInvoiceNumber } from "@/lib/invoice-number";
import { buildOrganizationInvoicePdfBuffer } from "@/lib/organization-invoice-pdf";
import { getPlatformContactInfo } from "@/lib/platform-contact";
import { formatStandardAddressBlock } from "@/lib/format-platform-contact";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { sendOrganizationInvoiceEmail } from "@/lib/notifications";

export type InvoiceResult<T = IOrganizationInvoice> =
  | { ok: true; invoice: T }
  | {
      ok: false;
      status: 400 | 404 | 409 | 502;
      code: string;
      error: string;
      details?: unknown;
    };

const refuse = (
  status: 400 | 404 | 409 | 502,
  code: string,
  error: string,
  details?: unknown,
): { ok: false; status: 400 | 404 | 409 | 502; code: string; error: string; details?: unknown } => ({
  ok: false,
  status,
  code,
  error,
  ...(details === undefined ? {} : { details }),
});

/** Closed sessions an organization owes for and nobody has invoiced yet. */
export function billableSessionsFilter(
  organizationId: mongoose.Types.ObjectId | string,
  range?: { start: Date; end: Date },
): Record<string, unknown> {
  return {
    sessionCompletedAt: { $ne: null },
    "thirdPartyBilling.organizationId": new mongoose.Types.ObjectId(String(organizationId)),
    "thirdPartyBilling.kind": "organization",
    "thirdPartyBilling.state": "confirmed",
    "thirdPartyBilling.orgStatus": "unbilled",
    "thirdPartyBilling.orgAmountCents": { $gt: 0 },
    "thirdPartyBilling.orgInvoiceId": { $exists: false },
    ...(range ? { date: { $gte: range.start, $lt: range.end } } : {}),
  };
}

type PopulatedPerson = { _id: unknown; firstName?: string; lastName?: string } | null;

/** Build the lines for these sessions — the allow-listed fields only. */
async function linesFor(filter: Record<string, unknown>) {
  const sessions = await Appointment.find(filter)
    .select("+thirdPartyBilling date duration bookingFor lovedOneInfo.firstName lovedOneInfo.lastName clientId professionalId")
    .populate("clientId", "firstName lastName")
    .populate("professionalId", "firstName lastName")
    .sort({ date: 1 })
    .lean();
  const proIds = sessions
    .map((s) => (s.professionalId as unknown as PopulatedPerson)?._id)
    .filter(Boolean);
  const profiles = await Profile.find({ userId: { $in: proIds } })
    .select("userId license specialty")
    .lean();
  const profileOf = new Map(profiles.map((p) => [String(p.userId), p]));

  return sessions.map((s) => {
    const pro = s.professionalId as unknown as PopulatedPerson;
    const profile = pro ? profileOf.get(String(pro._id)) : undefined;
    const tpb = s.thirdPartyBilling!;
    return buildInvoiceLine({
      appointmentId: s._id as mongoose.Types.ObjectId,
      coverageId: tpb.coverageId ?? null,
      sessionDate: s.date as Date,
      patientFullName: patientNameFor(s, s.clientId as unknown as PopulatedPerson),
      caseNumber: tpb.caseNumber ?? null,
      professionalName: pro ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}` : "—",
      professionalTitle: profile?.specialty ?? null,
      professionalLicence: profile?.license ?? null,
      durationMinutes: s.duration,
      amountCents: tpb.orgAmountCents,
    });
  });
}

/** Create or rebuild a DRAFT. Returns null when there is nothing to bill. */
async function upsertDraft(args: {
  draftKey: string;
  kind: "session" | "statement";
  organizationId: mongoose.Types.ObjectId;
  filter: Record<string, unknown>;
  period?: { key: string; start: Date; end: Date };
}): Promise<InvoiceResult | null> {
  const lines = await linesFor(args.filter);
  if (lines.length === 0) {
    // An emptied draft (sessions reassigned meanwhile) is simply dropped.
    await OrganizationInvoice.deleteOne({ draftKey: args.draftKey, status: "draft" });
    return null;
  }
  const total = sumLineCents(lines);
  try {
    const invoice = await OrganizationInvoice.findOneAndUpdate(
      { draftKey: args.draftKey, status: "draft" },
      {
        $set: {
          lines,
          totalCents: total,
          paidCents: 0,
          balanceCents: total,
          ...(args.period
            ? { periodKey: args.period.key, periodStart: args.period.start, periodEnd: args.period.end }
            : {}),
        },
        $setOnInsert: {
          draftKey: args.draftKey,
          kind: args.kind,
          organizationId: args.organizationId,
          status: "draft",
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    return { ok: true, invoice: invoice! };
  } catch (e) {
    // The key is taken by an invoice that already left the draft state.
    if ((e as { code?: number })?.code === 11000) {
      return refuse(409, "ALREADY_ISSUED", "An invoice for this was already issued.");
    }
    throw e;
  }
}

/** A draft invoice for one closed session. */
export async function draftForSession(appointmentId: string): Promise<InvoiceResult | null> {
  await connectToDatabase();
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return refuse(400, "INVALID_ID", "Invalid appointment id");
  }
  const apt = await Appointment.findById(appointmentId).select("+thirdPartyBilling").lean();
  const orgId = apt?.thirdPartyBilling?.organizationId;
  if (!apt || !orgId) return refuse(404, "NOT_BILLABLE", "No organization pays for this session.");
  return upsertDraft({
    draftKey: `session:${appointmentId}`,
    kind: "session",
    organizationId: orgId,
    filter: { ...billableSessionsFilter(orgId), _id: apt._id },
  });
}

/** A draft statement: every unbilled session of the organization in that month. */
export async function draftStatement(
  organizationId: string,
  periodKey: string,
): Promise<InvoiceResult | null> {
  await connectToDatabase();
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    return refuse(400, "INVALID_ID", "Invalid organization id");
  }
  const { start, end } = periodBounds(periodKey);
  return upsertDraft({
    draftKey: `statement:${organizationId}:${periodKey}`,
    kind: "statement",
    organizationId: new mongoose.Types.ObjectId(organizationId),
    filter: billableSessionsFilter(organizationId, { start, end }),
    period: { key: periodKey, start, end },
  });
}

/** One draft per unbilled session of an organization. Returns how many exist now. */
export async function draftSessionsForOrganization(organizationId: string): Promise<number> {
  await connectToDatabase();
  if (!mongoose.Types.ObjectId.isValid(organizationId)) return 0;
  const sessions = await Appointment.find(billableSessionsFilter(organizationId)).select("_id").lean();
  let drafted = 0;
  for (const s of sessions) {
    const r = await draftForSession(String(s._id));
    if (r?.ok) drafted += 1;
  }
  return drafted;
}

/** Rebuild a draft from the sessions as they are now. */
export async function refreshDraft(invoiceId: string): Promise<InvoiceResult | null> {
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(invoiceId).lean();
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  if (inv.status !== "draft") return refuse(409, "NOT_A_DRAFT", "Only a draft can be refreshed.");
  if (inv.kind === "session") {
    const aptId = String(inv.lines[0]?.appointmentId ?? inv.draftKey.split(":")[1]);
    return draftForSession(aptId);
  }
  return draftStatement(String(inv.organizationId), inv.periodKey!);
}

/**
 * Lines the organization may not be sent — no consent on the coverage — with
 * just enough to fix them.
 */
async function consentBlocked(inv: Pick<IOrganizationInvoice, "lines">) {
  const coverageIds = inv.lines.map((l) => l.coverageId).filter(Boolean);
  const coverages = await OrganizationCoverage.find({ _id: { $in: coverageIds } })
    .select("consent.status")
    .lean();
  const consent = new Map(coverages.map((c) => [String(c._id), c.consent?.status === "given"]));
  return blockedLines(inv.lines, consent).map((l) => ({
    appointmentId: String(l.appointmentId),
    patientFullName: l.patientFullName,
    sessionDate: l.sessionDate,
  }));
}

/** Lines whose session changed since the draft was built (reassigned, repriced…). */
async function staleLines(inv: Pick<IOrganizationInvoice, "lines" | "organizationId">) {
  const ids = inv.lines.map((l) => l.appointmentId);
  const current = await Appointment.find({ _id: { $in: ids } })
    .select("+thirdPartyBilling")
    .lean();
  const byId = new Map(current.map((a) => [String(a._id), a.thirdPartyBilling]));
  return inv.lines
    .filter((l) => {
      const tpb = byId.get(String(l.appointmentId));
      return (
        !tpb ||
        tpb.kind !== "organization" ||
        tpb.state !== "confirmed" ||
        String(tpb.organizationId) !== String(inv.organizationId) ||
        tpb.orgAmountCents !== l.amountCents
      );
    })
    .map((l) => String(l.appointmentId));
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

function billToOf(org: Pick<IOrganization, "name" | "billingEmails" | "contactName" | "address">) {
  const a = org.address;
  const addressLines = a
    ? [a.street, [a.city, a.province, a.postalCode].filter(Boolean).join(" "), a.country]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
    : [];
  return {
    name: org.name,
    emails: org.billingEmails ?? [],
    ...(org.contactName ? { contactName: org.contactName } : {}),
    addressLines,
  };
}

/** The PDF of an issued invoice, from its frozen lines. */
export async function renderInvoicePdf(
  inv: Pick<
    IOrganizationInvoice,
    "kind" | "number" | "issuedAt" | "dueAt" | "periodKey" | "billTo" | "lines" | "totalCents" | "paidCents" | "balanceCents" | "printedNote"
  >,
  language: "fr" | "en",
): Promise<Buffer> {
  const contact = await getPlatformContactInfo();
  const interacEmail = await getInteracDepositEmail().catch(() => "");
  return buildOrganizationInvoicePdfBuffer({
    language,
    kind: inv.kind,
    number: inv.number ?? "—",
    issuedAt: inv.issuedAt ?? new Date(),
    dueAt: inv.dueAt ?? null,
    periodLabel: inv.periodKey ?? null,
    billTo: {
      name: inv.billTo?.name ?? "",
      contactName: inv.billTo?.contactName ?? null,
      addressLines: inv.billTo?.addressLines ?? [],
    },
    platform: {
      name: contact.companyName || "Je chemine",
      addressLines: formatStandardAddressBlock(contact.physicalAddress),
      phone: contact.phoneNumber,
      email: contact.supportEmail,
    },
    lines: inv.lines.map((l) => ({
      sessionDate: l.sessionDate,
      patientFullName: l.patientFullName,
      caseNumber: l.caseNumber,
      professionalName: l.professionalName,
      professionalTitle: l.professionalTitle,
      professionalLicence: l.professionalLicence,
      durationMinutes: l.durationMinutes,
      amountCents: l.amountCents,
    })),
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    balanceCents: inv.balanceCents,
    interacEmail: interacEmail || null,
    printedNote: inv.printedNote ?? null,
  });
}

/** Email the PDF to every billing address. Returns the addresses reached. */
async function deliver(
  inv: IOrganizationInvoice,
  org: Pick<IOrganization, "name" | "language">,
): Promise<string[]> {
  const language = org.language === "en" ? "en" : "fr";
  const pdf = await renderInvoicePdf(inv, language);
  const reached: string[] = [];
  for (const to of inv.billTo?.emails ?? []) {
    const ok = await sendOrganizationInvoiceEmail({
      to,
      kind: inv.kind,
      organizationName: org.name,
      number: inv.number!,
      totalCents: inv.totalCents,
      balanceCents: inv.balanceCents,
      dueAt: inv.dueAt ?? null,
      periodKey: inv.periodKey ?? null,
      pdf,
      locale: language,
    }).catch((e) => {
      console.error("[organization-invoice] send failed:", e);
      return false;
    });
    if (ok) reached.push(to);
  }
  return reached;
}

/**
 * Issue a draft and send it. Every check happens before anything is reserved;
 * a failure after the claim puts things back. Safe to call again on an invoice
 * stuck in "issuing" (the email failed): it keeps its number and resends.
 */
export async function issueAndSend(args: {
  invoiceId: string;
  byUserId?: string | null;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(args.invoiceId);
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  if (inv.status !== "draft" && inv.status !== "issuing") {
    return refuse(409, "NOT_A_DRAFT", "This invoice was already sent. Use resend.");
  }
  if (inv.lines.length === 0) return refuse(409, "EMPTY", "This invoice has no sessions.");
  const org = await Organization.findById(inv.organizationId).lean();
  if (!org) return refuse(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (!org.billingEmails?.length) {
    return refuse(409, "NO_BILLING_EMAIL", "Add a billing email to this organization first.");
  }

  const blocked = await consentBlocked(inv);
  if (blocked.length > 0) {
    return refuse(
      409,
      "CONSENT_MISSING",
      "The client's consent is not on record for some sessions. Nothing was sent.",
      { blocked },
    );
  }

  if (inv.status === "draft") {
    const stale = await staleLines(inv);
    if (stale.length > 0) {
      return refuse(409, "DRAFT_STALE", "Some sessions changed since this draft. Refresh it.", { stale });
    }
    const claimed = await OrganizationInvoice.findOneAndUpdate(
      { _id: inv._id, status: "draft" },
      { $set: { status: "issuing" } },
      { new: true },
    );
    if (!claimed) return refuse(409, "CHANGED_MEANWHILE", "This invoice changed meanwhile.");

    const ids = inv.lines.map((l) => l.appointmentId);
    const reserved = await Appointment.updateMany(
      {
        _id: { $in: ids },
        "thirdPartyBilling.kind": "organization",
        "thirdPartyBilling.state": "confirmed",
        "thirdPartyBilling.orgStatus": "unbilled",
        "thirdPartyBilling.orgInvoiceId": { $exists: false },
      },
      {
        $set: {
          "thirdPartyBilling.orgInvoiceId": inv._id,
          "thirdPartyBilling.orgStatus": "invoiced",
        },
      },
    );
    if (reserved.modifiedCount !== ids.length) {
      await releaseSessions(inv._id);
      await OrganizationInvoice.updateOne({ _id: inv._id }, { $set: { status: "draft" } });
      return refuse(
        409,
        "SESSIONS_TAKEN",
        "Some sessions are already on another invoice. Refresh this draft.",
      );
    }

    const number = await nextOrganizationInvoiceNumber(now);
    const terms = org.paymentTermsDays ?? 30;
    await OrganizationInvoice.updateOne(
      { _id: inv._id },
      {
        $set: {
          number,
          issuedAt: now,
          dueAt: addDays(now, terms),
          paymentTermsDays: terms,
          billTo: billToOf(org),
        },
      },
    );
  }

  const issued = (await OrganizationInvoice.findById(inv._id))!;
  const reached = await deliver(issued, org);
  if (reached.length === 0) {
    return refuse(
      502,
      "EMAIL_FAILED",
      `Invoice ${issued.number} is issued but could not be emailed. Try sending again.`,
    );
  }
  const sent = await OrganizationInvoice.findOneAndUpdate(
    { _id: inv._id, status: "issuing" },
    {
      $set: { status: "sent" },
      $push: {
        sendLog: {
          at: now,
          to: reached,
          kind: "sent",
          ...(args.byUserId ? { byUserId: new mongoose.Types.ObjectId(args.byUserId) } : {}),
        },
      },
    },
    { new: true },
  );
  return { ok: true, invoice: sent ?? issued };
}

/** Send an issued invoice again (same PDF, same number). */
export async function resendInvoice(args: {
  invoiceId: string;
  byUserId?: string | null;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(args.invoiceId);
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  if (!["sent", "overdue", "partially_paid"].includes(inv.status)) {
    return refuse(409, "NOT_SENT", "Only a sent invoice can be sent again.");
  }
  const blocked = await consentBlocked(inv);
  if (blocked.length > 0) {
    return refuse(409, "CONSENT_MISSING", "Consent was withdrawn for some sessions. Nothing was sent.", { blocked });
  }
  const org = await Organization.findById(inv.organizationId).lean();
  if (!org) return refuse(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const reached = await deliver(inv, org);
  if (reached.length === 0) return refuse(502, "EMAIL_FAILED", "The invoice could not be emailed.");
  const updated = await OrganizationInvoice.findByIdAndUpdate(
    inv._id,
    {
      $push: {
        sendLog: {
          at: now,
          to: reached,
          kind: "resent",
          ...(args.byUserId ? { byUserId: new mongoose.Types.ObjectId(args.byUserId) } : {}),
        },
      },
    },
    { new: true },
  );
  return { ok: true, invoice: updated! };
}

async function releaseSessions(invoiceId: mongoose.Types.ObjectId) {
  await Appointment.updateMany(
    { "thirdPartyBilling.orgInvoiceId": invoiceId },
    {
      $unset: { "thirdPartyBilling.orgInvoiceId": 1 },
      $set: { "thirdPartyBilling.orgStatus": "unbilled" },
    },
  );
}

/**
 * Discard a draft (nothing left the platform, no number used) or void an
 * issued invoice: its sessions become billable again, its number is kept.
 * Refused once money was received — record a refund instead.
 */
export async function voidInvoice(args: {
  invoiceId: string;
  reason: string;
  byUserId: string;
  now?: Date;
}): Promise<InvoiceResult<IOrganizationInvoice | null>> {
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(args.invoiceId).lean();
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  if (inv.status === "draft") {
    await OrganizationInvoice.deleteOne({ _id: inv._id, status: "draft" });
    return { ok: true, invoice: null };
  }
  if (!["issuing", "sent", "overdue"].includes(inv.status) || inv.paidCents > 0) {
    return refuse(409, "CANNOT_VOID", "An invoice with a payment on it cannot be voided.");
  }
  const voided = await OrganizationInvoice.findOneAndUpdate(
    { _id: inv._id, status: inv.status, paidCents: 0 },
    {
      $set: {
        status: "void",
        voidedAt: args.now ?? new Date(),
        voidedBy: new mongoose.Types.ObjectId(args.byUserId),
        voidReason: args.reason.slice(0, 500),
        // Frees the key so these sessions can be drafted again.
        draftKey: `${inv.draftKey}#void-${String(inv._id)}`,
      },
    },
    { new: true },
  );
  if (!voided) return refuse(409, "CHANGED_MEANWHILE", "This invoice changed meanwhile.");
  await releaseSessions(inv._id as mongoose.Types.ObjectId);
  return { ok: true, invoice: voided };
}

/**
 * Record money received from the organization (cheque, EFT, portal…).
 * Idempotent on `externalRef`; never more than the balance.
 */
export async function recordOrganizationPayment(args: {
  invoiceId: string;
  amountCents: number;
  method: IOrganizationInvoice["payments"][number]["method"];
  reference?: string;
  receivedAt?: Date;
  externalRef?: string;
  source: "stripe" | "interac_reconciler" | "admin";
  byUserId?: string | null;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    return refuse(400, "INVALID_AMOUNT", "The amount must be positive.");
  }
  const inv = await OrganizationInvoice.findById(args.invoiceId).lean();
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  if (args.externalRef && inv.payments.some((p) => p.externalRef === args.externalRef)) {
    return { ok: true, invoice: inv as unknown as IOrganizationInvoice };
  }
  if (!["sent", "overdue", "partially_paid"].includes(inv.status)) {
    return refuse(409, "NOT_PAYABLE", "This invoice is not awaiting payment.");
  }
  if (args.amountCents > inv.balanceCents) {
    return refuse(409, "OVERPAYMENT", "The amount is more than the balance due.", {
      balanceCents: inv.balanceCents,
    });
  }

  const updated = await OrganizationInvoice.findOneAndUpdate(
    {
      _id: inv._id,
      status: { $in: ["sent", "overdue", "partially_paid"] },
      balanceCents: { $gte: args.amountCents },
      ...(args.externalRef ? { "payments.externalRef": { $ne: args.externalRef } } : {}),
    },
    {
      $push: {
        payments: {
          amountCents: args.amountCents,
          method: args.method,
          ...(args.reference ? { reference: args.reference.slice(0, 120) } : {}),
          receivedAt: args.receivedAt ?? now,
          source: args.source,
          ...(args.externalRef ? { externalRef: args.externalRef } : {}),
          ...(args.byUserId ? { recordedBy: new mongoose.Types.ObjectId(args.byUserId) } : {}),
        },
      },
      $inc: { paidCents: args.amountCents, balanceCents: -args.amountCents },
    },
    { new: true },
  );
  if (!updated) return refuse(409, "CHANGED_MEANWHILE", "This invoice changed meanwhile.");

  const paid = updated.balanceCents <= 0;
  await OrganizationInvoice.updateOne(
    { _id: updated._id },
    { $set: { status: paid ? "paid" : "partially_paid" } },
  );
  if (paid) {
    await Appointment.updateMany(
      { "thirdPartyBilling.orgInvoiceId": updated._id },
      { $set: { "thirdPartyBilling.orgStatus": "paid", "thirdPartyBilling.orgPaidAt": now } },
    );
  }
  updated.status = paid ? "paid" : "partially_paid";
  return { ok: true, invoice: updated };
}

/** Per organization: how many sessions wait to be invoiced, and for how much. */
export async function unbilledSummary(): Promise<
  Array<{ organizationId: string; sessions: number; totalCents: number; oldest: Date | null }>
> {
  await connectToDatabase();
  const rows = await Appointment.aggregate<{
    _id: mongoose.Types.ObjectId;
    sessions: number;
    totalCents: number;
    oldest: Date | null;
  }>([
    {
      $match: {
        sessionCompletedAt: { $ne: null },
        "thirdPartyBilling.kind": "organization",
        "thirdPartyBilling.state": "confirmed",
        "thirdPartyBilling.orgStatus": "unbilled",
        "thirdPartyBilling.orgAmountCents": { $gt: 0 },
        "thirdPartyBilling.orgInvoiceId": { $exists: false },
      },
    },
    {
      $group: {
        _id: "$thirdPartyBilling.organizationId",
        sessions: { $sum: 1 },
        totalCents: { $sum: "$thirdPartyBilling.orgAmountCents" },
        oldest: { $min: "$date" },
      },
    },
  ]);
  return rows.map((r) => ({
    organizationId: String(r._id),
    sessions: r.sessions,
    totalCents: r.totalCents,
    oldest: r.oldest,
  }));
}
