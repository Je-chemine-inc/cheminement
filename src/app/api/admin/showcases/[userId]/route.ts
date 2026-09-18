import { NextRequest, NextResponse } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import {
  loadShowcaseAdminView,
  moveShowcase,
  publishShowcase,
  republishShowcase,
  saveShowcaseDraft,
  unpublishShowcase,
} from "@/lib/showcase-service";

/**
 * One professional's showcase page, for an admin who manages professionals:
 * read it (draft, published copy, history), prepare the draft, and act on it.
 *
 * POST `{ action }`:
 *  - `publish` + `revision` (+ `consentAttested: true` when the professional's
 *    agreement is not on record yet): publish the draft revision the admin
 *    looked at (409 REVISION_CHANGED if it changed since);
 *  - `unpublish` + optional `note`, `republish`;
 *  - `move` + `slug` (the city follows the profile's office address).
 */
type Params = { params: Promise<{ userId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  const view = await loadShowcaseAdminView(userId);
  return view
    ? NextResponse.json(view)
    : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const result = await saveShowcaseDraft({ userId, body, actor: "admin" });
  return respondShowcase(result, () => loadShowcaseAdminView(userId));
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  const adminId = gate.session.user.id;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const view = () => loadShowcaseAdminView(userId);

  switch (body?.action) {
    case "publish":
      return respondShowcase(
        await publishShowcase({ userId, revision: body.revision, consentAttested: body.consentAttested, adminId }),
        view,
      );
    case "unpublish":
      return respondShowcase(
        await unpublishShowcase({ userId, actor: "admin", byUserId: adminId, note: body.note }),
        view,
      );
    case "republish":
      return respondShowcase(
        await republishShowcase({ userId, actor: "admin", byUserId: adminId }),
        view,
      );
    case "move":
      return respondShowcase(
        await moveShowcase({ userId, slug: body.slug, adminId }),
        view,
      );
    default:
      return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  }
}
