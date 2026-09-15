import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { professionalProductAction } from "@/lib/products";

/**
 * POST /api/professional/products/<slug>/actions `{ action, attest? }` — the
 * professional sends a product for review (with the rights attestation),
 * withdraws a submission, or takes a live product down (spec 003 phase 5).
 */
const ACTIONS = ["submit", "withdraw", "unpublish"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; attest?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  }
  const result = await professionalProductAction({
    professionalId: gate.userId,
    slug,
    action: action as (typeof ACTIONS)[number],
    attest: body?.attest === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.code, ...(result.details ?? {}) }, { status: result.status });
  return NextResponse.json({ status: result.status });
}
