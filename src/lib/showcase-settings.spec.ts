import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The showcase switch is read on every city page and showcase API. It must
 * fail closed: anything but an explicit `true` — no settings, another value,
 * a database error — keeps the pages dark.
 */
const h = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  selected: "",
  connect: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mongodb", () => ({ default: h.connect }));
vi.mock("@/models/PlatformSettings", () => ({
  default: {
    findOne: () => ({
      select: (fields: string) => {
        h.selected = fields;
        return { lean: async () => h.settings };
      },
    }),
  },
}));

import { isShowcaseEnabled } from "@/lib/showcase-settings";

beforeEach(() => {
  h.settings = null;
  h.selected = "";
  h.connect.mockReset();
  h.connect.mockImplementation(async () => undefined);
});

describe("isShowcaseEnabled", () => {
  it("is on only when the switch is exactly true, reading nothing else", async () => {
    h.settings = { showcaseEnabled: true };
    expect(await isShowcaseEnabled()).toBe(true);
    expect(h.selected).toBe("showcaseEnabled");
    for (const value of [false, undefined, "true", 1, null]) {
      h.settings = { showcaseEnabled: value };
      expect(await isShowcaseEnabled()).toBe(false);
    }
  });

  it("is off when no settings were ever saved", async () => {
    expect(await isShowcaseEnabled()).toBe(false);
  });

  it("fails closed when the database cannot answer", async () => {
    h.connect.mockRejectedValueOnce(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await isShowcaseEnabled()).toBe(false);
    spy.mockRestore();
  });
});
