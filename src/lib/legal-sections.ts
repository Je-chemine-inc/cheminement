/**
 * Parse/serialize a legal document's contentHtml as an ordered list of sections,
 * powering the admin section-cards editor (add / edit / reorder / delete).
 *
 * DOM-FREE (regex only) so it runs in the Node test environment AND on the
 * server. The stored format is unchanged contentHtml: an optional intro followed
 * by `<h2>title</h2>` + body per section — exactly what buildContentHtml produces
 * and what LegalPage renders. So this is purely an editing *view*; no data-model
 * change, no migration, and the public page + TOC keep working as-is.
 */

export interface LegalSection {
  /** Plain-text section title (rendered as an <h2>; drives the public TOC). */
  title: string;
  /** Inner HTML of the section (paragraphs, lists, H3 subsections, callouts…). */
  bodyHtml: string;
}

export interface ParsedLegalContent {
  /** Content before the first <h2> (shown without a heading). */
  intro: string;
  sections: LegalSection[];
}

// Top-level section boundaries are <h2> tags (H3 stays inside a section body).
const H2_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

/** Strip tags + decode the few entities we emit, collapse whitespace → plain title. */
function toPlainTitle(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Split contentHtml into an intro (everything before the first <h2>) and one
 * section per <h2> (title = h2 text, bodyHtml = everything up to the next <h2>).
 * Content with no <h2> becomes a single intro block (no sections).
 */
export function parseSections(html: string): ParsedLegalContent {
  const src = html ?? "";
  const heads: { start: number; end: number; title: string }[] = [];
  H2_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = H2_RE.exec(src)) !== null) {
    heads.push({
      start: m.index,
      end: m.index + m[0].length,
      title: toPlainTitle(m[1]),
    });
  }

  if (heads.length === 0) {
    return { intro: src.trim(), sections: [] };
  }

  const intro = src.slice(0, heads[0].start).trim();
  const sections: LegalSection[] = heads.map((h, i) => {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : src.length;
    return { title: h.title, bodyHtml: src.slice(h.end, bodyEnd).trim() };
  });

  return { intro, sections };
}

/** Reassemble intro + sections into contentHtml (mirrors buildContentHtml). */
export function serializeSections(
  intro: string,
  sections: LegalSection[],
): string {
  const parts: string[] = [];
  const trimmedIntro = (intro ?? "").trim();
  if (trimmedIntro) parts.push(trimmedIntro);
  for (const s of sections) {
    parts.push(`<h2>${escapeHtml((s.title ?? "").trim())}</h2>`);
    const body = (s.bodyHtml ?? "").trim();
    if (body) parts.push(body);
  }
  return parts.join("\n");
}
