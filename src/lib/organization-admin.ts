import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import type { IOrganization } from "@/models/Organization";
import type { IOrganizationCoverage } from "@/models/OrganizationCoverage";
import { fromCents } from "@/lib/money-cents";

/**
 * Gate for every organization-billing admin action (spec 002): an active admin
 * with `manageBilling`. Same shape as `requireContentAdmin` in pro-catalog.ts.
 */
export async function requireBillingAdmin(): Promise<
  { error: NextResponse; session?: undefined } | { error?: undefined; session: Session }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  await connectToDatabase();
  const permissions = await getActiveAdminPermissions(session.user.id);
  if (!permissions?.manageBilling) {
    return {
      error: NextResponse.json(
        { error: "Forbidden - missing permission: manageBilling" },
        { status: 403 },
      ),
    };
  }
  return { session };
}

type Lean<T> = Omit<T, keyof import("mongoose").Document> & { _id: unknown };

const dayString = (d?: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

/** An organization as the admin screens see it. Never the Stripe customer id. */
export function serializeOrganization(
  o: Lean<IOrganization>,
  extra: { activeCoverageCount?: number } = {},
) {
  return {
    id: String(o._id),
    name: o.name,
    kind: o.kind,
    billingEmails: o.billingEmails ?? [],
    contactName: o.contactName ?? "",
    phone: o.phone ?? "",
    address: o.address ?? null,
    language: o.language,
    paymentTermsDays: o.paymentTermsDays,
    billingCycle: o.billingCycle,
    negotiatedRate:
      typeof o.negotiatedRateCents === "number" ? fromCents(o.negotiatedRateCents) : null,
    gapPolicy: o.gapPolicy,
    autoSendPerSession: !!o.autoSendPerSession,
    requiresOwnForm: !!o.requiresOwnForm,
    formNotes: o.formNotes ?? "",
    internalNotes: o.internalNotes ?? "",
    active: o.active !== false,
    archivedAt: o.archivedAt ?? null,
    activeCoverageCount: extra.activeCoverageCount ?? 0,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/**
 * A coverage as the admin screens see it: how many sessions were used, never
 * which appointments (those ids stay server-side).
 */
export function serializeCoverage(
  c: Lean<IOrganizationCoverage>,
  org?: Pick<Lean<IOrganization>, "_id" | "name" | "active" | "gapPolicy" | "negotiatedRateCents"> | null,
) {
  return {
    id: String(c._id),
    clientId: String(c.clientId),
    beneficiaryKey: c.beneficiaryKey,
    beneficiaryName: c.beneficiaryName ?? "",
    organization: org
      ? {
          id: String(org._id),
          name: org.name,
          active: org.active !== false,
          gapPolicy: org.gapPolicy,
          negotiatedRate:
            typeof org.negotiatedRateCents === "number"
              ? fromCents(org.negotiatedRateCents)
              : null,
        }
      : { id: String(c.organizationId), name: "", active: false, gapPolicy: null, negotiatedRate: null },
    caseNumber: c.caseNumber ?? "",
    mode: c.mode,
    split: c.split
      ? {
          type: c.split.type,
          value: c.split.type === "fixed" ? fromCents(c.split.value) : c.split.value,
        }
      : null,
    maxSessions: c.maxSessions ?? null,
    used: c.consumedAppointmentIds?.length ?? 0,
    rateOverride:
      typeof c.rateCentsOverride === "number" ? fromCents(c.rateCentsOverride) : null,
    validFrom: dayString(c.validFrom),
    validUntil: dayString(c.validUntil),
    status: c.status,
    endedAt: c.endedAt ?? null,
    endReason: c.endReason ?? "",
    consent: {
      status: c.consent?.status ?? "none",
      recordedAt: c.consent?.recordedAt ?? null,
      method: c.consent?.method ?? null,
      source: c.consent?.source ?? null,
      textVersion: c.consent?.textVersion ?? null,
      withdrawnAt: c.consent?.withdrawnAt ?? null,
      note: c.consent?.note ?? "",
    },
    consentLog: (c.consentLog ?? []).map((e) => ({
      action: e.action,
      at: e.at,
      source: e.source,
      method: e.method ?? null,
      note: e.note ?? "",
    })),
    createdAt: c.createdAt,
  };
}
