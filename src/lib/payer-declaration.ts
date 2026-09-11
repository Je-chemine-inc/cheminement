/**
 * Spec 002 — an admin confirms or refuses what a client declared at booking
 * ("my employer / PAE / school pays").
 *
 * Confirming links the client to a coverage — the existing active one for that
 * person if it is with the same organization, otherwise a new one carrying the
 * consent the client ticked at booking — and settles, as organization-paid,
 * the closed sessions that were held waiting for this very answer. Refusing
 * records the refusal and hands those held sessions to the client, who then
 * receives the payment request.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { beneficiaryKeyOf } from "@/lib/organization-coverage";
import { createCoverage } from "@/lib/coverage-admin";
import { reassignSessionPayer } from "@/lib/session-payer-reassign";
import type { CoverageTermsInput } from "@/lib/organization-input";

export type DeclarationResult =
  | { ok: true; coverageId?: string; resolvedHeldSessions: number; created: boolean }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string };

const refuse = (
  status: 400 | 404 | 409,
  code: string,
  error: string,
): DeclarationResult => ({ ok: false, status, code, error });

async function loadPending(appointmentId: string) {
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) return null;
  return Appointment.findById(appointmentId)
    .select("clientId bookingFor lovedOneInfo payerDeclaration")
    .lean();
}

export async function confirmPayerDeclaration(args: {
  appointmentId: string;
  organizationId: string;
  terms: CoverageTermsInput;
  adminUserId: string;
  now?: Date;
}): Promise<DeclarationResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();

  const apt = await loadPending(args.appointmentId);
  if (!apt) return refuse(404, "NOT_FOUND", "Appointment not found");
  const declaration = apt.payerDeclaration;
  if (!declaration) return refuse(404, "NO_DECLARATION", "Nothing was declared on this request.");
  if (declaration.status !== "pending") {
    return refuse(409, "ALREADY_REVIEWED", "This declaration was already reviewed.");
  }

  const beneficiaryKey = beneficiaryKeyOf(apt);
  const existing = await OrganizationCoverage.findOne({
    clientId: apt.clientId,
    beneficiaryKey,
    status: "active",
  })
    .select("organizationId")
    .lean();

  let coverageId: string;
  let created = false;
  if (existing) {
    if (String(existing.organizationId) !== args.organizationId) {
      return refuse(
        409,
        "COVERED_BY_ANOTHER_ORGANIZATION",
        "This person already has an active coverage with another organization. End it first.",
      );
    }
    coverageId = String(existing._id);
  } else {
    const result = await createCoverage({
      clientId: String(apt.clientId),
      beneficiary:
        apt.bookingFor === "loved-one"
          ? {
              firstName: apt.lovedOneInfo?.firstName ?? "",
              lastName: apt.lovedOneInfo?.lastName ?? "",
            }
          : "self",
      organizationId: args.organizationId,
      terms: {
        ...args.terms,
        caseNumber: args.terms.caseNumber ?? declaration.caseNumber ?? null,
      },
      consentFromBooking: declaration.consentGiven
        ? {
            at: declaration.declaredAt,
            textVersion: declaration.consentTextVersion ?? "",
          }
        : null,
      adminUserId: args.adminUserId,
      now,
    });
    if (!result.ok) return result;
    coverageId = String(result.coverage._id);
    created = true;
  }

  const claim = await Appointment.updateOne(
    { _id: apt._id, "payerDeclaration.status": "pending" },
    {
      $set: {
        "payerDeclaration.status": "confirmed",
        "payerDeclaration.reviewedAt": now,
        "payerDeclaration.reviewedBy": new mongoose.Types.ObjectId(args.adminUserId),
        "payerDeclaration.coverageId": new mongoose.Types.ObjectId(coverageId),
      },
    },
  );
  if (claim.modifiedCount !== 1) {
    return refuse(409, "ALREADY_REVIEWED", "This declaration was reviewed meanwhile.");
  }

  // Sessions closed while the declaration was pending were held: nothing was
  // charged. The answer is now "the organization pays", so settle them.
  const resolvedHeldSessions = await settleHeldSessions({
    clientId: String(apt.clientId),
    beneficiaryKey,
    decision: "organization",
    note: "Déclaration du client confirmée",
    adminUserId: args.adminUserId,
    now,
  });

  return { ok: true, coverageId, resolvedHeldSessions, created };
}

/**
 * Settle the closed sessions of this person that were held because their
 * declaration had not been reviewed yet. Returns how many were settled.
 */
async function settleHeldSessions(args: {
  clientId: string;
  beneficiaryKey: string;
  decision: "organization" | "client";
  note: string;
  adminUserId: string;
  now: Date;
}): Promise<number> {
  const held = await Appointment.find({
    clientId: args.clientId,
    sessionCompletedAt: { $ne: null },
    "thirdPartyBilling.state": "awaiting_decision",
    "thirdPartyBilling.reason": "declaration_pending",
  })
    .select("bookingFor lovedOneInfo")
    .lean();
  let settled = 0;
  for (const session of held) {
    if (beneficiaryKeyOf(session) !== args.beneficiaryKey) continue;
    const r = await reassignSessionPayer({
      appointmentId: String(session._id),
      decision: args.decision,
      adminUserId: args.adminUserId,
      note: args.note,
      now: args.now,
    });
    if (r.ok) settled += 1;
    else console.warn(`[payer-declaration] held session ${session._id} not settled: ${r.code}`);
  }
  return settled;
}

export async function rejectPayerDeclaration(args: {
  appointmentId: string;
  reason: string;
  adminUserId: string;
  now?: Date;
}): Promise<DeclarationResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  const res = await Appointment.updateOne(
    { _id: args.appointmentId, "payerDeclaration.status": "pending" },
    {
      $set: {
        "payerDeclaration.status": "rejected",
        "payerDeclaration.reviewedAt": now,
        "payerDeclaration.reviewedBy": new mongoose.Types.ObjectId(args.adminUserId),
        ...(args.reason ? { "payerDeclaration.rejectionReason": args.reason.slice(0, 500) } : {}),
      },
    },
  );
  if (res.modifiedCount !== 1) {
    const apt = await loadPending(args.appointmentId);
    if (!apt) return refuse(404, "NOT_FOUND", "Appointment not found");
    if (!apt.payerDeclaration) return refuse(404, "NO_DECLARATION", "Nothing was declared on this request.");
    return refuse(409, "ALREADY_REVIEWED", "This declaration was already reviewed.");
  }
  // The organization does not pay: sessions held on this declaration are the
  // client's, and they now receive the payment request.
  const apt = await loadPending(args.appointmentId);
  const resolvedHeldSessions = apt
    ? await settleHeldSessions({
        clientId: String(apt.clientId),
        beneficiaryKey: beneficiaryKeyOf(apt),
        decision: "client",
        note: "Déclaration du client refusée",
        adminUserId: args.adminUserId,
        now,
      })
    : 0;
  return { ok: true, resolvedHeldSessions, created: false };
}
