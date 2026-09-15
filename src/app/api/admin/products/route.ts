import { NextRequest, NextResponse } from "next/server";
import { requireContentAdmin } from "@/lib/content-admin";
import { listProductsForAdmin } from "@/lib/products";

/**
 * GET /api/admin/products?scope=review|all — professionals' products (spec 003
 * phase 5). `review` (default): sent for review, or live with changes to check.
 * Needs `manageContent`.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContentAdmin();
  if (gate.error) return gate.error;
  const scope = req.nextUrl.searchParams.get("scope") ?? "review";
  if (scope !== "review" && scope !== "all") return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const products = await listProductsForAdmin(scope);
  return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
