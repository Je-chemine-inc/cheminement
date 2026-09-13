import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { deleteProduct, loadProductEditor, updateProduct } from "@/lib/products";

/**
 * One of the signed-in professional's products (spec 003 phase 5): the editor's
 * data, an edit (a writable allowlist; anything else is dropped), and deleting a
 * product nobody bought. 404 for a product that is not theirs.
 */
type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const product = await loadProductEditor(gate.userId, slug);
  if (!product) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(product, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const result = await updateProduct({ professionalId: gate.userId, slug, body });
  if (!result.ok) return NextResponse.json({ error: result.code, ...(result.details ?? {}) }, { status: result.status });
  return NextResponse.json(await loadProductEditor(gate.userId, slug));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { slug } = await params;
  const result = await deleteProduct({ professionalId: gate.userId, slug });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
