import { NextRequest, NextResponse } from "next/server";
import ShowcasePage from "@/models/ShowcasePage";
import { rateLimit } from "@/lib/rate-limit";
import { SHOWCASE_PHOTO } from "@/lib/showcase-constants";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { storeShowcasePhoto } from "@/lib/showcase-photo";
import { setShowcaseOfficePhoto } from "@/lib/showcase-service";

/**
 * Sets the photo of the office on the professional's published page (multipart
 * `file`), live at once, replacing the one shown: a page has one. Same file
 * rules as the portrait; refused while the page is in preparation. A file that
 * cannot be set is deleted.
 */
export async function POST(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  // Shares the portrait's budget: photos of any kind for this page.
  if (!rateLimit(`showcase-photo:${gate.userId}`, 20, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > SHOWCASE_PHOTO.maxBytes + 1024 * 1024) {
    return NextResponse.json({ error: "PHOTO_TOO_LARGE" }, { status: 413 });
  }
  if (!(await ShowcasePage.exists({ userId: gate.userId }))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const stored = await storeShowcasePhoto(form?.get("file") ?? null, gate.userId);
  if (!stored.ok) return NextResponse.json({ error: stored.code }, { status: stored.status });
  const result = await setShowcaseOfficePhoto({ userId: gate.userId, fileId: stored.fileId, actor: "professional" });
  return respondShowcase(result, (value) => value);
}
