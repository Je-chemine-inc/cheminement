/**
 * TPS and TVQ in the admin settings. What must hold: nothing unvalidated
 * reaches the document, a rate stays within 0–20 % with at most three
 * decimals, and taxes cannot be turned on without both registration numbers —
 * a receipt would otherwise charge taxes it cannot justify.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type SalesTaxes = {
  enabled: boolean;
  tpsRatePercent: number;
  tvqRatePercent: number;
  tpsNumber: string;
  tvqNumber: string;
};

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  doc: null as null | {
    salesTaxes?: SalesTaxes;
    save: ReturnType<typeof vi.fn>;
    toObject: () => Record<string, unknown>;
  },
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", () => ({ clearEmailSettingsCache: vi.fn() }));
vi.mock("@/models/PlatformSettings", () => ({
  getDefaultEmailSettings: () => ({}),
  DEFAULT_PARTNERS: [],
  default: {
    // Awaited, it is the document; with select().lean(), the saved values.
    findOne: () => ({
      select: () => ({ lean: async () => (h.doc ? { salesTaxes: h.doc.salesTaxes } : null) }),
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(h.doc).then(resolve, reject),
    }),
  },
}));

import { PUT } from "./route";

const SAVED: SalesTaxes = { enabled: false, tpsRatePercent: 5, tvqRatePercent: 9.975, tpsNumber: "", tvqNumber: "" };

const put = async (body: unknown) =>
  (await PUT({ json: async () => body } as never)) as unknown as { status: number; body: Record<string, unknown> };

beforeEach(() => {
  h.session = { user: { id: "admin1", role: "admin" } };
  h.doc = {
    salesTaxes: { ...SAVED },
    save: vi.fn(async () => undefined),
    toObject() {
      return { salesTaxes: this.salesTaxes };
    },
  };
});

describe("PUT /api/admin/settings — salesTaxes", () => {
  it("saves the rates and numbers, trimmed, and turns taxes on", async () => {
    const res = await put({
      salesTaxes: { enabled: true, tpsRatePercent: 5, tvqRatePercent: 9.975, tpsNumber: " 123456789 RT0001 ", tvqNumber: "1234567890 TQ0001", evil: "x" },
    });
    expect(res.status).toBe(200);
    expect(h.doc!.salesTaxes).toEqual({
      enabled: true,
      tpsRatePercent: 5,
      tvqRatePercent: 9.975,
      tpsNumber: "123456789 RT0001",
      tvqNumber: "1234567890 TQ0001",
    });
    expect(h.doc!.save).toHaveBeenCalled();
  });

  it("refuses to turn taxes on without both registration numbers, saving nothing", async () => {
    for (const numbers of [{}, { tpsNumber: "123456789 RT0001" }, { tvqNumber: "1234567890 TQ0001" }, { tpsNumber: "  ", tvqNumber: "1" }]) {
      h.doc!.save.mockClear();
      const res = await put({ salesTaxes: { enabled: true, ...numbers } });
      expect(res.status).toBe(400);
      expect(h.doc!.save).not.toHaveBeenCalled();
      expect(h.doc!.salesTaxes).toEqual(SAVED);
    }
  });

  it("refuses a rate outside 0–20 %, with more than three decimals, or not a number", async () => {
    for (const bad of [-0.5, 20.5, 9.9755, "9.975", null, Number.NaN]) {
      const res = await put({ salesTaxes: { tvqRatePercent: bad } });
      expect(res.status, String(bad)).toBe(400);
    }
    expect(h.doc!.save).not.toHaveBeenCalled();
  });

  it("refuses a registration number with other characters", async () => {
    const res = await put({ salesTaxes: { tpsNumber: "<script>" } });
    expect(res.status).toBe(400);
    expect(h.doc!.save).not.toHaveBeenCalled();
  });

  it("keeps what an update does not mention: turning taxes on once the numbers are saved", async () => {
    h.doc!.salesTaxes = { ...SAVED, tpsNumber: "123456789 RT0001", tvqNumber: "1234567890 TQ0001", tvqRatePercent: 9.5 };
    const res = await put({ salesTaxes: { enabled: true } });
    expect(res.status).toBe(200);
    expect(h.doc!.salesTaxes).toEqual({
      enabled: true,
      tpsRatePercent: 5,
      tvqRatePercent: 9.5,
      tpsNumber: "123456789 RT0001",
      tvqNumber: "1234567890 TQ0001",
    });
  });

  it("can turn taxes off, and clear the numbers while off", async () => {
    h.doc!.salesTaxes = { ...SAVED, enabled: true, tpsNumber: "123456789 RT0001", tvqNumber: "1234567890 TQ0001" };
    expect((await put({ salesTaxes: { enabled: false, tpsNumber: "", tvqNumber: "" } })).status).toBe(200);
    expect(h.doc!.salesTaxes).toEqual(SAVED);
  });

  it("leaves the taxes alone when the update does not name them", async () => {
    await put({ platformFeePercentage: 10 });
    expect(h.doc!.salesTaxes).toEqual(SAVED);
  });

  it("is refused to anyone but an admin", async () => {
    h.session = { user: { id: "u", role: "professional" } };
    expect((await put({ salesTaxes: { enabled: false } })).status).toBe(401);
  });
});
