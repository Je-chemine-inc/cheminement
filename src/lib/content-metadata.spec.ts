import { describe, it, expect } from "vitest";
import { contentSocialMetadata } from "@/lib/content-metadata";

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
