import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { requireBillingAdmin, serializeCoverage } from "@/lib/organization-admin";
import {
  parseBeneficiary,
  parseConsentAction,
  parseCoverageTerms,
} from "@/lib/organization-input";
import { createCoverage } from "@/lib/coverage-admin";

/**
 * GET /api/admin/coverages?clientId= — every coverage of one client, newest
 * first, plus what the client declared at booking that nobody reviewed yet.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  try {
    const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    const coverages = await OrganizationCoverage.find({ clientId })
      .sort({ createdAt: -1 })
      .lean();
    const orgs = await Organization.find({
      _id: { $in: coverages.map((c) => c.organizationId) },
    })
      .select("name active gapPolicy negotiatedRateCents")
      .lean();
    const byId = new Map(orgs.map((o) => [String(o._id), o]));
    const declared = await Appointment.find({
      clientId,
      "payerDeclaration.status": "pending",
    })
      .select("payerDeclaration bookingFor lovedOneInfo.firstName lovedOneInfo.lastName createdAt")
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({
      coverages: coverages.map((c) =>
        serializeCoverage(c, byId.get(String(c.organizationId)) ?? null),
      ),
      pendingDeclarations: declared.map((a) => ({
        appointmentId: String(a._id),
        organizationName: a.payerDeclaration?.organizationName ?? "",
        caseNumber: a.payerDeclaration?.caseNumber ?? "",
        declaredAt: a.payerDeclaration?.declaredAt ?? null,
        beneficiaryName:
          a.bookingFor === "loved-one"
            ? `${a.lovedOneInfo?.firstName ?? ""} ${a.lovedOneInfo?.lastName ?? ""}`.trim()
            : "",
      })),
    });
  } catch (error) {
    console.error("Admin list coverages error:", error);
    return NextResponse.json({ error: "Failed to load coverages" }, { status: 500 });
  }
}

/**
 * POST /api/admin/coverages — `{ clientId, beneficiary: "self" | {firstName,
 * lastName}, organizationId, ...terms, consent?: { method, note } }`.
 */
export async function POST(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const terms = parseCoverageTerms(body, { partial: false });
    if (!terms.ok) return NextResponse.json({ error: terms.error }, { status: 400 });
    const beneficiary = parseBeneficiary(body.beneficiary);
    if (!beneficiary.ok) return NextResponse.json({ error: beneficiary.error }, { status: 400 });
    let consent = null;
    if (body.consent !== undefined && body.consent !== null) {
      const parsed = parseConsentAction({
        ...(body.consent as Record<string, unknown>),
        action: "give",
      });
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      consent = parsed.value.action === "give" ? parsed.value : null;
    }

    const result = await createCoverage({
      clientId: String(body.clientId ?? ""),
      beneficiary: beneficiary.value,
      organizationId: String(body.organizationId ?? ""),
      terms: terms.value,
      consent,
      adminUserId: gate.session.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    const org = await Organization.findById(result.coverage.organizationId)
      .select("name active gapPolicy negotiatedRateCents")
      .lean();
    return NextResponse.json(
      { coverage: serializeCoverage(result.coverage.toObject(), org) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Admin create coverage error:", error);
    return NextResponse.json({ error: "Failed to create the coverage" }, { status: 500 });
  }
}
