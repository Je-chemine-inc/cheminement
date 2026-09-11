/**
 * Admin actions on coverages (spec 002): attach a client to an organization,
 * change the terms, end it, record or withdraw consent.
 *
 * Terms apply to sessions closed from now on — a closed session keeps what its
 * payer snapshot froze. The session cap is never rewritten here: the used
 * sessions are the set `reserveCoverageSlot` maintains; only the ceiling moves.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Organization from "@/models/Organization";
import OrganizationCoverage, {
  ORG_BILLING_CONSENT_VERSION,
  type IOrganizationCoverage,
} from "@/models/OrganizationCoverage";
import { beneficiaryKeyOf } from "@/lib/organization-coverage";
import type { ConsentAction, CoverageTermsInput } from "@/lib/organization-input";

export type CoverageResult =
  | { ok: true; coverage: IOrganizationCoverage }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

const refuse = (
  status: 400 | 404 | 409,
  code: string,
  error: string,
): CoverageResult => ({ ok: false, status, code, error });

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

/** The status a coverage's cap implies. An ended coverage stays ended. */
export function statusForCap(
  current: IOrganizationCoverage["status"],
  used: number,
  maxSessions: number | null | undefined,
): IOrganizationCoverage["status"] {
  if (current === "ended") return "ended";
  return maxSessions && used >= maxSessions ? "exhausted" : "active";
}

function toSetUnset(terms: CoverageTermsInput) {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(terms)) {
    if (value === null) $unset[key] = 1;
    else if (value !== undefined) $set[key] = value;
  }
  return { $set, $unset };
}

export async function createCoverage(args: {
  clientId: string;
  beneficiary: "self" | { firstName?: string; lastName?: string };
  organizationId: string;
  terms: CoverageTermsInput;
  consent?: Extract<ConsentAction, { action: "give" }> | null;
  adminUserId: string;
  now?: Date;
}): Promise<CoverageResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();

  if (!mongoose.Types.ObjectId.isValid(args.clientId)) {
    return refuse(400, "INVALID_CLIENT", "Invalid client id");
  }
  if (!mongoose.Types.ObjectId.isValid(args.organizationId)) {
    return refuse(400, "INVALID_ORGANIZATION", "Invalid organization id");
  }
  const client = await User.findById(args.clientId).select("role").lean();
  if (!client) return refuse(404, "CLIENT_NOT_FOUND", "Client not found");
  const org = await Organization.findById(args.organizationId).select("active").lean();
  if (!org) return refuse(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (org.active === false) {
    return refuse(409, "ORGANIZATION_ARCHIVED", "This organization is archived.");
  }
  if (args.terms.mode === "split" && !args.terms.split) {
    return refuse(400, "SPLIT_TERMS_MISSING", "A split coverage needs the organization's share");
  }

  const self = args.beneficiary === "self";
  const lovedOne = self ? null : (args.beneficiary as { firstName?: string; lastName?: string });
  const beneficiaryKey = beneficiaryKeyOf(
    self ? { bookingFor: "self" } : { bookingFor: "loved-one", lovedOneInfo: lovedOne },
  );
  const { $set } = toSetUnset(args.terms);
  const adminId = new mongoose.Types.ObjectId(args.adminUserId);

  try {
    const coverage = await OrganizationCoverage.create({
      ...$set,
      clientId: args.clientId,
      beneficiaryKey,
      ...(lovedOne
        ? { beneficiaryName: `${lovedOne.firstName ?? ""} ${lovedOne.lastName ?? ""}`.trim() }
        : {}),
      organizationId: args.organizationId,
      status: statusForCap("active", 0, args.terms.maxSessions),
      ...(args.consent
        ? {
            consent: {
              status: "given",
              recordedAt: now,
              source: "admin_recorded",
              recordedBy: adminId,
              method: args.consent.method,
              textVersion: ORG_BILLING_CONSENT_VERSION,
              note: args.consent.note,
            },
            consentLog: [
              {
                action: "given",
                at: now,
                by: adminId,
                source: "admin_recorded",
                method: args.consent.method,
                textVersion: ORG_BILLING_CONSENT_VERSION,
                note: args.consent.note,
              },
            ],
          }
        : {}),
      createdBy: adminId,
      updatedBy: adminId,
    });
    return { ok: true, coverage };
  } catch (e) {
    if (isDuplicateKey(e)) {
      return refuse(
        409,
        "ALREADY_COVERED",
        "This person already has an active coverage. End it before adding another.",
      );
    }
    throw e;
  }
}

export async function updateCoverageTerms(args: {
  coverageId: string;
  terms: CoverageTermsInput;
  adminUserId: string;
}): Promise<CoverageResult> {
  await connectToDatabase();
  const current = await OrganizationCoverage.findById(args.coverageId);
  if (!current) return refuse(404, "NOT_FOUND", "Coverage not found");
  if (current.status === "ended") {
    return refuse(409, "COVERAGE_ENDED", "This coverage has ended. Add a new one instead.");
  }

  const mode = args.terms.mode ?? current.mode;
  const split = args.terms.split === undefined ? current.split : args.terms.split;
  if (mode === "split" && !split) {
    return refuse(400, "SPLIT_TERMS_MISSING", "A split coverage needs the organization's share");
  }
  const from = args.terms.validFrom === undefined ? current.validFrom : args.terms.validFrom;
  const until = args.terms.validUntil === undefined ? current.validUntil : args.terms.validUntil;
  if (from && until && until < from) {
    return refuse(400, "INVALID_DATES", "validUntil is before validFrom");
  }

  const max =
    args.terms.maxSessions === undefined ? current.maxSessions : args.terms.maxSessions;
  const status = statusForCap(current.status, current.consumedAppointmentIds.length, max);
  const { $set, $unset } = toSetUnset(args.terms);
  $set.status = status;
  $set.updatedBy = args.adminUserId;

  try {
    const updated = await OrganizationCoverage.findOneAndUpdate(
      // Conditional on the used sessions not having moved since we counted them.
      {
        _id: current._id,
        status: { $ne: "ended" },
        consumedAppointmentIds: { $size: current.consumedAppointmentIds.length },
      },
      { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: true, runValidators: true },
    );
    if (!updated) {
      return refuse(409, "CHANGED_MEANWHILE", "This coverage changed meanwhile — reload and try again.");
    }
    return { ok: true, coverage: updated };
  } catch (e) {
    if (isDuplicateKey(e)) {
      return refuse(
        409,
        "ALREADY_COVERED",
        "This person has another active coverage, so this one cannot be reopened.",
      );
    }
    throw e;
  }
}

export async function endCoverage(args: {
  coverageId: string;
  reason: string;
  adminUserId: string;
  now?: Date;
}): Promise<CoverageResult> {
  await connectToDatabase();
  const updated = await OrganizationCoverage.findOneAndUpdate(
    { _id: args.coverageId, status: { $ne: "ended" } },
    {
      $set: {
        status: "ended",
        endedAt: args.now ?? new Date(),
        ...(args.reason ? { endReason: args.reason.slice(0, 500) } : {}),
        updatedBy: args.adminUserId,
      },
    },
    { new: true },
  );
  if (!updated) {
    const exists = await OrganizationCoverage.exists({ _id: args.coverageId });
    return exists
      ? refuse(409, "COVERAGE_ENDED", "This coverage has already ended.")
      : refuse(404, "NOT_FOUND", "Coverage not found");
  }
  return { ok: true, coverage: updated };
}

/**
 * Record or withdraw the client's consent to have the organization billed
 * (Loi 25). Nothing with the patient's name may be sent to an organization
 * without it (the Phase 4 send gate). Every change is appended to `consentLog`.
 */
export async function applyConsent(args: {
  coverageId: string;
  consent: ConsentAction;
  adminUserId: string;
  now?: Date;
}): Promise<CoverageResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  const adminId = new mongoose.Types.ObjectId(args.adminUserId);
  const c = args.consent;

  const update =
    c.action === "give"
      ? {
          $set: {
            consent: {
              status: "given",
              recordedAt: now,
              source: "admin_recorded",
              recordedBy: adminId,
              method: c.method,
              textVersion: ORG_BILLING_CONSENT_VERSION,
              note: c.note,
            },
            updatedBy: adminId,
          },
          $push: {
            consentLog: {
              action: "given",
              at: now,
              by: adminId,
              source: "admin_recorded",
              method: c.method,
              textVersion: ORG_BILLING_CONSENT_VERSION,
              note: c.note,
            },
          },
        }
      : {
          $set: {
            "consent.status": "withdrawn",
            "consent.withdrawnAt": now,
            "consent.note": c.note,
            updatedBy: adminId,
          },
          $push: {
            consentLog: {
              action: "withdrawn",
              at: now,
              by: adminId,
              source: "admin_recorded",
              note: c.note,
            },
          },
        };

  const updated = await OrganizationCoverage.findOneAndUpdate(
    c.action === "give"
      ? { _id: args.coverageId, "consent.status": { $ne: "given" } }
      : { _id: args.coverageId, "consent.status": "given" },
    update,
    { new: true },
  );
  if (!updated) {
    const exists = await OrganizationCoverage.exists({ _id: args.coverageId });
    if (!exists) return refuse(404, "NOT_FOUND", "Coverage not found");
    return c.action === "give"
      ? refuse(409, "ALREADY_GIVEN", "Consent is already recorded.")
      : refuse(409, "NOT_GIVEN", "There is no consent to withdraw.");
  }
  return { ok: true, coverage: updated };
}
