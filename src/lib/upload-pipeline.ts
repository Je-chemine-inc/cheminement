/**
 * Shared upload pipeline: every upload route funnels its incoming `File` through
 * here so size, real-content, and malware checks are applied IDENTICALLY (no
 * per-route drift). Returns either a ready-to-store payload or an HTTP error.
 *
 *   1. size limit
 *   2. declared-type allow-list
 *   3. magic-byte content check (content must match the declared type)
 *   4. malware scan — a CONFIRMED infection is rejected here, before storage
 *
 * The returned `scanStatus` ("clean" | "skipped" | "error") is persisted on the
 * StoredFile so the serving layer and admins can see how each file was cleared.
 */

import { validateFileContent, sanitizeFileName } from "./file-validation";
import { scanBufferForViruses } from "./virus-scan";

export type StoredScanStatus = "clean" | "skipped" | "error";

export interface PreparedUpload {
  buffer: Buffer;
  /** Sanitized, safe-to-store filename. */
  fileName: string;
  scanStatus: StoredScanStatus;
}

export type PrepareResult =
  | { ok: true; value: PreparedUpload }
  | { ok: false; status: number; error: string };

export interface PrepareOptions {
  allowedTypes: string[];
  maxSize: number;
}

export async function prepareAndScanUpload(
  file: File,
  { allowedTypes, maxSize }: PrepareOptions,
): Promise<PrepareResult> {
  if (file.size > maxSize) {
    return {
      ok: false,
      status: 400,
      error: `File size exceeds ${Math.round(maxSize / 1024 / 1024)}MB limit`,
    };
  }
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, status: 400, error: "Invalid file type." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The bytes must actually be the kind of file the uploader claims.
  const content = validateFileContent(buffer, file.type, allowedTypes);
  if (!content.ok) {
    return {
      ok: false,
      status: 400,
      error:
        "Le contenu du fichier ne correspond pas à son type. / File content does not match its declared type.",
    };
  }

  const fileName = sanitizeFileName(file.name);

  // Malware scan. A confirmed infection is rejected before anything is stored.
  const scan = await scanBufferForViruses(buffer, fileName);
  if (scan.status === "infected") {
    console.warn(
      `[upload] Rejected infected file "${fileName}": ${scan.detail ?? "threat"}`,
    );
    return {
      ok: false,
      status: 422,
      error:
        "Fichier rejeté : logiciel malveillant détecté. / File rejected: malware detected.",
    };
  }

  return {
    ok: true,
    value: { buffer, fileName, scanStatus: scan.status },
  };
}
