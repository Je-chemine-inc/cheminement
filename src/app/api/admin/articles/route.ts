import { NextRequest, NextResponse } from "next/server";
import { requireContentAdmin } from "@/lib/content-admin";
import { listArticlesForAdmin } from "@/lib/articles";

/**
 * GET /api/admin/articles?scope=review|all — professionals' articles. `review` (default): sent for
 * review, or live with changes to check. Needs `manageContent`.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContentAdmin();
  if (gate.error) return gate.error;
  const scope = req.nextUrl.searchParams.get("scope") ?? "review";
  if (scope !== "review" && scope !== "all") return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const articles = await listArticlesForAdmin(scope);
  return NextResponse.json({ articles }, { headers: { "Cache-Control": "no-store" } });
}
