import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Appointment from "@/models/Appointment";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { PAYER_DECISIONS, type PayerDecision } from "@/lib/session-payer-reassign";

/**
 * Spec 002 — choose who pays for a session BEFORE it is closed; closure then
 * honours it. Body: `{ payer: "organization" | "client" | "external" | null,
 * note?: string }` — `null` clears the choice (closure decides from the
 * coverage). Once the session is closed this refuses with 409: use
 * `POST /api/admin/appointments/[id]/payer`, which also fixes the amounts.
 */
export async function PUT(
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
    const clearing = payer === null;
    if (
      !clearing &&
      (typeof payer !== "string" || !PAYER_DECISIONS.includes(payer as PayerDecision))
    ) {
      return NextResponse.json(
        { error: "payer must be organization, client, external or null" },
        { status: 400 },
      );
    }
    const note =
      typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";

    // Conditional on the session still being open: closure is the only writer
    // after that, and a late override would silently not apply.
    const update = clearing
      ? { $unset: { billingOverride: 1 } }
      : {
          $set: {
            billingOverride: {
              payer,
              setBy: new mongoose.Types.ObjectId(gate.session.user.id),
              setAt: new Date(),
              ...(note ? { note } : {}),
            },
          },
        };
    const res = await Appointment.updateOne(
      { _id: id, sessionCompletedAt: null },
      update,
    );
    if (res.matchedCount === 0) {
      const exists = await Appointment.exists({ _id: id });
      if (!exists) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: "This session is closed — change its payer instead.",
          code: "ALREADY_CLOSED",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ payer: clearing ? null : payer });
  } catch (error) {
    console.error("Admin billing override error:", error);
    return NextResponse.json(
      { error: "Failed to set the payer" },
      { status: 500 },
    );
  }
}
