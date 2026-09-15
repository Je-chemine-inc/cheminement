import { describe, expect, it } from "vitest";
import {
  ARTICLE_HTML_MAX_BYTES,
  ARTICLE_SUMMARY_MAX,
  ARTICLE_TITLE_MAX,
  articleMissing,
  articleSlugCandidates,
  parseArticleWrite,
} from "@/lib/article-rules";

describe("parseArticleWrite", () => {
  it("keeps only the writable fields, trimmed, and drops status, owner, slug, moderation and listing", () => {
    const parsed = parseArticleWrite({
      titleFr: "  Mieux dormir  ",
      summaryEn: " Sleep better ",
      contentHtmlFr: "<p>Texte</p>",
      iconUrl: "/api/files/0123456789abcdef01234567",
      status: "published",
      ownerProfessionalId: "x",
      slug: "autre",
      moderation: { status: "approved" },
      listInLibrary: true,
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        titleFr: "Mieux dormir",
        summaryEn: "Sleep better",
        contentHtmlFr: "<p>Texte</p>",
        iconUrl: "/api/files/0123456789abcdef01234567",
      },
    });
  });

  it("refuses an empty French title, a title or summary too long, HTML too large or not text, and an image from elsewhere", () => {
    expect(parseArticleWrite({ titleFr: "  " })).toEqual({ ok: false, code: "INVALID_TITLE", field: "titleFr" });
    expect(parseArticleWrite({ titleEn: "x".repeat(ARTICLE_TITLE_MAX + 1) })).toMatchObject({ code: "INVALID_TITLE", field: "titleEn" });
    expect(parseArticleWrite({ summaryFr: "x".repeat(ARTICLE_SUMMARY_MAX + 1) })).toMatchObject({ code: "INVALID_SUMMARY" });
    expect(parseArticleWrite({ contentHtmlFr: "x".repeat(ARTICLE_HTML_MAX_BYTES + 1) })).toMatchObject({ code: "HTML_TOO_LARGE" });
    expect(parseArticleWrite({ contentHtmlEn: 42 })).toMatchObject({ code: "INVALID_HTML", field: "contentHtmlEn" });
    expect(parseArticleWrite({ iconUrl: "https://tracker.example/p.gif" })).toMatchObject({ code: "INVALID_IMAGE" });
    expect(parseArticleWrite(null)).toMatchObject({ ok: false });
  });

  it("clears the cover with null or an empty string, and lets the English title be empty", () => {
    expect(parseArticleWrite({ iconUrl: "" })).toEqual({ ok: true, value: { iconUrl: null } });
    expect(parseArticleWrite({ iconUrl: null, titleEn: "" })).toEqual({ ok: true, value: { iconUrl: null, titleEn: "" } });
  });
});

describe("articleMissing", () => {
  it("needs a French title, a summary, some text and the attestation", () => {
    expect(articleMissing({ titleFr: "", summaryFr: " ", contentHtmlFr: "<p> &nbsp;</p><img src=\"/api/files/x\">", attested: false })).toEqual([
      "title",
      "summary",
      "content",
      "attestation",
    ]);
    expect(articleMissing({ titleFr: "Titre", summaryFr: "Résumé", contentHtmlFr: "<p>Du texte</p>", attested: true })).toEqual([]);
  });
});

describe("articleSlugCandidates", () => {
  it("builds the address from the title, avoids reserved words and suffixes the next ones", () => {
    expect(articleSlugCandidates("Mieux dormir à Laval", 3)).toEqual(["mieux-dormir-a-laval", "mieux-dormir-a-laval-2", "mieux-dormir-a-laval-3"]);
    expect(articleSlugCandidates("New", 1)).toEqual(["new-article"]);
    expect(articleSlugCandidates("!!!", 1)).toEqual(["article"]);
  });
});
