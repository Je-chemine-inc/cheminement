import type { IOrganization } from "@/models/Organization";
import type { IOrganizationInvoice } from "@/models/OrganizationInvoice";

type Lean<T> = Omit<T, keyof import("mongoose").Document> & { _id: unknown };

/**
 * An organization invoice as the admin screens see it. Lines keep the names
 * (this is the billing admin's own view of what was sent); the pay token and
 * Stripe ids stay server-side.
 */
export function serializeInvoice(
  inv: Lean<IOrganizationInvoice>,
  org?: Pick<Lean<IOrganization>, "name"> | null,
) {
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
    sendLog: (inv.sendLog ?? []).map((s) => ({ at: s.at, to: s.to, kind: s.kind })),
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
