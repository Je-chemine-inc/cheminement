/**
 * Which organization coverage applies to a session, and the session cap.
 *
 * Coverage is looked up at CLOSURE from (clientId, beneficiary), never pinned on
 * the appointment, so none of the appointment-creation paths need to know about
 * organizations (spec 002).
 *
 * The cap ("the organization pays the first N sessions") is a SET of appointment
 * ids on the coverage, reserved with one atomic update:
 *
 *   - not a derived count — two closures in the same instant would both read
 *     "5 of 6 used" and both take slot 6;
 *   - not a `$inc` counter — closure can roll back and retry, and a counter
 *     would count the retried session twice.
 *
 * `$addToSet` plus "already mine" in the filter makes a retry a no-op.
 */
import mongoose from "mongoose";
import OrganizationCoverage, {
  type IOrganizationCoverage,
} from "@/models/OrganizationCoverage";
import type { IOrganization } from "@/models/Organization";
import { normalizeFullName } from "@/lib/contact-keys";
import type { CoverageTerms, OrgTerms } from "@/lib/third-party-billing";

/**
 * Who in the account a session is for. A guardian's account books both their
 * own sessions and a relative's; keying coverage by beneficiary stops a parent's
 * own sessions from being billed to their child's PAE. Referrals are "self":
 * the referred patient is the account holder.
 */
export function beneficiaryKeyOf(appointment: {
  bookingFor?: string | null;
  lovedOneInfo?: { firstName?: string | null; lastName?: string | null } | null;
}): string {
  if (appointment.bookingFor === "loved-one") {
    const name = normalizeFullName(
      appointment.lovedOneInfo?.firstName,
      appointment.lovedOneInfo?.lastName,
    );
    return name ? `loved-one:${name}` : "loved-one:unknown";
  }
  return "self";
}

/** Is `at` inside the coverage's optional validity window? */
export function isWithinValidity(
  coverage: Pick<IOrganizationCoverage, "validFrom" | "validUntil">,
  at: Date,
): boolean {
  if (coverage.validFrom && at < coverage.validFrom) return false;
  if (coverage.validUntil && at > coverage.validUntil) return false;
  return true;
}

/** Recorded and not withdrawn. Nothing may be disclosed to the org without it. */
export function hasConsent(
  coverage: Pick<IOrganizationCoverage, "consent">,
): boolean {
  return coverage.consent?.status === "given";
}

/**
 * The coverage that pays for this session, or null.
 *
 * An active coverage — or one that already holds THIS appointment's slot, so a
 * closure retried after taking the last slot (which flips the coverage to
 * "exhausted") still finds it. The session date must fall inside the validity
 * window.
 */
export async function findApplicableCoverage(args: {
  clientId: mongoose.Types.ObjectId | string;
  beneficiaryKey: string;
  appointmentId: mongoose.Types.ObjectId | string;
  sessionDate: Date;
}): Promise<IOrganizationCoverage | null> {
  const candidates = await OrganizationCoverage.find({
    clientId: args.clientId,
    beneficiaryKey: args.beneficiaryKey,
    $or: [
      { status: "active" },
      { consumedAppointmentIds: args.appointmentId },
    ],
  });
  const aptId = String(args.appointmentId);
  // A coverage already holding this session wins: it is the one that paid.
  const holding = candidates.find((c) =>
    c.consumedAppointmentIds.some((id) => String(id) === aptId),
  );
  if (holding) return holding;
  return (
    candidates.find(
      (c) => c.status === "active" && isWithinValidity(c, args.sessionDate),
    ) ?? null
  );
}

export type SlotReservation =
  | { granted: true; used: number; max: number; exhaustedNow: boolean }
  | { granted: false };

/**
 * Take one of a capped coverage's slots for this appointment — atomically, and
 * idempotently for the same appointment. Only call for a coverage WITH
 * `maxSessions` (see `wouldConsumeCapSlot`): with no cap there is nothing to
 * reserve, and the `$expr` comparison against a missing cap never matches.
 */
export async function reserveCoverageSlot(
  coverageId: mongoose.Types.ObjectId | string,
  appointmentId: mongoose.Types.ObjectId | string,
): Promise<SlotReservation> {
  const updated = await OrganizationCoverage.findOneAndUpdate(
    {
      _id: coverageId,
      $or: [
        // Retry: this session already holds a slot.
        { consumedAppointmentIds: appointmentId },
        // Fresh: the coverage is active and not full.
        {
          status: "active",
          $expr: {
            $lt: [{ $size: "$consumedAppointmentIds" }, "$maxSessions"],
          },
        },
      ],
    },
    { $addToSet: { consumedAppointmentIds: appointmentId } },
    { new: true },
  );
  if (!updated || !updated.maxSessions) return { granted: false };

  const used = updated.consumedAppointmentIds.length;
  let exhaustedNow = false;
  if (used >= updated.maxSessions && updated.status === "active") {
    const res = await OrganizationCoverage.updateOne(
      { _id: coverageId, status: "active" },
      { $set: { status: "exhausted" } },
    );
    exhaustedNow = res.modifiedCount === 1;
  }
  return { granted: true, used, max: updated.maxSessions, exhaustedNow };
}

/**
 * Give a slot back — closure rolled back, or an admin moved the session to the
 * client. Re-opens an exhausted coverage when that frees room, unless a renewal
 * is already active for the same person (the unique index says so), in which
 * case the renewal keeps paying and the old coverage stays exhausted.
 */
export async function releaseCoverageSlot(
  coverageId: mongoose.Types.ObjectId | string,
  appointmentId: mongoose.Types.ObjectId | string,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await OrganizationCoverage.findOneAndUpdate(
    { _id: coverageId, consumedAppointmentIds: appointmentId },
    { $pull: { consumedAppointmentIds: appointmentId } },
    { new: true },
  );
  if (!updated) return false;

  const hasRoom =
    !!updated.maxSessions &&
    updated.consumedAppointmentIds.length < updated.maxSessions;
  if (updated.status === "exhausted" && hasRoom && isWithinValidity(updated, now)) {
    try {
      await OrganizationCoverage.updateOne(
        { _id: coverageId, status: "exhausted" },
        { $set: { status: "active" } },
      );
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
    }
  }
  return true;
}

/** The resolver's view of a coverage. */
export function toCoverageTerms(coverage: IOrganizationCoverage): CoverageTerms {
  return {
    id: String(coverage._id),
    mode: coverage.mode,
    split: coverage.split
      ? { type: coverage.split.type, value: coverage.split.value }
      : null,
    rateCentsOverride: coverage.rateCentsOverride ?? null,
    consentGiven: hasConsent(coverage),
    hasCap: !!coverage.maxSessions,
    caseNumber: coverage.caseNumber ?? null,
  };
}

/** The resolver's view of an organization. */
export function toOrgTerms(org: IOrganization): OrgTerms {
  return {
    id: String(org._id),
    name: org.name,
    negotiatedRateCents: org.negotiatedRateCents ?? null,
    gapPolicy: org.gapPolicy,
  };
}

/**
 * Account merge: move the loser's coverages to the survivor, one at a time.
 *
 * NOT an updateMany. If both accounts hold an active coverage for the same
 * person, the one-active-coverage index throws E11000 — and the merge runs
 * without a transaction, so a throw would abort it with other collections
 * already re-pointed. On that conflict the survivor's coverage stays active and
 * the loser's is retired (status "ended") but still moved, so the sessions it
 * paid for keep their history.
 */
export async function mergeOrganizationCoverages(opts: {
  loserId: mongoose.Types.ObjectId;
  survivorId: mongoose.Types.ObjectId;
}): Promise<number> {
  const rows = await OrganizationCoverage.find({ clientId: opts.loserId });
  let moved = 0;
  for (const row of rows) {
    try {
      const res = await OrganizationCoverage.updateOne(
        { _id: row._id },
        { $set: { clientId: opts.survivorId } },
      );
      if (res.modifiedCount === 1) moved += 1;
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
      const res = await OrganizationCoverage.updateOne(
        { _id: row._id },
        {
          $set: {
            clientId: opts.survivorId,
            status: "ended",
            endedAt: new Date(),
            endReason:
              "Fusion de comptes : le compte conservé avait déjà une couverture active pour cette personne.",
          },
        },
      );
      if (res.modifiedCount === 1) moved += 1;
    }
  }
  return moved;
}
