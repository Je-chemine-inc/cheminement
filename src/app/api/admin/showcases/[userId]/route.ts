import { NextRequest, NextResponse } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import {
  approveShowcase,
  loadShowcaseAdminView,
  moveShowcase,
  remindShowcase,
  republishShowcase,
  requestShowcaseChanges,
  saveShowcaseDraft,
  unpublishShowcase,
} from "@/lib/showcase-service";

/**
 * One professional's showcase page, for an admin who manages professionals:
 * read it (draft, published copy, history), correct the draft, and act on it.
 *
 * POST `{ action }`:
 *  - `approve` + `revision`: publish the draft revision the admin looked at
 *    (409 REVISION_CHANGED if it changed since);
 *  - `request_changes` + `notes`;
 *  - `unpublish` + optional `note`, `republish`;
 *  - `remind` (at most once a day, before submission);
 *  - `move` + `slug` and/or `cityKey`.
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
    case "approve":
      return respondShowcase(await approveShowcase({ userId, revision: body.revision, adminId }), view);
    case "request_changes":
      return respondShowcase(await requestShowcaseChanges({ userId, notes: body.notes, adminId }), view);
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
    case "remind":
      return respondShowcase(await remindShowcase({ userId, adminId }), view);
    case "move":
      return respondShowcase(
        await moveShowcase({ userId, slug: body.slug, cityKey: body.cityKey, adminId }),
        view,
      );
    default:
      return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  }
}
