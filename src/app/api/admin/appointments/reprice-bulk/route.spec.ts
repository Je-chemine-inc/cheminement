/**
 * Admin bulk re-price. Pins the auth gate and the two rules that protect money:
 * only explicitly selected ids are touched (a pricing change never cascades on
 * its own), and settled appointments are skipped and reported rather than
 * silently rewritten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "aaaaaaaaaaaaaaaaaaaaaaaa";
const A1 = "bbbbbbbbbbbbbbbbbbbbbbbb";
const A2 = "cccccccccccccccccccccccc";
const A3 = "dddddddddddddddddddddddd";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  find: vi.fn(),
  findById: vi.fn(),
  findOneAndUpdate: vi.fn(),
  pricing: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: (...a: unknown[]) => h.pricing(...a),
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: (...a: unknown[]) => ({ sort: () => h.find(...a) }),
    findById: (...a: unknown[]) => h.findById(...a),
    findOneAndUpdate: (...a: unknown[]) => h.findOneAndUpdate(...a),
  },
}));

import { GET, POST } from "@/app/api/admin/appointments/reprice-bulk/route";

type Res = Promise<{ status: number; body: unknown }>;

const callPost = (body: unknown): Res =>
  POST({ json: async () => body } as never) as unknown as Res;

const callGet = (professionalId: string | null): Res =>
  GET({
    nextUrl: { searchParams: new URLSearchParams(professionalId ? { professionalId } : {}) },
  } as never) as unknown as Res;

const appt = (id: string, status = "pending", extra = {}) => ({
  _id: id,
  professionalId: PRO,
  therapyType: "solo",
  date: new Date("2026-09-10"),
  payment: { status, price: 160, platformFee: 18, professionalPayout: 142 },
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue({ user: { id: "adm", role: "admin" } });
  h.pricing.mockResolvedValue({
    sessionPrice: 175,
    platformFee: 25,
    professionalPayout: 150,
  });
  h.findOneAndUpdate.mockResolvedValue({});
  h.findById.mockImplementation((id: string) => Promise.resolve(appt(id)));
});

describe("auth gate", () => {
  it.each([
    ["professional", { user: { id: PRO, role: "professional" } }],
    ["client", { user: { id: "c", role: "client" } }],
    ["anonymous", null],
  ])("rejects %s on POST", async (_l, session) => {
    h.getServerSession.mockResolvedValue(session);
    const res = await callPost({ appointmentIds: [A1] });
    expect(res.status).toBe(401);
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-admin on GET", async () => {
    h.getServerSession.mockResolvedValue({ user: { id: PRO, role: "professional" } });
    expect((await callGet(PRO)).status).toBe(401);
  });
});

describe("input validation", () => {
  it("refuses an empty selection — nothing is implicit", async () => {
    const res = await callPost({ appointmentIds: [] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "NO_APPOINTMENTS_SELECTED" });
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses a missing appointmentIds array", async () => {
    expect((await callPost({})).status).toBe(400);
  });

  it("refuses a malformed id rather than partially applying", async () => {
    const res = await callPost({ appointmentIds: [A1, "not-an-id"] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "INVALID_APPOINTMENT_ID" });
    // KEY: nothing written, not even the valid one.
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("caps the batch size", async () => {
    const many = Array.from({ length: 201 }, () => A1);
    const res = await callPost({ appointmentIds: many });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "TOO_MANY_APPOINTMENTS" });
  });
});

describe("applying", () => {
  it("re-prices only the ids passed", async () => {
    const res = await callPost({ appointmentIds: [A1, A2] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repricedCount: 2 });
    expect(h.findOneAndUpdate).toHaveBeenCalledTimes(2);

    const [, update] = h.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, number> },
    ];
    expect(update.$set).toEqual({
      "payment.price": 175,
      "payment.platformFee": 25,
      "payment.professionalPayout": 150,
      "payment.listPrice": 175,
    });
  });

  it.each(["paid", "processing", "refunded", "partially_refunded"])(
    "skips a %s appointment and reports it",
    async (status) => {
      h.findById.mockImplementation((id: string) =>
        Promise.resolve(id === A2 ? appt(id, status) : appt(id)),
      );

      const res = await callPost({ appointmentIds: [A1, A2] });

      expect(res.body).toMatchObject({
        repricedCount: 1,
        skipped: [{ id: A2, reason: "PAYMENT_LOCKED" }],
      });
      expect(h.findOneAndUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it("skips an appointment whose receipt was already issued", async () => {
    h.findById.mockImplementation((id: string) =>
      Promise.resolve(
        id === A3
          ? appt(id, "pending", { fiscalReceiptIssuedAt: new Date() })
          : appt(id),
      ),
    );

    const res = await callPost({ appointmentIds: [A1, A3] });

    expect(res.body).toMatchObject({
      repricedCount: 1,
      skipped: [{ id: A3, reason: "RECEIPT_ISSUED" }],
    });
  });

  it("re-checks status at apply time, not just at preview", async () => {
    // The preview list can go stale — a session may be paid in between.
    h.findById.mockResolvedValue(appt(A1, "paid"));

    const res = await callPost({ appointmentIds: [A1] });

    expect(res.body).toMatchObject({ repricedCount: 0 });
    expect(h.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports a missing appointment instead of failing the batch", async () => {
    h.findById.mockImplementation((id: string) =>
      Promise.resolve(id === A2 ? null : appt(id)),
    );

    const res = await callPost({ appointmentIds: [A1, A2] });

    expect(res.body).toMatchObject({
      repricedCount: 1,
      skipped: [{ id: A2, reason: "NOT_FOUND" }],
    });
  });
});

describe("preview", () => {
  it("lists current vs proposed and flags what changes", async () => {
    h.find.mockResolvedValue([appt(A1), appt(A2)]);

    const res = await callGet(PRO);

    expect(res.status).toBe(200);
    const rows = (res.body as { appointments: { current: unknown; proposed: unknown; changed: boolean }[] })
      .appointments;
    expect(rows).toHaveLength(2);
    expect(rows[0].current).toMatchObject({ price: 160 });
    expect(rows[0].proposed).toMatchObject({ price: 175, professionalPayout: 150 });
    expect(rows[0].changed).toBe(true);
  });

  it("marks an already-correct appointment as unchanged", async () => {
    h.find.mockResolvedValue([
      {
        ...appt(A1),
        payment: {
          status: "pending",
          price: 175,
          platformFee: 25,
          professionalPayout: 150,
        },
      },
    ]);

    const res = await callGet(PRO);
    const rows = (res.body as { appointments: { changed: boolean }[] }).appointments;
    expect(rows[0].changed).toBe(false);
  });

  it("excludes settled appointments at the query level", async () => {
    h.find.mockResolvedValue([]);
    await callGet(PRO);

    const [filter] = h.find.mock.calls[0] as [Record<string, unknown>];
    expect(filter["payment.status"]).toEqual({
      $nin: ["paid", "processing", "refunded", "partially_refunded"],
    });
    expect(filter.fiscalReceiptIssuedAt).toEqual({ $in: [null, undefined] });
  });

  it("rejects a malformed professionalId", async () => {
    expect((await callGet("nope")).status).toBe(400);
    expect((await callGet(null)).status).toBe(400);
  });
});
