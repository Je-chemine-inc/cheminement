import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { parseCoverageTerms } from "@/lib/organization-input";
import {
  confirmPayerDeclaration,
  rejectPayerDeclaration,
} from "@/lib/payer-declaration";
import { notifyCoverageConfirmed } from "@/lib/coverage-notices";

/**
 * Spec 002 — review what the client declared at booking.
 *  `{ action: "confirm", organizationId, ...coverage terms }` — links the client
 *    to a coverage (and settles sessions held on this declaration);
 *  `{ action: "reject", reason? }` — the client pays.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    if (body?.action === "reject") {
      const result = await rejectPayerDeclaration({
        appointmentId: id,
        reason: typeof body.reason === "string" ? body.reason.trim() : "",
        adminUserId: gate.session.user.id,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      }
      return NextResponse.json({ status: "rejected", resolvedHeldSessions: result.resolvedHeldSessions });
    }

    if (body?.action !== "confirm") {
      return NextResponse.json({ error: "action must be confirm or reject" }, { status: 400 });
    }
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }
    const terms = parseCoverageTerms(body, { partial: false });
    if (!terms.ok) return NextResponse.json({ error: terms.error }, { status: 400 });

    const result = await confirmPayerDeclaration({
      appointmentId: id,
      organizationId,
      terms: terms.value,
      adminUserId: gate.session.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }

    // Best-effort: the decision stands even if the email fails.
    await notifyCoverageConfirmed(id).catch((e) =>
      console.error("[payer-declaration] confirmation email:", e),
    );

    return NextResponse.json({
      status: "confirmed",
      coverageId: result.coverageId,
      createdCoverage: result.created,
      resolvedHeldSessions: result.resolvedHeldSessions,
    });
  } catch (error) {
    console.error("Admin payer declaration error:", error);
    return NextResponse.json({ error: "Failed to review the declaration" }, { status: 500 });
  }
}
