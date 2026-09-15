import sanitizeHtml from "sanitize-html";

/**
 * The HTML a professional may put in a product (spec 003 phase 5). Their text
 * is rendered on www with `dangerouslySetInnerHTML`, so it is cleaned on every
 * write by a professional and again when the team approves it — never at render.
 *
 * An allowlist: paragraphs, headings, lists, emphasis, quotes, rules, https or
 * mailto links (opened in a new tab without referrer), and images only from the
 * site's own file route. No style, no class, no script, no frame, no form.
 */

const FILE_IMAGE = /^\/api\/files\/[a-f0-9]{24}$/;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "h2", "h3", "ul", "ol", "li", "strong", "em", "s", "u", "blockquote", "a", "img", "hr"],
  allowedAttributes: {
    a: ["href", "rel", "target"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: [] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { href: attribs.href ?? "", rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
    b: "strong",
    i: "em",
    h1: "h2",
    h4: "h3",
  },
  exclusiveFilter: (frame) =>
    (frame.tag === "img" && !FILE_IMAGE.test(frame.attribs.src ?? "")) ||
    (frame.tag === "a" && !frame.attribs.href),
};

export function sanitizeProductHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}
