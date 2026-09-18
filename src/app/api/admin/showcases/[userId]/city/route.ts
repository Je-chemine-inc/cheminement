import { NextRequest } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import { setShowcaseCity } from "@/lib/showcase-service";

/** A professional's page city, set by an admin (`{ cityKey }`, a city of the list). Live at once. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  const body = (await req.json().catch(() => null)) as { cityKey?: unknown } | null;
  const result = await setShowcaseCity({ userId, cityKey: body?.cityKey, actor: "admin", byUserId: gate.session.user.id });
  return respondShowcase(result, (value) => value);
}
