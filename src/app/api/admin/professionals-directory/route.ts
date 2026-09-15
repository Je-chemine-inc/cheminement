import { NextRequest, NextResponse } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { parseDirectoryCuration } from "@/lib/professionals-directory";
import {
  loadProfessionalsDirectoryAdmin,
  saveProfessionalsDirectoryCuration,
} from "@/lib/professionals-directory-queries";

/**
 * « Nos professionnels (site) »: who the team hides from www /professionnels and in what order.
 * GET: every active professional in the public order. PUT: the order and hidden list, replaced whole,
 * refused when someone saved since the screen loaded.
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json(await loadProfessionalsDirectoryAdmin(), { headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;

  const input = parseDirectoryCuration(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "INVALID" }, { status: 400 });

  const result = await saveProfessionalsDirectoryCuration({ ...input, adminId: gate.session.user.id });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 409 });
  console.info(
    `[professionals-directory] order (${input.order.length}) and hidden (${input.hidden.length}) saved by admin ${gate.session.user.id}`,
  );
  return NextResponse.json(await loadProfessionalsDirectoryAdmin(), { headers: NO_STORE });
}
