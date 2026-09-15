import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import ShowcasePage from "@/models/ShowcasePage";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { SHOWCASE_PHOTO } from "@/lib/showcase-constants";
import { respondShowcase } from "@/lib/showcase-http";
import { storeShowcasePhoto } from "@/lib/showcase-photo";
import { addShowcaseOfficePhoto } from "@/lib/showcase-service";

/** An admin adds a photo of the office to a professional's draft page (multipart `file`). */
type Params = { params: Promise<{ userId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > SHOWCASE_PHOTO.maxBytes + 1024 * 1024) {
    return NextResponse.json({ error: "PHOTO_TOO_LARGE" }, { status: 413 });
  }
  if (!mongoose.Types.ObjectId.isValid(userId) || !(await ShowcasePage.exists({ userId }))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const stored = await storeShowcasePhoto(form?.get("file") ?? null, gate.session.user.id);
  if (!stored.ok) return NextResponse.json({ error: stored.code }, { status: stored.status });
  const result = await addShowcaseOfficePhoto({ userId, fileId: stored.fileId, actor: "admin" });
  return respondShowcase(result, (value) => value);
}
