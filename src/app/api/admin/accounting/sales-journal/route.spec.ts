/**
 * The sales journal — the accountant's CSV of session revenue.
 *
 * Regression: a card session counted as revenue at closure even when nothing
 * was charged (no card on file, or a declined card), so an unpaid session sat
 * in the journal as collected. Also, the professional and session id columns
 * printed "[object Object]": the rows are populated, and a populated
 * reference is a document, not an id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string; isAdmin?: boolean } } | null,
  permissions: null as Record<string, boolean> | null,
  reads: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  // Sessions refunded during the exported year, as Appointment.find returns them.
  refunded: [] as Array<Record<string, unknown>>,
  refundQuery: { value: null as unknown },
  appointmentModelLoaded: false,
  // Product purchases, as ResourceEntitlement.find returns them.
  entitlements: [] as Array<Record<string, unknown>>,
  entitlementQuery: { value: null as unknown },
}));

// Loading the module is what registers the model populate() needs.
vi.mock("@/models/Appointment", () => {
  h.appointmentModelLoaded = true;
  return {
    default: {
      find: (filter: unknown) => {
        h.refundQuery.value = filter;
        const q = { select: () => q, lean: async () => h.refunded };
        return q;
      },
    },
  };
});

vi.mock("@/models/ResourceEntitlement", () => ({
  default: {
    find: (filter: unknown) => {
      h.entitlementQuery.value = filter;
      const q = { select: () => q, lean: async () => h.entitlements };
      return q;
    },
  },
}));

/** Keeps only the selected (dotted) paths of a populated document, like MongoDB. */
function project(doc: unknown, select: string | undefined): unknown {
  if (!doc || typeof doc !== "object" || select === undefined) return doc;
  const src = doc as Record<string, unknown>;
  const out: Record<string, unknown> = { _id: src._id };
  for (const path of select.split(/\s+/).filter(Boolean)) {
    const parts = path.split(".");
    let from: unknown = src;
    let to = out;
    for (let i = 0; i < parts.length; i++) {
      if (!from || typeof from !== "object" || !(parts[i] in from)) break;
      const value = (from as Record<string, unknown>)[parts[i]];
      if (i === parts.length - 1) {
        to[parts[i]] = value;
      } else {
        to[parts[i]] = (to[parts[i]] as Record<string, unknown>) ?? {};
        to = to[parts[i]] as Record<string, unknown>;
        from = value;
      }
    }
  }
  return out;
}

vi.mock("next/server", () => {
  class NextResponse {
    body: string;
    status: number;
    constructor(body: string, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body };
    }
  }
  return { NextResponse };
});
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-rbac", () => ({ getActiveAdminPermissions: async () => h.permissions }));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      h.reads();
      const selects: Record<string, string> = {};
      // The refund query asks for the credits of given sessions, on one channel.
      const bySession = filter.appointmentId as { $in: unknown[] } | undefined;
      const source = bySession
        ? h.rows.filter(
            (r) =>
              r.paymentChannel === filter.paymentChannel &&
              bySession.$in.map(String).includes(String((r.appointmentId as { _id: unknown })._id)),
          )
        : h.rows;
      const q = {
        populate: (path: string, select: string) => {
          selects[path] = select;
          return q;
        },
        sort: () => q,
        lean: async () =>
          source.map((r) => ({
            ...r,
            professionalId: project(r.professionalId, selects.professionalId),
            appointmentId: project(r.appointmentId, selects.appointmentId),
          })),
      };
      return q;
    },
  },
}));

import { GET } from "./route";

/** Columns: …, brut, frais, net, canal, type_ligne (index 11), tps (12), tvq (13). */
const TYPE = 11;

const credit = (key: string, paymentChannel: string, status: string, createdAt = "2026-09-10T17:21:06Z") => ({
  _id: `ledger-${key}`,
  entryKind: "credit",
  createdAt: new Date(createdAt),
  cycleKey: "2026-B19",
  sessionActNature: "individual_psychotherapy",
  professionalId: { _id: "pro-1", firstName: "Nathalie", lastName: "Pro", email: "pro@example.com" },
  appointmentId: {
    _id: `apt-${key}`,
    date: new Date("2026-09-09T12:00:00Z"),
    time: "12:00",
    status: "completed",
    sessionActNature: "individual_psychotherapy",
    payment: { status, price: 175, method: "card" },
  },
  grossAmountCad: 175,
  platformFeeCad: 25,
  netToProfessionalCad: 150,
  paymentChannel,
});

const exportCsv = async () => {
  const res = (await GET({ url: "https://x/api/admin/accounting/sales-journal?year=2026" } as never)) as unknown as {
    status: number;
    body: string;
  };
  return { status: res.status, lines: String(res.body).replace(/^﻿/, "").split("\n") };
};

beforeEach(() => {
  h.session = { user: { id: "admin1", role: "admin", isAdmin: true } };
  h.permissions = { manageBilling: true };
  h.reads.mockReset();
  h.rows = [];
  h.refunded = [];
  h.refundQuery.value = null;
  h.entitlements = [];
  h.entitlementQuery.value = null;
});

const refundedSession = (key: string, payment: Record<string, unknown> = {}) => ({
  _id: `apt-${key}`,
  date: new Date("2026-09-09T12:00:00Z"),
  payment: {
    status: "refunded",
    price: 175,
    refundedAt: new Date("2026-09-20T15:00:00Z"),
    refundedAmount: 175,
    ...payment,
  },
});

describe("GET /api/admin/accounting/sales-journal", () => {
  it("registers the Appointment model it populates", () => {
    // Otherwise a freshly started server answers 500 "Schema hasn't been
    // registered for model Appointment" until another route loads it.
    expect(h.appointmentModelLoaded).toBe(true);
  });

  it("is refused to anyone but an admin", async () => {
    h.session = { user: { id: "u", role: "professional" } };
    const res = (await GET({ url: "https://x/api/admin/accounting/sales-journal" } as never)) as unknown as { status: number };
    expect(res.status).toBe(401);
  });

  it("is refused to an admin without billing rights, before anything is read", async () => {
    h.permissions = { managePatients: true, manageBilling: false };
    const res = (await GET({ url: "https://x/api/admin/accounting/sales-journal" } as never)) as unknown as { status: number };
    expect(res.status).toBe(403);
    expect(h.reads).not.toHaveBeenCalled();
  });

  it("lists a card session only once its payment came in", async () => {
    h.rows = [
      credit("card-unpaid", "stripe", "pending"),
      credit("card-paid", "stripe", "paid"),
      credit("card-voided", "stripe", "cancelled"),
      credit("interac-unpaid", "transfer", "pending"),
      credit("interac-paid", "transfer", "paid"),
    ];
    const { status, lines } = await exportCsv();
    expect(status).toBe(200);
    const body = lines.slice(1).join("\n");
    expect(body).toContain("apt-card-paid");
    expect(body).toContain("apt-interac-paid");
    expect(body).not.toContain("apt-card-unpaid");
    expect(body).not.toContain("apt-card-voided");
    expect(body).not.toContain("apt-interac-unpaid");
    expect(lines).toHaveLength(3);
  });

  it("prints the professional and session ids, not [object Object]", async () => {
    h.rows = [credit("card-paid", "stripe", "paid")];
    const { lines } = await exportCsv();
    const cells = lines[1].split(",");
    expect(cells[2]).toBe("pro-1");
    expect(cells[3]).toBe("Nathalie Pro");
    expect(cells[4]).toBe("apt-card-paid");
    expect(lines.join("\n")).not.toContain("[object Object]");
  });
});

/**
 * The journal had no refund lines: a refunded card sale stayed listed at its
 * full amount. A refund never reduces the professional's ledger credit, so the
 * clinic absorbs it — the refund line takes the amount off the platform's
 * share and leaves the professional's at zero.
 */
describe("GET /api/admin/accounting/sales-journal — refunds", () => {
  it("a refunded card sale comes back as a negative line on the refund's date", async () => {
    h.rows = [credit("card-refunded", "stripe", "refunded")];
    h.refunded = [refundedSession("card-refunded")];
    const { lines } = await exportCsv();
    expect(lines[0].split(",").slice(TYPE)).toEqual(["type_ligne", "tps_cad", "tvq_cad"]);
    expect(lines).toHaveLength(3);
    const sale = lines[1].split(",");
    const refund = lines[2].split(",");
    expect(sale.slice(7)).toEqual(["175", "25", "150", "stripe", "vente", "", ""]);
    expect(refund[0]).toBe("2026-09-20");
    expect(refund[1]).toBe("2026-B19");
    expect(refund[2]).toBe("pro-1");
    expect(refund[4]).toBe("apt-card-refunded");
    expect(refund[5]).toBe("2026-09-09");
    expect(refund.slice(7)).toEqual(["-175", "-175", "0", "stripe", "remboursement", "", ""]);
  });

  it("a partial refund takes back only what was refunded", async () => {
    h.rows = [credit("card-partial", "stripe", "partially_refunded")];
    h.refunded = [refundedSession("card-partial", { status: "partially_refunded", refundedAmount: 50 })];
    const { lines } = await exportCsv();
    expect(lines[2].split(",").slice(7)).toEqual(["-50", "-50", "0", "stripe", "remboursement", "", ""]);
  });

  it("an Interac session is given no refund line", async () => {
    h.rows = [credit("interac-refunded", "transfer", "refunded")];
    h.refunded = [refundedSession("interac-refunded")];
    const { lines } = await exportCsv();
    expect(lines.join("\n")).not.toContain("remboursement");
  });

  it("asks only for refunds made during the exported year", async () => {
    await exportCsv();
    const q = h.refundQuery.value as Record<string, { $gte?: Date; $lt?: Date; $in?: string[] }>;
    expect(q["payment.refundedAt"].$gte).toEqual(new Date(2026, 0, 1));
    expect(q["payment.refundedAt"].$lt).toEqual(new Date(2027, 0, 1));
    expect(q["payment.status"].$in).toEqual(["refunded", "partially_refunded"]);
  });

  it("keeps sales and refunds in date order", async () => {
    h.rows = [
      credit("early", "stripe", "refunded", "2026-09-10T10:00:00Z"),
      credit("late", "stripe", "paid", "2026-09-25T10:00:00Z"),
    ];
    h.refunded = [refundedSession("early")];
    const { lines } = await exportCsv();
    expect(lines.slice(1).map((l) => [l.split(",")[0], l.split(",")[TYPE]])).toEqual([
      ["2026-09-10", "vente"],
      ["2026-09-20", "remboursement"],
      ["2026-09-25", "vente"],
    ]);
  });
});

/**
 * TPS and TVQ added at checkout on a professional's product: the accountant
 * needs what was collected, next to the professional's share of the price
 * before taxes. A reversal takes them back with the sale.
 */
describe("GET /api/admin/accounting/sales-journal — TPS and TVQ on products", () => {
  const productCredit = (key: string, sign: 1 | -1, entitlementId: string) => ({
    _id: `ledger-${key}`,
    entryKind: "credit",
    createdAt: new Date(sign > 0 ? "2026-09-12T10:00:00Z" : "2026-09-14T10:00:00Z"),
    cycleKey: "2026-B19",
    professionalId: { _id: "pro-1", firstName: "Nathalie", lastName: "Pro", email: "pro@example.com" },
    appointmentId: null,
    productSlug: "guide-stress",
    entitlementId,
    grossAmountCad: 49 * sign,
    platformFeeCad: 9.8 * sign,
    netToProfessionalCad: 39.2 * sign,
    paymentChannel: "stripe",
    source: sign > 0 ? "product_sale" : "product_sale_reversal",
  });

  it("prints the TPS and TVQ collected on a taxed sale, negative on its reversal", async () => {
    h.rows = [productCredit("sale", 1, "ent-taxed"), productCredit("reversal", -1, "ent-taxed")];
    h.entitlements = [{ _id: "ent-taxed", tpsCents: 245, tvqCents: 489 }];
    const { lines } = await exportCsv();
    expect(lines).toHaveLength(3);
    expect(lines[1].split(",").slice(6)).toEqual(["guide-stress", "49", "9.8", "39.2", "stripe", "vente_produit", "2.45", "4.89"]);
    expect(lines[2].split(",").slice(6)).toEqual(["guide-stress", "-49", "-9.8", "-39.2", "stripe", "remboursement_produit", "-2.45", "-4.89"]);
    expect(h.entitlementQuery.value).toEqual({ _id: { $in: ["ent-taxed", "ent-taxed"] } });
  });

  it("leaves the tax cells empty for a product bought while taxes were off", async () => {
    h.rows = [productCredit("untaxed", 1, "ent-untaxed")];
    h.entitlements = [{ _id: "ent-untaxed" }];
    const { lines } = await exportCsv();
    expect(lines[1].split(",").slice(TYPE)).toEqual(["vente_produit", "", ""]);
  });

  it("does not look up purchases when no line is a product sale", async () => {
    h.rows = [credit("card-paid", "stripe", "paid")];
    await exportCsv();
    expect(h.entitlementQuery.value).toBeNull();
  });
});
