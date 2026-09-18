import { NextRequest } from "next/server";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { setShowcaseCity } from "@/lib/showcase-service";

/**
 * The professional's own page city (`{ cityKey }`, a city of the list). Live at once, once the page
 * has been published; the team is told, as for any live edit.
 */
export async function PUT(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => null)) as { cityKey?: unknown } | null;
  const result = await setShowcaseCity({ userId: gate.userId, cityKey: body?.cityKey, actor: "professional", byUserId: gate.userId });
  return respondShowcase(result, (value) => value);
}
