import { describe, it, expect } from "vitest";
import {
  PRODUCT_HTML_MAX_BYTES,
  commissionBpsOf,
  isAllowedProductMediaUrl,
  parseProductWrite,
  productIsLive,
  productMissing,
  productSlugCandidates,
  productTransition,
  splitProductSaleCents,
  validateProductPrice,
  webinarReminderDue,
  webinarReminderKey,
} from "@/lib/product-rules";

describe("commission", () => {
  it("splits a sale in whole cents, fee plus net always the gross", () => {
    expect(splitProductSaleCents(4900, 2000)).toEqual({ platformFeeCents: 980, netToProfessionalCents: 3920 });
    expect(splitProductSaleCents(1999, 2000)).toEqual({ platformFeeCents: 400, netToProfessionalCents: 1599 });
    expect(splitProductSaleCents(0, 2000)).toEqual({ platformFeeCents: 0, netToProfessionalCents: 0 });
    for (let gross = 500; gross <= 100_000; gross += 777) {
      for (const bps of [0, 1250, 2000, 3333, 10_000]) {
        const { platformFeeCents, netToProfessionalCents } = splitProductSaleCents(gross, bps);
        expect(platformFeeCents + netToProfessionalCents).toBe(gross);
        expect(Number.isInteger(platformFeeCents)).toBe(true);
      }
    }
  });

  it("reads the setting as basis points, 20 % when unset, clamped", () => {
    expect(commissionBpsOf(20)).toBe(2000);
    expect(commissionBpsOf(12.5)).toBe(1250);
    expect(commissionBpsOf(undefined)).toBe(2000);
    expect(commissionBpsOf(140)).toBe(10_000);
    expect(commissionBpsOf(-3)).toBe(0);
  });
});

describe("price", () => {
  it("keeps prices between 5 $ and 1 000 $ in whole cents; an external link is free", () => {
    expect(validateProductPrice("pdf", 500)).toBe(500);
    expect(validateProductPrice("video", 100_000)).toBe(100_000);
    expect(validateProductPrice("pdf", 499)).toBeNull();
    expect(validateProductPrice("pdf", 100_001)).toBeNull();
    expect(validateProductPrice("pdf", 19.5)).toBeNull();
    expect(validateProductPrice("external", 0)).toBe(0);
    expect(validateProductPrice("external", 1900)).toBeNull();
  });
});

describe("moderation", () => {
  it("lets each side make only its own moves", () => {
    expect(productTransition("draft", "submit", "professional")).toBe("submitted");
    expect(productTransition("draft", "submit", "admin")).toBeNull();
    expect(productTransition("submitted", "approve", "admin")).toBe("approved");
    expect(productTransition("submitted", "approve", "professional")).toBeNull();
    expect(productTransition("submitted", "reject", "admin")).toBe("rejected");
    expect(productTransition("submitted", "withdraw", "professional")).toBe("draft");
    expect(productTransition("approved", "unpublish", "professional")).toBe("unpublished");
    expect(productTransition("approved", "unpublish", "admin")).toBe("unpublished");
  });

  it("never approves twice, publishes a draft, or brings back a product without a new review", () => {
    expect(productTransition("draft", "approve", "admin")).toBeNull();
    expect(productTransition("approved", "approve", "admin")).toBeNull();
    expect(productTransition("unpublished", "approve", "admin")).toBeNull();
    expect(productTransition("unpublished", "submit", "professional")).toBe("submitted");
    expect(productTransition("rejected", "submit", "professional")).toBe("submitted");
  });

  it("shows a product only while approved and its professional is active", () => {
    expect(productIsLive({ moderation: "approved", ownerActive: true })).toBe(true);
    expect(productIsLive({ moderation: "approved", ownerActive: false })).toBe(false);
    expect(productIsLive({ moderation: "submitted", ownerActive: true })).toBe(false);
  });
});

describe("slugs", () => {
  it("derives the address from the French title, avoiding reserved words", () => {
    expect(productSlugCandidates("Gérer son stress au travail", 3)).toEqual([
      "gerer-son-stress-au-travail",
      "gerer-son-stress-au-travail-2",
      "gerer-son-stress-au-travail-3",
    ]);
    expect(productSlugCandidates("Admin", 1)).toEqual(["admin-produit"]);
    expect(productSlugCandidates("!!!", 1)).toEqual(["produit"]);
    expect(productSlugCandidates("x".repeat(200), 2).every((slug) => slug.length <= 80)).toBe(true);
  });
});

describe("media links", () => {
  it("accepts only players the page can frame, over https", () => {
    expect(isAllowedProductMediaUrl("video", "https://youtu.be/abc123XYZ")).toBe(true);
    expect(isAllowedProductMediaUrl("video", "https://vimeo.com/123456")).toBe(true);
    expect(isAllowedProductMediaUrl("audio", "https://open.spotify.com/episode/abc")).toBe(true);
    expect(isAllowedProductMediaUrl("video", "https://cdn.example.com/course.mp4")).toBe(false);
    expect(isAllowedProductMediaUrl("video", "http://youtu.be/abc123XYZ")).toBe(false);
    expect(isAllowedProductMediaUrl("video", "https://evil-youtube.com/watch?v=abc")).toBe(false);
    expect(isAllowedProductMediaUrl("audio", "https://youtu.be/abc123XYZ")).toBe(false);
    expect(isAllowedProductMediaUrl("video", "javascript:alert(1)")).toBe(false);
  });
});

describe("parseProductWrite", () => {
  it("keeps the writable fields and drops the rest", () => {
    const result = parseProductWrite("pdf", {
      titleFr: " Guide ",
      priceCents: 1900,
      status: "published",
      ownerProfessionalId: "x",
      moderation: { status: "approved" },
      slug: "autre",
    });
    expect(result).toEqual({
      ok: true,
      value: { titleFr: "Guide", priceCents: 1900 },
      dropped: ["status", "ownerProfessionalId", "moderation", "slug"],
    });
  });

  it("checks each field against the product's type", () => {
    expect(parseProductWrite("pdf", { priceCents: 100 })).toMatchObject({ ok: false, code: "INVALID_PRICE" });
    expect(parseProductWrite("pdf", { mediaUrlFr: "https://youtu.be/abc123XYZ" })).toMatchObject({ ok: false, code: "INVALID_MEDIA_URL" });
    expect(parseProductWrite("video", { mediaUrlFr: "https://cdn.example.com/a.mp4" })).toMatchObject({ ok: false, code: "INVALID_MEDIA_URL" });
    expect(parseProductWrite("video", { externalUrl: "https://example.com" })).toMatchObject({ ok: false, code: "INVALID_LINK" });
    expect(parseProductWrite("external", { externalUrl: "http://example.com" })).toMatchObject({ ok: false, code: "INVALID_LINK" });
    expect(parseProductWrite("webinar", { webinarDurationMinutes: 5 })).toMatchObject({ ok: false, code: "INVALID_WEBINAR" });
    expect(parseProductWrite("webinar", { webinarStartsAt: "demain" })).toMatchObject({ ok: false, code: "INVALID_WEBINAR" });
    expect(parseProductWrite("pdf", { iconUrl: "https://example.com/a.png" })).toMatchObject({ ok: false, code: "INVALID_IMAGE" });
    expect(parseProductWrite("pdf", { titleFr: "" })).toMatchObject({ ok: false, code: "INVALID_TITLE" });
    expect(parseProductWrite("pdf", { contentHtmlFr: "a".repeat(PRODUCT_HTML_MAX_BYTES + 1) })).toMatchObject({ ok: false, code: "HTML_TOO_LARGE" });
  });

  it("accepts a complete webinar and clears links with null", () => {
    const result = parseProductWrite("webinar", {
      webinarStartsAt: "2026-10-01T23:00:00.000Z",
      webinarDurationMinutes: 90,
      webinarJoinUrl: "https://zoom.us/j/123",
      webinarReplayUrl: null,
      iconUrl: "/api/files/0123456789abcdef01234567",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        webinarStartsAt: "2026-10-01T23:00:00.000Z",
        webinarDurationMinutes: 90,
        webinarJoinUrl: "https://zoom.us/j/123",
        webinarReplayUrl: null,
        iconUrl: "/api/files/0123456789abcdef01234567",
      },
      dropped: [],
    });
  });
});

describe("productMissing", () => {
  const base = {
    type: "pdf" as const,
    titleFr: "Guide",
    summaryFr: "Un guide.",
    contentHtmlFr: "",
    priceCents: 1900,
    hasFile: true,
    attested: true,
  };

  it("lists what a product still needs before review, by type", () => {
    expect(productMissing(base)).toEqual([]);
    expect(productMissing({ ...base, hasFile: false, attested: false, priceCents: 0 })).toEqual(["price", "file", "attestation"]);
    expect(productMissing({ ...base, type: "video", mediaUrlFr: null })).toEqual(["media"]);
    expect(productMissing({ ...base, type: "webinar", webinarStartsAt: null })).toEqual(["webinar"]);
    expect(productMissing({ ...base, type: "external", priceCents: 0, externalUrl: null })).toEqual(["link"]);
  });
});

describe("webinar reminders", () => {
  // 19 h in Montréal.
  const startsAt = new Date("2026-10-01T23:00:00.000Z");
  const at = (hoursBefore: number) => new Date(startsAt.getTime() - hoursBefore * 3_600_000);
  const longAgo = new Date("2026-09-01T12:00:00.000Z");

  it("reminds the day before, then an hour before, and never once the webinar has started", () => {
    const due = (now: Date) => webinarReminderDue({ startsAt, paidAt: longAgo, now });
    expect(due(at(25))).toBeNull();
    expect(due(at(24))).toBe("day");
    expect(due(at(2))).toBe("day");
    expect(due(at(1.01))).toBe("day");
    expect(due(at(1))).toBe("hour");
    expect(due(at(0.1))).toBe("hour");
    expect(due(startsAt)).toBeNull();
    expect(due(at(-1))).toBeNull();
  });

  it("skips a window the purchase was made in: the purchase email has just gone out", () => {
    expect(webinarReminderDue({ startsAt, paidAt: at(10), now: at(5) })).toBeNull();
    expect(webinarReminderDue({ startsAt, paidAt: at(10), now: at(0.5) })).toBe("hour");
    expect(webinarReminderDue({ startsAt, paidAt: at(0.5), now: at(0.25) })).toBeNull();
    expect(webinarReminderDue({ startsAt, paidAt: at(24), now: at(20) })).toBeNull();
  });

  it("treats a purchase without a payment date as made long before", () => {
    expect(webinarReminderDue({ startsAt, paidAt: null, now: at(3) })).toBe("day");
    expect(webinarReminderDue({ startsAt, now: at(0.5) })).toBe("hour");
  });

  it("keys a reminder on its kind and the start it announced, so a moved webinar reminds again", () => {
    expect(webinarReminderKey("day", startsAt)).toBe("day:2026-10-01T23:00:00.000Z");
    expect(webinarReminderKey("day", new Date("2026-10-08T23:00:00.000Z"))).not.toBe(webinarReminderKey("day", startsAt));
    expect(webinarReminderKey("hour", startsAt)).not.toBe(webinarReminderKey("day", startsAt));
  });
});
