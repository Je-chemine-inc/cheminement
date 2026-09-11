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
vi.mock("@/lib/organization-invoice-card", () => ({ startOrganizationCardPayment: h.start }));
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

const get = (token: string | null) =>
  GET({ url: `https://x/api/organization-invoices/pay${token ? `?token=${token}` : ""}`, headers: { get: () => null } } as never);
const post = (body: unknown) =>
  POST({ json: async () => body, headers: { get: () => null } } as never);

beforeEach(() => {
  h.allowed = true;
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
    const res = (await get(TOKEN)) as unknown as { status: number; body: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      organizationName: "PAE Desjardins",
      language: "en",
      number: "JCO-2026-000007",
      balanceCents: 18000,
      state: "awaiting",
      interacEmail: "paiement@jechemine.ca",
    });
    expect(h.selected[0]).not.toMatch(/lines|payToken|billTo|payments/);
    expect(JSON.stringify(res.body)).not.toContain("Léa");
  });

  it("a paid or void invoice shows as such, with nothing to pay", async () => {
    h.invoice = { ...h.invoice, status: "paid", paidCents: 18000, balanceCents: 0 };
    expect(((await get(TOKEN)) as unknown as { body: { state: string } }).body.state).toBe("paid");
    h.invoice = { ...h.invoice, status: "void" };
    expect(((await get(TOKEN)) as unknown as { body: { state: string } }).body.state).toBe("closed");
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
  it("passes only the token on — the amount is the database's", async () => {
    h.start.mockResolvedValue({ ok: true, clientSecret: "sec", amountCents: 18000, reused: false });
    const res = (await post({ token: TOKEN, amount: 1 })) as unknown as { status: number; body: Record<string, unknown> };
    expect(h.start).toHaveBeenCalledWith(TOKEN);
    expect(res.body).toEqual({ clientSecret: "sec", amountCents: 18000, currency: "CAD" });
  });

  it("relays a refusal with its code", async () => {
    h.start.mockResolvedValue({ ok: false, status: 409, code: "PAYMENT_IN_PROGRESS", error: "busy" });
    const res = (await post({ token: TOKEN })) as unknown as { status: number; body: Record<string, unknown> };
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PAYMENT_IN_PROGRESS");
  });
});
