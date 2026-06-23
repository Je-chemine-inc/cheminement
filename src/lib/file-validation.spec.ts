import { describe, it, expect } from "vitest";
import {
  detectMagicType,
  validateFileContent,
  sanitizeFileName,
} from "./file-validation";

const PDF = Buffer.from("%PDF-1.7\n", "latin1");
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from("GIF89a\x00\x00", "latin1");
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
// A real .docx ZIP names its OOXML parts in the (plaintext) local-file headers.
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
  Buffer.from("[Content_Types].xml"),
]);
const SVG = Buffer.from("<svg xmlns=x></svg>");
const SVG_XML = Buffer.from("<?xml version=1.0?>\n<svg xmlns=x></svg>");
const SVG_COMMENT = Buffer.from("<!-- Created with Editor -->\n<svg xmlns=x></svg>");
// Windows PE executable header ("MZ") — the classic "rename virus.exe to .pdf".
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("detectMagicType", () => {
  it("recognises common types from their magic bytes", () => {
    expect(detectMagicType(PDF)).toBe("application/pdf");
    expect(detectMagicType(PNG)).toBe("image/png");
    expect(detectMagicType(JPEG)).toBe("image/jpeg");
    expect(detectMagicType(GIF)).toBe("image/gif");
    expect(detectMagicType(WEBP)).toBe("image/webp");
    expect(detectMagicType(OLE2)).toBe("application/msword");
    expect(detectMagicType(ZIP)).toBe("application/zip");
    expect(detectMagicType(SVG)).toBe("image/svg+xml");
    expect(detectMagicType(SVG_XML)).toBe("image/svg+xml");
    expect(detectMagicType(SVG_COMMENT)).toBe("image/svg+xml");
  });

  it("returns 'unknown' for an executable / unrecognised content", () => {
    expect(detectMagicType(EXE)).toBe("unknown");
    expect(detectMagicType(Buffer.from("just some text"))).toBe("unknown");
  });
});

describe("validateFileContent", () => {
  const IMG = ["image/jpeg", "image/png"];
  const PDF_ONLY = ["application/pdf"];

  it("accepts content that matches its declared type", () => {
    expect(validateFileContent(PDF, "application/pdf", PDF_ONLY).ok).toBe(true);
    expect(validateFileContent(PNG, "image/png", IMG).ok).toBe(true);
  });

  it("treats image/jpg as a JPEG alias", () => {
    expect(validateFileContent(JPEG, "image/jpg", ["image/jpg"]).ok).toBe(true);
  });

  it("accepts a real OOXML .docx (ZIP carrying [Content_Types].xml)", () => {
    expect(validateFileContent(DOCX, DOCX_MIME, [DOCX_MIME]).ok).toBe(true);
  });

  it("rejects a plain ZIP / renamed .jar masquerading as a .docx", () => {
    const r = validateFileContent(ZIP, DOCX_MIME, [DOCX_MIME]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("content_mismatch");
  });

  it("REJECTS an executable disguised as a PDF (the core attack)", () => {
    const r = validateFileContent(EXE, "application/pdf", PDF_ONLY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("content_mismatch");
  });

  it("rejects a PNG uploaded while claiming to be a PDF", () => {
    const r = validateFileContent(PNG, "application/pdf", PDF_ONLY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("content_mismatch");
  });

  it("rejects a declared type that is not in the allow-list", () => {
    const r = validateFileContent(PDF, "application/x-msdownload", PDF_ONLY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("type_not_allowed");
  });
});

describe("sanitizeFileName", () => {
  it("strips any directory path", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\evil.pdf")).toBe("evil.pdf");
  });

  it("replaces header/filesystem metacharacters with underscores", () => {
    expect(sanitizeFileName("a<b>c.pdf")).toBe("a_b_c.pdf");
    expect(sanitizeFileName("re|port?.pdf")).toBe("re_port_.pdf");
  });

  it("keeps spaces but collapses repeated whitespace", () => {
    expect(sanitizeFileName("my report.pdf")).toBe("my report.pdf");
    expect(sanitizeFileName("bad   name.pdf")).toBe("bad name.pdf");
  });

  it("drops leading dots and falls back when empty", () => {
    expect(sanitizeFileName("...hidden")).toBe("hidden");
    expect(sanitizeFileName("")).toBe("fichier");
    expect(sanitizeFileName(null)).toBe("fichier");
  });

  it("caps very long names while preserving the extension", () => {
    const long = "a".repeat(500) + ".pdf";
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});
