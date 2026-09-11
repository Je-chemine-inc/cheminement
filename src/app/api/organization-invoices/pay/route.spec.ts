import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 phase 5 — the organization's pay link. No login, so it answers with
 * the organization, the number, the amounts and the due date — it never reads
 * the invoice's lines, where the patients' names are.
 */

const TOKEN = "b".repeat(64);

const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  selected: [] as string[],
  allowed: true,
  padEnabled: false,
  start: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "1.2.3.4",
  rateLimit: () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/interac-deposit-email", () => ({ getInteracDepositEmail: async () => "paiement@jechemine.ca" }));
vi.mock("@/lib/organization-invoice-card", () => ({ startOrganizationPayment: h.start }));
vi.mock("@/models/PlatformSettings", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: async () => ({ organizationPadEnabled: h.padEnabled }) }) }),
  },
}));
vi.mock("@/models/OrganizationInvoice", () => ({
  default: {
    findOne: () => ({
      select: (fields: string) => {
        h.selected.push(fields);
        return { lean: async () => h.invoice };
      },
    }),
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => ({ name: "PAE Desjardins", language: "en" }) }) }) },
}));

import { GET, POST } from "./route";

type Res = { status: number; body: Record<string, unknown> };
const get = async (token: string | null) =>
  (await GET({
    url: `https://x/api/organization-invoices/pay${token ? `?token=${token}` : ""}`,
    headers: { get: () => null },
  } as never)) as unknown as Res;
const post = async (body: unknown) =>
  (await POST({ json: async () => body, headers: { get: () => null } } as never)) as unknown as Res;

beforeEach(() => {
  h.allowed = true;
  h.padEnabled = false;
  h.selected = [];
  h.invoice = {
    _id: "inv1",
    organizationId: "org1",
    number: "JCO-2026-000007",
    status: "sent",
    totalCents: 18000,
    paidCents: 0,
    balanceCents: 18000,
    dueAt: new Date("2026-10-31T13:00:00Z"),
    lines: [{ patientFullName: "Léa Roy" }],
  };
  h.start.mockReset();
});

describe("GET /api/organization-invoices/pay", () => {
  it("answers with what a billing clerk needs — and never reads the patients' lines", async () => {
    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      organizationName: "PAE Desjardins",
      language: "en",
      number: "JCO-2026-000007",
      balanceCents: 18000,
      state: "awaiting",
      interacEmail: "paiement@jechemine.ca",
      debitPending: null,
    });
    expect(h.selected[0]).not.toMatch(/lines|payToken|billTo|payments|stripePaymentIntentId/);
    expect(JSON.stringify(res.body)).not.toContain("Léa");
  });

  it("offers bank debit only while its switch is on", async () => {
    expect((await get(TOKEN)).body.methods).toEqual(["card"]);
    h.padEnabled = true;
    expect((await get(TOKEN)).body.methods).toEqual(["card", "pad"]);
  });

  it("a debit on its way shows as such — amount and date, never Stripe's id — with nothing to pay", async () => {
    h.padEnabled = true;
    const since = new Date("2026-10-02T14:00:00Z");
    h.invoice = { ...h.invoice, pendingDebit: { paymentIntentId: "pi_debit_1", amountCents: 18000, since } };
    const res = await get(TOKEN);
    expect(res.body).toMatchObject({ state: "processing", debitPending: { amountCents: 18000, since }, methods: [] });
    expect(JSON.stringify(res.body)).not.toContain("pi_debit_1");
  });

  it("a paid or void invoice shows as such, with nothing to pay", async () => {
    h.invoice = { ...h.invoice, status: "paid", paidCents: 18000, balanceCents: 0 };
    const paid = await get(TOKEN);
    expect(paid.body.state).toBe("paid");
    expect(paid.body.methods).toEqual([]);
    h.invoice = { ...h.invoice, status: "void" };
    expect((await get(TOKEN)).body.state).toBe("closed");
  });

  it("a malformed, missing or unknown token is a 404, and floods are cut off", async () => {
    expect((await get("nope")).status).toBe(404);
    expect((await get(null)).status).toBe(404);
    h.invoice = null;
    expect((await get(TOKEN)).status).toBe(404);
    h.allowed = false;
    expect((await get(TOKEN)).status).toBe(429);
  });
});

describe("POST /api/organization-invoices/pay", () => {
  it("passes only the token and the method on — the amount is the database's", async () => {
    h.start.mockResolvedValue({ ok: true, clientSecret: "sec", amountCents: 18000, reused: false, method: "card" });
    const res = await post({ token: TOKEN, amount: 1 });
    expect(h.start).toHaveBeenCalledWith(TOKEN, "card");
    expect(res.body).toEqual({
      clientSecret: "sec",
      amountCents: 18000,
      currency: "CAD",
      method: "card",
      verification: null,
    });
  });

  it("a bank debit waiting for its microdeposits hands back where to confirm them", async () => {
    const verification = { url: "https://payments.stripe.com/microdeposit/x", arrivalDate: 1790000000 };
    h.start.mockResolvedValue({ ok: true, clientSecret: "sec", amountCents: 18000, reused: true, method: "pad", verification });
    const res = await post({ token: TOKEN, method: "pad" });
    expect(h.start).toHaveBeenCalledWith(TOKEN, "pad");
    expect(res.body).toMatchObject({ method: "pad", verification });
  });

  it("relays a refusal with its code", async () => {
    h.start.mockResolvedValue({ ok: false, status: 409, code: "METHOD_UNAVAILABLE", error: "off" });
    const res = await post({ token: TOKEN, method: "pad" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("METHOD_UNAVAILABLE");
  });
});
