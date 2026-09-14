import { describe, it, expect, vi, beforeEach } from "vitest";

const ENT = "0123456789abcdef0123aaaa";
const PRO = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  entitlement: null as Record<string, unknown> | null,
  rows: [] as Record<string, number>[],
  created: [] as Record<string, unknown>[],
  duplicateOnce: false,
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/ledger-cycle", () => ({ getBiweeklyCycleKey: () => "2026-09-07" }));
vi.mock("@/models/ResourceEntitlement", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => h.entitlement }) }) },
}));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: {
    find: () => ({ select: () => ({ lean: async () => [...h.rows] }) }),
    create: async (row: Record<string, unknown>) => {
      if (h.duplicateOnce) {
        h.duplicateOnce = false;
        // Another run wrote the same row meanwhile.
        h.rows.push({ grossAmountCad: row.grossAmountCad as number, platformFeeCad: row.platformFeeCad as number, netToProfessionalCad: row.netToProfessionalCad as number });
        throw Object.assign(new Error("dup"), { code: 11000 });
      }
      h.created.push(row);
      h.rows.push({ grossAmountCad: row.grossAmountCad as number, platformFeeCad: row.platformFeeCad as number, netToProfessionalCad: row.netToProfessionalCad as number });
      return row;
    },
  },
}));

import { syncProductLedger } from "@/lib/product-ledger";

const paid = (over: Record<string, unknown> = {}) => ({
  _id: ENT,
  slug: "guide-stress",
  status: "paid",
  disputed: false,
  amountCents: 4900,
  commissionBps: 2000,
  ownerProfessionalId: PRO,
  ...over,
});

beforeEach(() => {
  h.entitlement = paid();
  h.rows = [];
  h.created = [];
  h.duplicateOnce = false;
});

describe("syncProductLedger", () => {
  it("credits the professional the net of a paid sale, once", async () => {
    expect(await syncProductLedger(ENT)).toEqual({ changed: true, source: "product_sale", netCents: 3920 });
    expect(h.created[0]).toMatchObject({
      professionalId: PRO,
      entryKind: "credit",
      grossAmountCad: 49,
      platformFeeCad: 9.8,
      netToProfessionalCad: 39.2,
      paymentChannel: "stripe",
      source: "product_sale",
      ledgerKey: `product:${ENT}:0`,
      entitlementId: ENT,
      productSlug: "guide-stress",
    });
    // The webhook after the checkout confirmation, or a replay: nothing more.
    expect(await syncProductLedger(ENT)).toEqual({ changed: false, reason: "in-balance" });
    expect(h.created).toHaveLength(1);
  });

  it("reverses a full refund, recredits a refund that failed, and reverses again", async () => {
    await syncProductLedger(ENT);
    h.entitlement = paid({ status: "refunded" });
    expect(await syncProductLedger(ENT)).toEqual({ changed: true, source: "product_sale_reversal", netCents: -3920 });
    expect(h.created[1]).toMatchObject({ grossAmountCad: -49, platformFeeCad: -9.8, netToProfessionalCad: -39.2, ledgerKey: `product:${ENT}:1` });
    h.entitlement = paid();
    expect(await syncProductLedger(ENT)).toEqual({ changed: true, source: "product_sale_recredit", netCents: 3920 });
    h.entitlement = paid({ status: "refunded" });
    await syncProductLedger(ENT);
    const net = h.rows.reduce((sum, row) => sum + Math.round(row.netToProfessionalCad * 100), 0);
    expect(net).toBe(0);
    expect(h.created.map((row) => row.ledgerKey)).toEqual([0, 1, 2, 3].map((n) => `product:${ENT}:${n}`));
  });

  it("credits the share of the price before TPS and TVQ, and reverses only that", async () => {
    // 49,00 $ + TPS 2,45 $ + TVQ 4,89 $ charged: the taxes are not part of the sale.
    h.entitlement = paid({ amountCents: 5634, subtotalCents: 4900 });
    expect(await syncProductLedger(ENT)).toEqual({ changed: true, source: "product_sale", netCents: 3920 });
    expect(h.created[0]).toMatchObject({ grossAmountCad: 49, platformFeeCad: 9.8, netToProfessionalCad: 39.2 });
    h.entitlement = paid({ amountCents: 5634, subtotalCents: 4900, status: "refunded" });
    expect(await syncProductLedger(ENT)).toEqual({ changed: true, source: "product_sale_reversal", netCents: -3920 });
    expect(h.created[1]).toMatchObject({ grossAmountCad: -49, platformFeeCad: -9.8, netToProfessionalCad: -39.2 });
  });

  it("takes the share back during a dispute", async () => {
    await syncProductLedger(ENT);
    h.entitlement = paid({ disputed: true });
    expect(await syncProductLedger(ENT)).toMatchObject({ changed: true, source: "product_sale_reversal", netCents: -3920 });
  });

  it("writes nothing for a pending purchase, a partial refund or the team's own resources", async () => {
    h.entitlement = paid({ status: "pending" });
    expect(await syncProductLedger(ENT)).toEqual({ changed: false, reason: "in-balance" });
    h.entitlement = paid({ ownerProfessionalId: undefined });
    expect(await syncProductLedger(ENT)).toEqual({ changed: false, reason: "not-a-product" });
    h.entitlement = paid({ commissionBps: undefined });
    expect(await syncProductLedger(ENT)).toEqual({ changed: false, reason: "not-a-product" });
    expect(await syncProductLedger("nope")).toEqual({ changed: false, reason: "not-a-product" });
    expect(h.created).toEqual([]);
  });

  it("loses a race for the same row cleanly and credits nothing twice", async () => {
    h.duplicateOnce = true;
    expect(await syncProductLedger(ENT)).toEqual({ changed: false, reason: "in-balance" });
    expect(h.rows).toHaveLength(1);
  });
});
