import { NextRequest, NextResponse } from "next/server";
import { requireContentAdmin } from "@/lib/content-admin";
import { adminArticleAction } from "@/lib/articles";

/**
 * POST /api/admin/articles/<slug> `{ action: approve | reject | unpublish | feature | unfeature, notes? }`
 * — the team's decision on a professional's article. Rejecting needs notes; approving a live article
 * accepts its changes; featuring shows an approved article in « Nouveautés » too. The team never
 * edits a professional's text.
 */
const ACTIONS = ["approve", "reject", "unpublish", "feature", "unfeature"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireContentAdmin();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; notes?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  }
  const result = await adminArticleAction({
    adminId: gate.userId,
    slug,
    action: action as (typeof ACTIONS)[number],
    notes: body?.notes,
  });
  if (!result.ok) return NextResponse.json({ error: result.code, ...(result.details ?? {}) }, { status: result.status });
  return NextResponse.json({ status: result.status });
}
