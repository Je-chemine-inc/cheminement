import { describe, it, expect } from "vitest";
import {
  parseSections,
  serializeSections,
  escapeHtml,
} from "@/lib/legal-sections";

describe("parseSections", () => {
  it("splits intro + one section per <h2> (body = up to next h2)", () => {
    const html =
      "<p>Intro paragraph.</p>\n<h2>1. Objet</h2>\n<p>Body one.</p>\n<h2>2. Durée</h2>\n<p>Body two.</p>";
    const { intro, sections } = parseSections(html);
    expect(intro).toBe("<p>Intro paragraph.</p>");
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("1. Objet");
    expect(sections[0].bodyHtml).toBe("<p>Body one.</p>");
    expect(sections[1].title).toBe("2. Durée");
    expect(sections[1].bodyHtml).toBe("<p>Body two.</p>");
  });

  it("keeps H3 subsections inside the section body (only H2 splits)", () => {
    const html =
      "<h2>Section</h2><h3>Sub</h3><p>x</p><h2>Next</h2><p>y</p>";
    const { sections } = parseSections(html);
    expect(sections).toHaveLength(2);
    expect(sections[0].bodyHtml).toBe("<h3>Sub</h3><p>x</p>");
    expect(sections[1].title).toBe("Next");
  });

  it("strips tags from the heading to a plain title", () => {
    const { sections } = parseSections("<h2><strong>Bold</strong> title</h2><p>b</p>");
    expect(sections[0].title).toBe("Bold title");
  });

  it("treats content with no <h2> as a single intro block", () => {
    const { intro, sections } = parseSections("<p>Just a paragraph.</p>");
    expect(sections).toHaveLength(0);
    expect(intro).toBe("<p>Just a paragraph.</p>");
  });

  it("handles empty / null-ish input", () => {
    expect(parseSections("")).toEqual({ intro: "", sections: [] });
    // @ts-expect-error exercising the null guard
    expect(parseSections(undefined)).toEqual({ intro: "", sections: [] });
  });
});

describe("serializeSections", () => {
  it("reassembles intro + <h2> + body and escapes the title", () => {
    const html = serializeSections("<p>Intro.</p>", [
      { title: "A & B", bodyHtml: "<p>x</p>" },
      { title: "C", bodyHtml: "<p>y</p>" },
    ]);
    expect(html).toBe(
      "<p>Intro.</p>\n<h2>A &amp; B</h2>\n<p>x</p>\n<h2>C</h2>\n<p>y</p>",
    );
  });

  it("omits an empty intro and empty bodies", () => {
    const html = serializeSections("   ", [{ title: "Only title", bodyHtml: "" }]);
    expect(html).toBe("<h2>Only title</h2>");
  });

  it("round-trips parse → serialize without losing sections", () => {
    const original =
      "<p>Intro.</p>\n<h2>1. Objet</h2>\n<p>Body one.</p>\n<h2>2. Durée</h2>\n<ul><li>a</li></ul>";
    const parsed = parseSections(original);
    const round = serializeSections(parsed.intro, parsed.sections);
    expect(parseSections(round)).toEqual(parsed);
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >", () => {
    expect(escapeHtml('a & b < c > d')).toBe("a &amp; b &lt; c &gt; d");
  });
});
