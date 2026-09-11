import type { IOrganization } from "@/models/Organization";
import type { IOrganizationInvoice } from "@/models/OrganizationInvoice";
import { isFormEditable, linesFingerprint } from "@/lib/organization-invoice-form";

type Lean<T> = Omit<T, keyof import("mongoose").Document> & { _id: unknown };

/**
 * An organization invoice as the admin screens see it. Lines keep the names
 * (this is the billing admin's own view of what was sent); the pay token,
 * Stripe ids and the stored form's id and hash stay server-side.
 */
export function serializeInvoice(
  inv: Lean<IOrganizationInvoice>,
  org?: Pick<Lean<IOrganization>, "name" | "requiresOwnForm" | "formNotes"> | null,
) {
  const form = inv.attachment;
  const sendLog = inv.sendLog ?? [];
  return {
    id: String(inv._id),
    kind: inv.kind,
    organizationId: String(inv.organizationId),
    organizationName: org?.name ?? inv.billTo?.name ?? "",
    number: inv.number ?? null,
    periodKey: inv.periodKey ?? null,
    status: inv.status,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    balanceCents: inv.balanceCents,
    issuedAt: inv.issuedAt ?? null,
    dueAt: inv.dueAt ?? null,
    billToEmails: inv.billTo?.emails ?? [],
    lines: (inv.lines ?? []).map((l) => ({
      appointmentId: String(l.appointmentId),
      sessionDate: l.sessionDate,
      patientFullName: l.patientFullName,
      caseNumber: l.caseNumber ?? "",
      professionalName: l.professionalName,
      durationMinutes: l.durationMinutes ?? null,
      amountCents: l.amountCents,
    })),
    payments: (inv.payments ?? []).map((p) => ({
      amountCents: p.amountCents,
      refundedCents: p.refundedCents ?? 0,
      method: p.method,
      reference: p.reference ?? "",
      receivedAt: p.receivedAt,
      source: p.source,
    })),
    sendLog: sendLog.map((s) => ({
      at: s.at,
      to: s.to,
      kind: s.kind,
      withForm: Boolean(s.attachment),
      withoutOwnForm: Boolean(s.withoutOwnForm),
    })),
    // The organization's own claim form (phase 7).
    requiresOwnForm: Boolean(org?.requiresOwnForm),
    formNotes: org?.formNotes ?? "",
    attachmentEditable: isFormEditable(inv.status),
    attachment: form
      ? {
          fileName: form.fileName,
          size: form.size,
          scanStatus: form.scanStatus,
          uploadedAt: form.uploadedAt,
          // The lines changed since it was attached: it would be refused.
          stale: form.linesFingerprint !== linesFingerprint(inv.lines ?? []),
          // This very file already went out at least once.
          sent: sendLog.some((s) => s.attachment && String(s.attachment.fileId) === String(form.fileId)),
        }
      : null,
    paymentEvents: (inv.paymentEvents ?? []).map((e) => ({ at: e.at, kind: e.kind, detail: e.detail })),
    reminders: {
      dueSentAt: inv.reminders?.dueSentAt ?? null,
      followUpSentAt: inv.reminders?.followUpSentAt ?? null,
      overdueAlertSentAt: inv.reminders?.overdueAlertSentAt ?? null,
    },
    disputed: Boolean(inv.disputed),
    hasPayLink: Boolean(inv.payToken),
    voidReason: inv.voidReason ?? "",
    createdAt: inv.createdAt,
  };
}
