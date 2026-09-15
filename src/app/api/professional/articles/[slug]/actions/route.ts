import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { professionalArticleAction } from "@/lib/articles";

/**
 * POST /api/professional/articles/<slug>/actions `{ action, attest? }` — the professional sends an
 * article to the team (confirming no testimonials and no promise of results), withdraws a
 * submission, or takes a live article down.
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
  const result = await professionalArticleAction({
    professionalId: gate.userId,
    slug,
    action: action as (typeof ACTIONS)[number],
    attest: body?.attest === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.code, ...(result.details ?? {}) }, { status: result.status });
  return NextResponse.json({ status: result.status });
}
