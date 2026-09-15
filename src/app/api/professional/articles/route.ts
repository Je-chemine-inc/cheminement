import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { createArticle, listProfessionalArticles } from "@/lib/articles";

/**
 * The signed-in professional's articles (2026-09-15): the list, and a new draft `{ titleFr }`.
 * Only an active, approved professional.
 */
export async function GET() {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const articles = await listProfessionalArticles(gate.userId);
  return NextResponse.json({ articles }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => null)) as { titleFr?: unknown } | null;
  const result = await createArticle({ professionalId: gate.userId, titleFr: body?.titleFr });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
  return NextResponse.json({ slug: result.slug }, { status: 201 });
}
