import { describe, it, expect } from "vitest";
import { DESCRIPTION_MAX, contentSocialMetadata, pageDescription } from "@/lib/content-metadata";

/**
 * Pins the fix for every shared article showing the generic site name.
 *
 * The regression is silent — the page still renders, the title tag is right,
 * and only a link preview on Facebook/LinkedIn/X reveals it — so it is worth
 * asserting that BOTH blocks are produced, not just Open Graph.
 */
describe("contentSocialMetadata", () => {
  const doc = {
    title: "Apaiser l'anxiété au quotidien",
    summary: "Des gestes simples pour retrouver du calme.",
    iconUrl: "/uploads/anxiete.png",
  };

  it("sets the page title on both Open Graph and Twitter", () => {
    const meta = contentSocialMetadata(doc);
    expect(meta.openGraph?.title).toBe(doc.title);
    // Twitter does NOT inherit from openGraph here: the root layout defines
    // twitter.title, so leaving it unset ships the site name instead.
    expect(meta.twitter?.title).toBe(doc.title);
  });

  it("carries the summary as the preview description", () => {
    const meta = contentSocialMetadata(doc);
    expect(meta.openGraph?.description).toBe(doc.summary);
    expect(meta.twitter?.description).toBe(doc.summary);
  });

  it("passes the icon through as the preview image", () => {
    const meta = contentSocialMetadata(doc);
    expect(meta.openGraph?.images).toEqual([doc.iconUrl]);
    expect(meta.twitter?.images).toEqual([doc.iconUrl]);
  });

  it("omits an empty summary rather than emitting an empty description", () => {
    const meta = contentSocialMetadata({ ...doc, summary: "" });
    expect(meta.openGraph?.description).toBeUndefined();
    expect(meta.twitter?.description).toBeUndefined();
  });

  it("omits images when the entry has no icon", () => {
    for (const iconUrl of [undefined, null, ""]) {
      const meta = contentSocialMetadata({ ...doc, iconUrl });
      expect(meta.openGraph?.images).toBeUndefined();
      expect(meta.twitter?.images).toBeUndefined();
    }
  });

  it("still titles the preview when only a title is known", () => {
    const meta = contentSocialMetadata({ title: "Sans résumé" });
    expect(meta.openGraph?.title).toBe("Sans résumé");
    expect(meta.twitter?.title).toBe("Sans résumé");
  });
});

/**
 * The detail pages — every article under /explore, /approaches, /nouveautes, /medias and /book —
 * shipped no og:site_name until 2026-09-18: this builder wrote their openGraph block without it,
 * and Next replaces a nested metadata object rather than merging it with the layout's.
 */
describe("contentSocialMetadata and the site's name", () => {
  it("names the site on every article's Open Graph block", () => {
    const meta = contentSocialMetadata({ title: "Anxiété", summary: "Un texte." }) as { openGraph: Record<string, unknown> };
    expect(meta.openGraph.siteName).toBe("Je chemine");
    expect(meta.openGraph.type).toBe("website");
    // And never the site's address: that belongs to the page.
    expect(meta.openGraph).not.toHaveProperty("url");
  });
});

describe("pageDescription", () => {
  it("keeps a short description as written, on one line", () => {
    expect(pageDescription("  Des gestes simples,\n\n  pour retrouver du calme.  ")).toBe("Des gestes simples, pour retrouver du calme.");
  });

  it("keeps every letter — it collapses whitespace, not the letter s", () => {
    expect(pageDescription("Soins et services")).toBe("Soins et services");
  });

  it("is nothing when there is nothing to say", () => {
    expect(pageDescription(undefined)).toBeUndefined();
    expect(pageDescription(null)).toBeUndefined();
    expect(pageDescription("   ")).toBeUndefined();
  });

  it("cuts a long one at a word, within what Google shows, and says it was cut", () => {
    const long = "Bienvenue sur Je chemine, une nouvelle plateforme québécoise pour vous accompagner dans votre cheminement en santé mentale, avec des professionnels qualifiés partout.";
    expect(long.length).toBeGreaterThan(DESCRIPTION_MAX);
    const cut = pageDescription(long)!;
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1)).not.toMatch(/[\s,]$/);
  });

  it("keeps one exactly at the limit", () => {
    const exact = "a ".repeat(80).trim().padEnd(DESCRIPTION_MAX, "b");
    expect(pageDescription(exact)).toBe(exact);
  });
});
