import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import { requireBillingAdmin, serializeCoverage } from "@/lib/organization-admin";
import { parseConsentAction, parseCoverageTerms } from "@/lib/organization-input";
import { applyConsent, endCoverage, updateCoverageTerms } from "@/lib/coverage-admin";

type Ctx = { params: Promise<{ id: string }> };

async function respond(
  result: Awaited<ReturnType<typeof updateCoverageTerms>>,
) {
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  const org = await Organization.findById(result.coverage.organizationId)
    .select("name active gapPolicy negotiatedRateCents")
    .lean();
  return NextResponse.json({ coverage: serializeCoverage(result.coverage.toObject(), org) });
}

/** PATCH /api/admin/coverages/[id] — change the terms (applies to future closures). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const terms = parseCoverageTerms(await req.json().catch(() => null), { partial: true });
    if (!terms.ok) return NextResponse.json({ error: terms.error }, { status: 400 });
    return respond(
      await updateCoverageTerms({
        coverageId: id,
        terms: terms.value,
        adminUserId: gate.session.user.id,
      }),
    );
  } catch (error) {
    console.error("Admin update coverage error:", error);
    return NextResponse.json({ error: "Failed to update the coverage" }, { status: 500 });
  }
}

/**
 * POST /api/admin/coverages/[id] — `{ action: "end", reason? }`, or consent:
 * `{ action: "give", method, note }` / `{ action: "withdraw", note }`.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.action === "end") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      return respond(
        await endCoverage({ coverageId: id, reason, adminUserId: gate.session.user.id }),
      );
    }
    const consent = parseConsentAction(body);
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: 400 });
    return respond(
      await applyConsent({
        coverageId: id,
        consent: consent.value,
        adminUserId: gate.session.user.id,
      }),
    );
  } catch (error) {
    console.error("Admin coverage action error:", error);
    return NextResponse.json({ error: "Failed to update the coverage" }, { status: 500 });
  }
}
