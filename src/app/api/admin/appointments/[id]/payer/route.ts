import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireBillingAdmin } from "@/lib/organization-admin";
import {
  PAYER_DECISIONS,
  reassignSessionPayer,
  type PayerDecision,
} from "@/lib/session-payer-reassign";

/**
 * Spec 002 — decide or change who pays for a CLOSED session: settle a session
 * held for a payer decision, or correct a wrong payer. Body:
 * `{ payer: "organization" | "client" | "external", note?: string }`.
 * Refuses (409) once the client paid or the session is on an organization
 * invoice — the money has to be moved back first.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireBillingAdmin();
    if (gate.error) return gate.error;

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as {
      payer?: unknown;
      note?: unknown;
    } | null;
    const payer = body?.payer;
    if (typeof payer !== "string" || !PAYER_DECISIONS.includes(payer as PayerDecision)) {
      return NextResponse.json(
        { error: "payer must be organization, client or external" },
        { status: 400 },
      );
    }
    const note = typeof body?.note === "string" ? body.note.trim() : undefined;

    const result = await reassignSessionPayer({
      appointmentId: id,
      decision: payer as PayerDecision,
      adminUserId: gate.session.user.id,
      note: note || undefined,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json({
      kind: result.plan.kind,
      state: result.plan.state,
      reason: result.plan.reason,
      clientPaymentStatus: result.plan.clientPaymentStatus,
      ledgerAdjustmentCents: result.ledgerAdjustmentCents,
    });
  } catch (error) {
    console.error("Admin reassign payer error:", error);
    return NextResponse.json(
      { error: "Failed to change the payer" },
      { status: 500 },
    );
  }
}
