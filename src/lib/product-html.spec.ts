import { describe, it, expect } from "vitest";
import { sanitizeProductHtml } from "@/lib/product-html";

describe("sanitizeProductHtml", () => {
  it("keeps the formatting a product needs", () => {
    const html =
      "<h2>Titre</h2><p>Un <strong>texte</strong> <em>mis</em> en <u>forme</u>.</p><ul><li>Un</li></ul><blockquote>Citation</blockquote><hr>";
    expect(sanitizeProductHtml(html)).toBe(
      "<h2>Titre</h2><p>Un <strong>texte</strong> <em>mis</em> en <u>forme</u>.</p><ul><li>Un</li></ul><blockquote>Citation</blockquote><hr />",
    );
  });

  it("removes scripts, handlers, styles, frames and forms", () => {
    const fixtures = [
      '<p onclick="alert(1)">x</p>',
      "<script>alert(1)</script><p>x</p>",
      '<p style="background:url(javascript:alert(1))">x</p>',
      '<iframe src="https://evil.example"></iframe><p>x</p>',
      '<form action="https://evil.example"><input name="a"></form><p>x</p>',
      '<svg onload="alert(1)"></svg><p>x</p>',
      '<p class="fixed inset-0">x</p>',
      "<style>body{display:none}</style><p>x</p>",
    ];
    for (const fixture of fixtures) {
      expect(sanitizeProductHtml(fixture)).toBe("<p>x</p>");
    }
  });

  it("allows only https and mailto links, forced into a new tab without referrer", () => {
    expect(sanitizeProductHtml('<a href="https://example.com" target="_self" rel="opener">lien</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">lien</a>',
    );
    expect(sanitizeProductHtml('<a href="mailto:a@b.ca">écrire</a>')).toContain('href="mailto:a@b.ca"');
    expect(sanitizeProductHtml('<a href="javascript:alert(1)">x</a>')).toBe("");
    expect(sanitizeProductHtml('<a href="http://example.com">x</a>')).toBe("");
    expect(sanitizeProductHtml('<a href="//evil.example">x</a>')).toBe("");
  });

  it("keeps images only from the site's own file route", () => {
    expect(sanitizeProductHtml('<img src="/api/files/0123456789abcdef01234567" alt="schéma" onerror="x">')).toBe(
      '<img src="/api/files/0123456789abcdef01234567" alt="schéma" />',
    );
    expect(sanitizeProductHtml('<img src="https://tracker.example/pixel.gif">')).toBe("");
    expect(sanitizeProductHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe("");
    expect(sanitizeProductHtml('<img src="/api/files/../admin">')).toBe("");
  });
});
