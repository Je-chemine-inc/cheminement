import { NextRequest } from "next/server";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { removeShowcaseOfficePhoto } from "@/lib/showcase-service";

/**
 * The office photo of the professional's published page: DELETE removes it,
 * live at once. Only a photo on the signed-in professional's own page (404
 * otherwise).
 *
 * The context is read only once the professional is known: the gate runs
 * before anything else about the request.
 */
type Context = { params: Promise<{ fileId: string }> };

export async function DELETE(_req: NextRequest, context: Context) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { fileId } = await context.params;
  const result = await removeShowcaseOfficePhoto({ userId: gate.userId, fileId, actor: "professional" });
  return respondShowcase(result, (value) => value);
}
