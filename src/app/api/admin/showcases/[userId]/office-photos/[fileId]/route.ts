import { NextRequest } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import { removeShowcaseOfficePhoto } from "@/lib/showcase-service";

/**
 * The office photo of a professional's draft page, for an admin: DELETE
 * removes it (a page has one photo since 2026-09-18).
 */
type Params = { params: Promise<{ userId: string; fileId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId, fileId } = await params;
  const result = await removeShowcaseOfficePhoto({ userId, fileId, actor: "admin" });
  return respondShowcase(result, (value) => value);
}
