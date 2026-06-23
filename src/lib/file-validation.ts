/**
 * File-content validation (defense-in-depth for uploads).
 *
 * The upload routes only ever saw the *declared* MIME type (`File.type`), which
 * the uploader fully controls — so a `virus.exe` renamed to `referral.pdf` with
 * `Content-Type: application/pdf` sailed straight through. These helpers read the
 * real bytes ("magic numbers") to confirm the content matches the declared type,
 * and sanitize the filename before it is stored or echoed back in a header.
 *
 * Pure functions only (no I/O) so they are cheap to unit-test.
 */

/** Canonical content types we can recognise from magic bytes. */
export type DetectedType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml"
  | "application/msword" // legacy OLE2 Office (.doc/.xls/.ppt)
  | "application/zip" // ZIP container — also OOXML (.docx/.xlsx/.pptx)
  | "unknown";

const startsWith = (buf: Buffer, sig: number[], offset = 0): boolean => {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
};

/**
 * Heuristic SVG sniff: SVG is XML text, so it has no fixed binary signature.
 * We decode the first ~1 KB and look for an `<svg` root (optionally preceded by
 * an XML prolog / BOM / whitespace). This also means an HTML file masquerading
 * as an image is rejected unless it is genuinely an `<svg>` document.
 */
const looksLikeSvg = (buf: Buffer): boolean => {
  const head = buf
    .subarray(0, 2048)
    .toString("utf8")
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();
  // Must be markup, then contain an <svg root somewhere in the head. This still
  // accepts an SVG that opens with an XML prolog, a comment, or a DOCTYPE before
  // the <svg> element, while rejecting arbitrary text that merely mentions svg.
  if (!head.startsWith("<")) return false;
  return /<svg[\s>]/.test(head);
};

/** Detect a file's real type from its leading bytes. */
export function detectMagicType(buf: Buffer): DetectedType {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (
    startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || // GIF87a
    startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
  )
    return "image/gif";
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8) // WEBP at offset 8
  )
    return "image/webp";
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "application/msword"; // OLE2 compound document (legacy Office)
  // ZIP local-file header (PK\x03\x04 and the empty/spanned variants). OOXML
  // (.docx) is a ZIP, so a docx detects as "application/zip" here.
  if (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
  )
    return "application/zip";
  if (looksLikeSvg(buf)) return "image/svg+xml";
  return "unknown";
}

/**
 * Which detected types are acceptable for a given DECLARED MIME type. A declared
 * type with no entry here is treated as unverifiable (fail closed).
 */
const DECLARED_TO_DETECTED: Record<string, DetectedType[]> = {
  "application/pdf": ["application/pdf"],
  "image/jpeg": ["image/jpeg"],
  "image/jpg": ["image/jpeg"],
  "image/png": ["image/png"],
  "image/gif": ["image/gif"],
  "image/webp": ["image/webp"],
  "image/svg+xml": ["image/svg+xml"],
  "application/msword": ["application/msword"],
  // .docx is a ZIP container; magic bytes can't tell it apart from a plain ZIP,
  // so we accept the ZIP signature for the OOXML Word MIME type.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "application/zip",
  ],
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * A ZIP only counts as a real .docx if it actually carries OOXML parts. The ZIP
 * local-file headers store entry names as plaintext right after the PK
 * signature, so a genuine .docx has "[Content_Types].xml" (and word/document.xml)
 * near the start, while a renamed .jar/.apk/.zip does not. Guards the one route
 * that accepts the docx MIME (employee-cv) against a disguised archive.
 */
const looksLikeOoxmlDocx = (buf: Buffer): boolean => {
  const head = buf.subarray(0, 4096).toString("latin1");
  return (
    head.includes("[Content_Types].xml") || head.includes("word/document.xml")
  );
};

export type ContentCheck =
  | { ok: true; detected: DetectedType }
  | {
      ok: false;
      reason: "type_not_allowed" | "unverifiable_type" | "content_mismatch";
      detected: DetectedType;
    };

/**
 * Confirm the buffer's real content matches its declared type AND that the
 * declared type is in the route's allow-list. Fails closed: an unknown signature
 * or a declared type we have no signature for is rejected.
 */
export function validateFileContent(
  buffer: Buffer,
  declaredType: string,
  allowedTypes: string[],
): ContentCheck {
  const detected = detectMagicType(buffer);
  if (!allowedTypes.includes(declaredType)) {
    return { ok: false, reason: "type_not_allowed", detected };
  }
  const expected = DECLARED_TO_DETECTED[declaredType];
  if (!expected) {
    return { ok: false, reason: "unverifiable_type", detected };
  }
  if (!expected.includes(detected)) {
    return { ok: false, reason: "content_mismatch", detected };
  }
  // A ZIP signature alone isn't enough to trust a .docx — require OOXML parts.
  if (
    declaredType === DOCX_MIME &&
    detected === "application/zip" &&
    !looksLikeOoxmlDocx(buffer)
  ) {
    return { ok: false, reason: "content_mismatch", detected };
  }
  return { ok: true, detected };
}

const FORBIDDEN_NAME_CHARS = new Set([
  "<",
  ">",
  ":",
  '"',
  "|",
  "?",
  "*",
  "\\",
  "/",
]);

/**
 * Make a user-supplied filename safe to store and to echo back in a
 * Content-Disposition header: strip any path, control characters, and header /
 * filesystem metacharacters; drop leading dots (hidden files); cap the length.
 */
export function sanitizeFileName(
  name: string | null | undefined,
  fallback = "fichier",
): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  let clean = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    clean += code < 0x20 || code === 0x7f || FORBIDDEN_NAME_CHARS.has(ch)
      ? "_"
      : ch;
  }
  clean = clean
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!clean) clean = fallback;
  if (clean.length > 200) {
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 ? clean.slice(dot) : "";
    clean = clean.slice(0, 200 - ext.length) + ext;
  }
  return clean;
}
