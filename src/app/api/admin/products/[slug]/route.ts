import { NextRequest, NextResponse } from "next/server";
import { requireContentAdmin } from "@/lib/content-admin";
import { adminProductAction } from "@/lib/products";

/**
 * POST /api/admin/products/<slug> `{ action: approve | reject | unpublish, notes? }`
 * — the team's decision on a professional's product (spec 003 phase 5).
 * Rejecting needs notes. Approving a live product accepts its changes. The
 * team never edits a professional's text: preview it at /book/<slug>.
 */
const ACTIONS = ["approve", "reject", "unpublish"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireContentAdmin();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; notes?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  }
  const result = await adminProductAction({
    adminId: gate.userId,
    slug,
    action: action as (typeof ACTIONS)[number],
    notes: body?.notes,
  });
  if (!result.ok) return NextResponse.json({ error: result.code, ...(result.details ?? {}) }, { status: result.status });
  return NextResponse.json({ status: result.status });
}
