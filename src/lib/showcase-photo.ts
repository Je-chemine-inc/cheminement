import "server-only";
import StoredFile from "@/models/StoredFile";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";
import { readImageDimensions } from "@/lib/image-dimensions";
import { SHOWCASE_PHOTO } from "@/lib/showcase-constants";

/**
 * A professional's photo for their showcase page (spec 003). Stricter than
 * other uploads because it can become public: JPEG, PNG or WebP only (no SVG),
 * at most 5 MB, at least 400 px on its shortest side, and refused when the
 * antivirus could not be reached.
 */
export type PhotoUploadResult =
  | { ok: true; fileId: string }
  | {
      ok: false;
      status: number;
      code:
        | "NO_FILE"
        | "PHOTO_TOO_LARGE"
        | "PHOTO_INVALID"
        | "PHOTO_TOO_SMALL"
        | "PHOTO_INFECTED"
        | "SCAN_UNAVAILABLE";
    };

export async function storeShowcasePhoto(
  file: FormDataEntryValue | null,
  uploadedBy: string,
): Promise<PhotoUploadResult> {
  if (!file || typeof file === "string") return { ok: false, status: 400, code: "NO_FILE" };
  if (file.size > SHOWCASE_PHOTO.maxBytes) {
    return { ok: false, status: 413, code: "PHOTO_TOO_LARGE" };
  }

  const prepared = await prepareAndScanUpload(file, {
    allowedTypes: [...SHOWCASE_PHOTO.types],
    maxSize: SHOWCASE_PHOTO.maxBytes,
  });
  if (!prepared.ok) {
    return prepared.status === 422
      ? { ok: false, status: 422, code: "PHOTO_INFECTED" }
      : { ok: false, status: 400, code: "PHOTO_INVALID" };
  }
  // A photo may go public: an unscanned file is not accepted when the scanner
  // failed (a scanner that is simply not configured still reports "skipped").
  if (prepared.value.scanStatus === "error") {
    return { ok: false, status: 503, code: "SCAN_UNAVAILABLE" };
  }

  const size = readImageDimensions(prepared.value.buffer);
  if (!size) return { ok: false, status: 400, code: "PHOTO_INVALID" };
  if (Math.min(size.width, size.height) < SHOWCASE_PHOTO.minSide) {
    return { ok: false, status: 400, code: "PHOTO_TOO_SMALL" };
  }

  const stored = await StoredFile.create({
    fileName: prepared.value.fileName,
    fileType: file.type,
    fileSize: file.size,
    data: prepared.value.buffer,
    kind: "showcase-photo",
    uploadedBy,
    scanStatus: prepared.value.scanStatus,
  });
  return { ok: true, fileId: String(stored._id) };
}

/**
 * Deletes the photos among `candidates` that no copy of a page shows any
 * more. A photo the published snapshot still shows is never deleted, even
 * when the draft replaced it.
 */
export async function deleteUnreferencedShowcasePhotos(
  candidates: readonly unknown[],
  stillReferenced: readonly unknown[],
): Promise<void> {
  const keep = new Set(stillReferenced.filter(Boolean).map(String));
  const ids = [...new Set(candidates.filter(Boolean).map(String))].filter((id) => !keep.has(id));
  if (ids.length === 0) return;
  await StoredFile.deleteMany({ _id: { $in: ids }, kind: "showcase-photo" });
}
