/**
 * Spec 002 — what a professional may know about who pays: the kind of payer
 * ("PAE", "Employeur"…) and how many covered sessions are used, so they can
 * plan the end of a follow-up. Never the organization's name, rate or amounts.
 */
import mongoose from "mongoose";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import Organization, { type OrganizationKind } from "@/models/Organization";
import { beneficiaryKeyOf } from "@/lib/organization-coverage";

export type CoverageBadge = {
  kind: OrganizationKind;
  used: number;
  max: number | null;
};

type AppointmentLike = {
  _id: unknown;
  clientId?: unknown;
  bookingFor?: string | null;
  lovedOneInfo?: { firstName?: string | null; lastName?: string | null } | null;
};

/** The client's id whether `clientId` is populated or not. */
function clientIdOf(apt: AppointmentLike): string | null {
  const c = apt.clientId as { _id?: unknown } | string | undefined | null;
  if (!c) return null;
  if (typeof c === "object" && "_id" in c && c._id) return String(c._id);
  return String(c);
}

/**
 * Badges keyed by appointment id, for the appointments whose person has an
 * active (or used-up) coverage. One query for coverages, one for their kinds.
 */
export async function coverageBadgesFor(
  appointments: AppointmentLike[],
): Promise<Map<string, CoverageBadge>> {
  const out = new Map<string, CoverageBadge>();
  const clientIds = [
    ...new Set(appointments.map(clientIdOf).filter((id): id is string => !!id)),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (clientIds.length === 0) return out;

  const coverages = await OrganizationCoverage.find({
    clientId: { $in: clientIds },
    status: { $in: ["active", "exhausted"] },
  })
    .select("clientId beneficiaryKey organizationId maxSessions consumedAppointmentIds")
    .lean();
  if (coverages.length === 0) return out;

  const orgs = await Organization.find({
    _id: { $in: coverages.map((c) => c.organizationId) },
  })
    .select("kind")
    .lean();
  const kindOf = new Map(orgs.map((o) => [String(o._id), o.kind]));
  const byPerson = new Map(
    coverages.map((c) => [`${String(c.clientId)}|${c.beneficiaryKey}`, c]),
  );

  for (const apt of appointments) {
    const clientId = clientIdOf(apt);
    if (!clientId) continue;
    const coverage = byPerson.get(`${clientId}|${beneficiaryKeyOf(apt)}`);
    if (!coverage) continue;
    out.set(String(apt._id), {
      kind: kindOf.get(String(coverage.organizationId)) ?? "other",
      used: coverage.consumedAppointmentIds?.length ?? 0,
      max: coverage.maxSessions ?? null,
    });
  }
  return out;
}
