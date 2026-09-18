import { NextRequest } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import { updateShowcaseTeamResources } from "@/lib/showcase-service";

/**
 * The Je chemine resources a professional's page shows, set by an admin (`{ slugs }`, the whole list
 * in order). Live at once; the professional cannot remove them.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  const body = (await req.json().catch(() => null)) as { slugs?: unknown } | null;
  const result = await updateShowcaseTeamResources({ userId, slugs: body?.slugs, adminId: gate.session.user.id });
  return respondShowcase(result, (value) => value);
}
