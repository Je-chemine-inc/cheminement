/**
 * The paywall gate.
 *
 * `stripPremiumPayload` is the only thing standing between a paid resource and
 * an anonymous reader, so these assert key ABSENCE rather than emptiness: an
 * empty string still ships an `<iframe src="">` and still satisfies a `??`.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_PRICE_CENTS,
  canBePremium,
  isPremiumEntry,
  stripPremiumPayload,
  validatePriceCents,
} from "./content-premium";

describe("canBePremium", () => {
  it("allows resources only", () => {
    expect(canBePremium("resource")).toBe(true);
  });

  it("refuses the editorial kinds", () => {
    expect(canBePremium("problematique")).toBe(false);
    expect(canBePremium("traitement")).toBe(false);
    expect(canBePremium("nouveaute")).toBe(false);
    expect(canBePremium("media")).toBe(false);
  });
});

describe("isPremiumEntry", () => {
  const paid = { kind: "resource", isPremium: true, priceCents: 1900 } as const;

  it("recognises a properly priced resource", () => {
    expect(isPremiumEntry(paid)).toBe(true);
  });

  it("refuses a flagged entry with no price", () => {
    // A half-finished admin edit must not render a buy button Stripe can't honour.
    expect(isPremiumEntry({ ...paid, priceCents: 0 })).toBe(false);
    expect(isPremiumEntry({ kind: "resource", isPremium: true })).toBe(false);
  });

  it("refuses an unflagged entry even when it carries a price", () => {
    expect(isPremiumEntry({ ...paid, isPremium: false })).toBe(false);
    expect(isPremiumEntry({ kind: "resource", priceCents: 1900 })).toBe(false);
  });

  it("refuses a premium flag on a kind that cannot be sold", () => {
    // Guards the ?locale= / wrong-kind bypass: only resources are sellable.
    expect(isPremiumEntry({ ...paid, kind: "nouveaute" })).toBe(false);
    expect(isPremiumEntry({ ...paid, kind: "media" })).toBe(false);
  });
});

describe("stripPremiumPayload", () => {
  const full = {
    id: "abc",
    kind: "resource" as const,
    slug: "gerer-son-stress",
    title: "Gérer son stress",
    summary: "Un guide complet.",
    iconUrl: "/api/files/123",
    previewHtml: "<p>Extrait</p>",
    contentHtml: "<p>Le contenu payant</p>",
    mediaType: "video" as const,
    mediaUrl: "https://youtube.com/watch?v=unlisted",
    priceCents: 1900,
  };

  it("removes the paid keys entirely, not just their values", () => {
    const out = stripPremiumPayload(full);
    expect("contentHtml" in out).toBe(false);
    expect("mediaUrl" in out).toBe(false);
  });

  it("keeps everything the paywall needs to render", () => {
    const out = stripPremiumPayload(full);
    expect(out.title).toBe("Gérer son stress");
    expect(out.summary).toBe("Un guide complet.");
    expect(out.iconUrl).toBe("/api/files/123");
    expect(out.previewHtml).toBe("<p>Extrait</p>");
    expect(out.priceCents).toBe(1900);
    // mediaType survives: the card shows a "video" icon without leaking the URL.
    expect(out.mediaType).toBe("video");
  });

  it("marks the payload locked", () => {
    expect(stripPremiumPayload(full).locked).toBe(true);
  });

  it("does not mutate the input", () => {
    stripPremiumPayload(full);
    expect(full.contentHtml).toBe("<p>Le contenu payant</p>");
    expect(full.mediaUrl).toBe("https://youtube.com/watch?v=unlisted");
  });

  it("survives an entry that never had the paid fields", () => {
    const out = stripPremiumPayload({ title: "x" } as { title: string; contentHtml?: string });
    expect("contentHtml" in out).toBe(false);
    expect(out.locked).toBe(true);
  });

  it("leaves no paid content anywhere in the serialized payload", () => {
    // The blunt check: whatever the shape, the secret must not survive JSON.
    const json = JSON.stringify(stripPremiumPayload(full));
    expect(json).not.toContain("Le contenu payant");
    expect(json).not.toContain("unlisted");
  });
});

describe("validatePriceCents", () => {
  it("accepts a whole number of cents", () => {
    expect(validatePriceCents(1900)).toBe(1900);
    expect(validatePriceCents(1)).toBe(1);
    expect(validatePriceCents(MAX_PRICE_CENTS)).toBe(MAX_PRICE_CENTS);
  });

  it("rejects fractional cents", () => {
    // 19.5 cents is meaningless and a float here is how rounding drift reaches Stripe.
    expect(validatePriceCents(1.5)).toBeNull();
    expect(validatePriceCents(1900.01)).toBeNull();
  });

  it("rejects zero and negatives", () => {
    expect(validatePriceCents(0)).toBeNull();
    expect(validatePriceCents(-1)).toBeNull();
  });

  it("rejects non-numbers, including numeric strings", () => {
    expect(validatePriceCents("19")).toBeNull();
    expect(validatePriceCents("1900")).toBeNull();
    expect(validatePriceCents(null)).toBeNull();
    expect(validatePriceCents(undefined)).toBeNull();
    expect(validatePriceCents({})).toBeNull();
  });

  it("rejects NaN and Infinity", () => {
    expect(validatePriceCents(NaN)).toBeNull();
    expect(validatePriceCents(Infinity)).toBeNull();
    expect(validatePriceCents(-Infinity)).toBeNull();
  });

  it("rejects an absurd price", () => {
    // Most likely a dollars value pasted into a cents field.
    expect(validatePriceCents(MAX_PRICE_CENTS + 1)).toBeNull();
  });
});
