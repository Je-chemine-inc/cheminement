import { NextRequest } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import { moveShowcaseOfficePhoto, removeShowcaseOfficePhoto } from "@/lib/showcase-service";

/**
 * One office photo of a professional's draft page, for an admin: DELETE
 * removes it, PATCH `{ direction: "up" | "down" }` moves it one place.
 */
type Params = { params: Promise<{ userId: string; fileId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId, fileId } = await params;
  const result = await removeShowcaseOfficePhoto({ userId, fileId, actor: "admin" });
  return respondShowcase(result, (value) => value);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId, fileId } = await params;
  const body = (await req.json().catch(() => null)) as { direction?: unknown } | null;
  const result = await moveShowcaseOfficePhoto({ userId, fileId, direction: body?.direction, actor: "admin" });
  return respondShowcase(result, (value) => value);
}
