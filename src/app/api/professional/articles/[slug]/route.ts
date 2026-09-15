import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { deleteArticle, loadArticleEditor, updateArticle } from "@/lib/articles";

/**
 * One of the signed-in professional's articles: the editor's data, an edit (a writable allowlist;
 * anything else is dropped), and deleting it. 404 for an article that is not theirs.
 */
type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const article = await loadArticleEditor(gate.userId, slug);
  if (!article) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(article, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const result = await updateArticle({ professionalId: gate.userId, slug, body });
  if (!result.ok) return NextResponse.json({ error: result.code, ...(result.details ?? {}) }, { status: result.status });
  return NextResponse.json(await loadArticleEditor(gate.userId, slug));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const result = await deleteArticle({ professionalId: gate.userId, slug });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
