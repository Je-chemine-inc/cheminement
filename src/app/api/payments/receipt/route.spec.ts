/**
 * H1 regression: the fiscal receipt PDF must only be downloadable by a non-admin
 * once payment is actually settled (payment.status === "paid"). It must NOT rely
 * on fiscalReceiptIssuedAt, which is stamped at closure for every billable
 * session regardless of whether the money was collected (Interac awaiting
 * transfer, card/PAD charge skipped/failed, ACSS in flight, or refunded).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "cccccccccccccccccccccccc";
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ADMIN_ID = "dddddddddddddddddddddddd";

const h = vi.hoisted(() => {
  const getServerSession = vi.fn();
  const store: { appointment: Record<string, unknown> } = { appointment: {} };
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return { getServerSession, store, makeQuery };
});

vi.mock("next/server", () => {
  class NextResponse {
    body: unknown;
    status: number;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body };
    }
  }
  return { NextResponse };
});
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/Appointment", () => ({
  default: { findById: () => h.makeQuery(h.store.appointment) },
}));
vi.mock("@/models/Profile", () => ({
  default: { findOne: () => h.makeQuery(null) },
}));
vi.mock("@/lib/receipt-pdf", () => ({
  buildFiscalReceiptInputFromPopulatedAppointment: () => ({}),
  buildFiscalReceiptPdfBuffer: () => Buffer.from("pdf"),
}));
vi.mock("@/lib/platform-contact", () => ({
  getPlatformContactInfo: () =>
    Promise.resolve({
      physicalAddress: {},
      companyName: "X",
      phoneNumber: "1",
      supportEmail: "s@x.co",
    }),
}));
vi.mock("@/lib/format-platform-contact", () => ({
  formatStandardAddressBlock: () => [],
}));

import { GET as receiptGET } from "@/app/api/payments/receipt/route";

const call = (role: string, userId: string) => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: userId, role } });
  return receiptGET({
    url: "https://app.test/api/payments/receipt?appointmentId=a1",
  } as never) as unknown as Promise<{ status: number; body?: unknown }>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.appointment = {
    _id: { toString: () => "a1", slice: () => "a1" },
    clientId: { _id: { toString: () => CLIENT_ID }, firstName: "A", lastName: "B", email: "a@b.co" },
    professionalId: { _id: { toString: () => PRO_ID }, firstName: "Dr", lastName: "Pro", email: "p@x.co" },
    payment: { status: "pending", method: "card", fiscalReceiptIssuedAt: new Date() },
    toObject() {
      return this;
    },
  };
});

describe("GET /api/payments/receipt — H1 settled-only download", () => {
  it("blocks a client on a card session that is still pending (charge failed/skipped)", async () => {
    const res = await call("client", CLIENT_ID);
    expect(res.status).toBe(400);
  });

  it("blocks a client on an unsettled Interac transfer", async () => {
    (h.store.appointment.payment as Record<string, unknown>).method = "transfer";
    const res = await call("client", CLIENT_ID);
    expect(res.status).toBe(400);
  });

  it("blocks a client on a refunded session even with a receipt issued", async () => {
    (h.store.appointment.payment as Record<string, unknown>).status = "refunded";
    const res = await call("client", CLIENT_ID);
    expect(res.status).toBe(400);
  });

  it("blocks the professional on an unsettled session", async () => {
    const res = await call("professional", PRO_ID);
    expect(res.status).toBe(400);
  });

  it("allows a client once payment is paid", async () => {
    (h.store.appointment.payment as Record<string, unknown>).status = "paid";
    const res = await call("client", CLIENT_ID);
    expect(res.status).toBe(200);
  });

  it("allows an admin override regardless of payment state", async () => {
    const res = await call("admin", ADMIN_ID);
    expect(res.status).toBe(200);
  });
});
