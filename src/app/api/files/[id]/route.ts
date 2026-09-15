import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import StoredFile, { PRIVATE_STORED_FILE_KINDS } from "@/models/StoredFile";
import ShowcasePage from "@/models/ShowcasePage";
import User from "@/models/User";
import { isShowcaseEnabled } from "@/lib/showcase-settings";

/**
 * GET /api/files/[id]
 *
 * Streams a binary file persisted in MongoDB. Authentication required.
 * Access control is intentionally coarse here: any signed-in user may fetch
 * any file. Documents are referenced by hard-to-guess ObjectIds, and access
 * gating happens at the consumer-facing endpoints (e.g. /api/clients/[id]
 * /documents only returns IDs the caller is allowed to see). If we ever
 * surface file IDs to unauthenticated contexts, tighten this to check the
 * file's `kind` + the requester's role.
 */

/**
 * A showcase photo (spec 003) is public under the same conditions as the page
 * showing it: a published page uses it, the pages are open, and the
 * professional's account is active. Next's image optimizer fetches it without
 * cookies, so it must not need a session then.
 */
async function isPublicShowcasePhoto(fileId: mongoose.Types.ObjectId): Promise<boolean> {
  const page = await ShowcasePage.findOne({
    status: "published",
    $or: [{ "published.photoFileId": fileId }, { "published.officePhotoFileIds": fileId }],
  })
    .select("userId")
    .lean();
  if (!page || !(await isShowcaseEnabled())) return false;
  return Boolean(await User.exists({ _id: page.userId, role: "professional", status: "active" }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await connectToDatabase();
    const file = await StoredFile.findById(id).lean();
    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Kinds with their own, narrower route (an organization's claim form goes
    // to billing admins only). The same 404: not even whether it exists.
    if ((PRIVATE_STORED_FILE_KINDS as readonly string[]).includes(file.kind)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Quarantine: never stream a file the antivirus flagged as infected. (These
    // are already rejected at upload, so this only guards legacy/async rows.) A
    // 404 avoids confirming the file even exists.
    if (file.scanStatus === "infected") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Content images are referenced from PUBLIC pages (nouveautés, problématiques,
    // etc.), so they must be served without a session. Every other kind stays
    // behind authentication.
    const isShowcasePhoto = file.kind === "showcase-photo";
    // A professional's product image (spec 003 phase 5) is embedded in public
    // product pages like the team's content images.
    const isPublic =
      file.kind === "content-image" ||
      file.kind === "product-image" ||
      (isShowcasePhoto && (await isPublicShowcasePhoto(file._id)));
    if (!isPublic) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // A showcase photo that is not public: only the professional whose page
      // uses it (draft or published copy), whoever uploaded it, and admins. A
      // draft is not consent to be published.
      if (
        isShowcasePhoto &&
        !session.user.isAdmin &&
        String(file.uploadedBy ?? "") !== session.user.id &&
        !(await ShowcasePage.exists({
          userId: session.user.id,
          $or: [
            { "draft.photoFileId": file._id },
            { "published.photoFileId": file._id },
            { "draft.officePhotoFileIds": file._id },
            { "published.officePhotoFileIds": file._id },
          ],
        }))
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    // `.lean()` returns the raw driver value for `data`: a Node Buffer when the
    // bytes are promoted, but otherwise a BSON `Binary` whose payload lives under
    // `.buffer` (and whose `.length` is a method, so `Buffer.from(binary)` yields
    // an EMPTY buffer — a 200 with no body). Normalize to a real Buffer.
    const raw = file.data as unknown;
    const bytes = Buffer.isBuffer(raw)
      ? raw
      : raw && typeof raw === "object" && "buffer" in raw
        ? Buffer.from((raw as { buffer: Uint8Array }).buffer)
        : Buffer.from(raw as Uint8Array);
    const body = new Uint8Array(bytes);
    // Only content images (which the CMS/public pages embed via <img>) are served
    // inline. Every uploaded DOCUMENT is forced to download rather than render in
    // the browser, so a malicious PDF/SVG/HTML can't execute in our origin even if
    // it slipped past the scanner. `nosniff` stops MIME-confusion, and the
    // sandbox CSP neutralizes any script in an SVG/HTML opened directly.
    const disposition = isPublic ? "inline" : "attachment";
    // RFC 6266/5987: the quoted `filename` token must be ASCII (and is already
    // header-safe via sanitizeFileName at upload), while `filename*` carries the
    // real UTF-8 name so accented French filenames aren't mangled on download.
    const asciiName = file.fileName.replace(/[^ -~]/g, "_") || "file";
    // A showcase photo can stop being public (the page is taken down, consent
    // withdrawn): cached for an hour, not a day, and never marked immutable.
    const cacheControl = !isPublic
      ? "private, max-age=300"
      : isShowcasePhoto
        ? "public, max-age=3600"
        : "public, max-age=86400, immutable";
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": file.fileType || "application/octet-stream",
        "Content-Length": String(body.length),
        "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (error) {
    console.error("GET /api/files/[id]:", error);
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 },
    );
  }
}
