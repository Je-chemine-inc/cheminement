import { NextRequest } from "next/server";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { moveShowcaseOfficePhoto, removeShowcaseOfficePhoto } from "@/lib/showcase-service";

/**
 * One office photo of the professional's published page, live at once:
 * DELETE removes it, PATCH `{ direction: "up" | "down" }` moves it one place.
 * Only a photo on the signed-in professional's own page (404 otherwise).
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

export async function PATCH(req: NextRequest, context: Context) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const { fileId } = await context.params;
  const body = (await req.json().catch(() => null)) as { direction?: unknown } | null;
  const result = await moveShowcaseOfficePhoto({
    userId: gate.userId,
    fileId,
    direction: body?.direction,
    actor: "professional",
  });
  return respondShowcase(result, (value) => value);
}
