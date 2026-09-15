import { NextRequest, NextResponse } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import { activateShowcase, listShowcasesForAdmin } from "@/lib/showcase-service";

/**
 * « Pages vitrines » (spec 003): every approved professional with the state of
 * their page, and activating one. Needs `manageProfessionals`.
 */
export async function GET() {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json(await listShowcasesForAdmin());
}

export async function POST(req: NextRequest) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => null)) as {
    userId?: unknown;
    slug?: unknown;
  } | null;
  const result = await activateShowcase({
    userId: typeof body?.userId === "string" ? body.userId : "",
    slug: body?.slug,
    adminId: gate.session.user.id,
  });
  return respondShowcase(result, (value) => value);
}
