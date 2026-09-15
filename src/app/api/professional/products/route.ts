import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { createProduct, listProfessionalProducts } from "@/lib/products";

/**
 * The signed-in professional's trainings and digital products (spec 003 phase
 * 5): the list, and a new draft `{ type, titleFr }`. Only an active, approved
 * professional.
 */
export async function GET() {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const products = await listProfessionalProducts(gate.userId);
  return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => null)) as { type?: unknown; titleFr?: unknown } | null;
  const result = await createProduct({ professionalId: gate.userId, type: body?.type, titleFr: body?.titleFr });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.status });
  return NextResponse.json({ slug: result.slug }, { status: 201 });
}
