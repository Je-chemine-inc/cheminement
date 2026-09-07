import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the fix for the footer advertising profiles nobody chose.
 *
 * The social links used to ship as guessed handles (".../jechemine"). Because
 * the admin settings form round-trips whatever it loads, the first save wrote
 * those guesses into the database, and the public footer then linked visitors
 * to a dead x.com account and an empty Instagram account as if they were ours —
 * and listed both to Google as `sameAs` identity claims.
 */

const h = vi.hoisted(() => ({
  stored: null as { socialLinks?: Record<string, unknown> } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/PlatformSettings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/models/PlatformSettings")>();
  return {
    ...actual,
    default: {
      findOne: () => ({ select: () => ({ lean: async () => h.stored }) }),
    },
  };
});

import { getSocialLinks } from "@/lib/platform-contact";
import { DEFAULT_SOCIAL_LINKS } from "@/models/PlatformSettings";

const NOTHING_CONFIGURED = {
  facebook: "",
  x: "",
  instagram: "",
  linkedin: "",
  youtube: "",
  tiktok: "",
};

beforeEach(() => {
  h.stored = null;
});

describe("DEFAULT_SOCIAL_LINKS", () => {
  it("ships no guessed profile URLs", () => {
    // A non-empty default here becomes a real outbound link for every visitor,
    // and an identity claim to Google, without anyone having verified that the
    // account exists or belongs to us. There is no safe guess.
    for (const [key, value] of Object.entries(DEFAULT_SOCIAL_LINKS)) {
      expect(value, `DEFAULT_SOCIAL_LINKS.${key} must stay empty`).toBe("");
    }
  });
});

describe("getSocialLinks", () => {
  it("returns nothing when no settings document exists", async () => {
    h.stored = null;
    expect(await getSocialLinks()).toEqual(NOTHING_CONFIGURED);
  });

  it("returns the URLs an admin actually saved", async () => {
    h.stored = {
      socialLinks: {
        facebook: "https://www.facebook.com/CAJTerrebonne",
        linkedin: "https://www.linkedin.com/company/je-chemine/",
      },
    };
    const links = await getSocialLinks();
    expect(links.facebook).toBe("https://www.facebook.com/CAJTerrebonne");
    expect(links.linkedin).toBe("https://www.linkedin.com/company/je-chemine/");
  });

  it("never invents a URL for a field the admin left unset", async () => {
    h.stored = {
      socialLinks: { facebook: "https://www.facebook.com/CAJTerrebonne" },
    };
    const links = await getSocialLinks();
    expect(links.x).toBe("");
    expect(links.instagram).toBe("");
    expect(links.youtube).toBe("");
  });

  it('preserves an explicitly emptied field as "hide this icon"', async () => {
    h.stored = { socialLinks: { x: "" } };
    expect((await getSocialLinks()).x).toBe("");
  });

  it("drops a stored value that is not an http(s) URL", async () => {
    h.stored = {
      socialLinks: {
        facebook: "jechemine",
        x: "javascript:alert(1)",
        instagram: "https://",
        linkedin: "   ",
        youtube: 42,
      },
    };
    expect(await getSocialLinks()).toEqual(NOTHING_CONFIGURED);
  });

  it("trims surrounding whitespace", async () => {
    h.stored = { socialLinks: { youtube: "  https://youtube.com/@jechemine  " } };
    expect((await getSocialLinks()).youtube).toBe(
      "https://youtube.com/@jechemine",
    );
  });
});
