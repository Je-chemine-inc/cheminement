import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 phase 6 — admin billing names who pays each session: the client,
 * the organization and where its invoice stands, a payer outside the platform,
 * or nobody decided yet. Organization names and invoice numbers come from two
 * batched lookups for the page, never one per row.
 */

const ORG = "0123456789abcdef01234567";
const INV = "0123456789abcdef0123456e";

const h = vi.hoisted(() => ({
  session: { user: { id: "admin1", role: "admin" } } as { user: { id: string; role: string } } | null,
  page: [] as Record<string, unknown>[],
  orgFind: vi.fn(),
  invFind: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/User", () => ({ default: { find: () => ({ select: () => ({ lean: async () => [] }) }) } }));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: (filter: Record<string, unknown>) => {
      // The page query (with populate…) vs the summary query (select → lean).
      const pageChain = {
        select: () => pageChain,
        populate: () => pageChain,
        sort: () => pageChain,
        skip: () => pageChain,
        limit: () => pageChain,
        lean: async () => ("$or" in filter || filter.status ? h.page : []),
      };
      return pageChain;
    },
    countDocuments: async () => h.page.length,
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { find: (f: unknown) => ({ select: () => ({ lean: async () => h.orgFind(f) }) }) },
}));
vi.mock("@/models/OrganizationInvoice", () => ({
  default: { find: (f: unknown) => ({ select: () => ({ lean: async () => h.invFind(f) }) }) },
}));

import { GET } from "./route";

const apt = (id: string, tpb?: Record<string, unknown>) => ({
  _id: { toString: () => id },
  clientId: { _id: { toString: () => "c1" }, firstName: "Léa", lastName: "Roy" },
  professionalId: { firstName: "Sam", lastName: "Pro" },
  date: new Date("2026-09-10T12:00:00Z"),
  status: "completed",
  payment: { status: tpb ? "covered" : "paid", price: tpb ? 0 : 120, platformFee: 12, professionalPayout: 108 },
  ...(tpb ? { thirdPartyBilling: tpb } : {}),
});

type Payer = Record<string, unknown> | undefined;
const payers = async () =>
  ((await GET({ url: "https://x/api/admin/billing" } as never)) as unknown as {
    body: { payments: Array<{ payer: Payer }> };
  }).body.payments.map((p) => p.payer);

beforeEach(() => {
  h.session = { user: { id: "admin1", role: "admin" } };
  h.orgFind.mockReset();
  h.orgFind.mockReturnValue([{ _id: ORG, name: "PAE Desjardins" }]);
  h.invFind.mockReset();
  h.invFind.mockReturnValue([{ _id: INV, number: "JCO-2026-000007", status: "sent" }]);
  h.page = [
    apt("a1"),
    apt("a2", { kind: "organization", state: "confirmed", organizationId: ORG, orgAmountCents: 12000, orgStatus: "invoiced", orgInvoiceId: INV, platformFeeTotalCents: 1200, proPayoutTotalCents: 10800 }),
    apt("a3", { kind: "external", state: "confirmed", organizationId: ORG, externalPayerLabel: "CNESST", orgAmountCents: 0, orgStatus: "unbilled", platformFeeTotalCents: 1200, proPayoutTotalCents: 10800 }),
    apt("a4", { kind: "organization", state: "awaiting_decision", organizationId: ORG, orgAmountCents: 12000, orgStatus: "unbilled", platformFeeTotalCents: 1200, proPayoutTotalCents: 10800 }),
  ];
});

describe("GET /api/admin/billing — the payer", () => {
  it("is refused to anyone but an admin", async () => {
    h.session = { user: { id: "u", role: "client" } };
    expect(((await GET({ url: "https://x/api/admin/billing" } as never)) as unknown as { status: number }).status).toBe(401);
  });

  it("names the organization and the invoice the session went out on", async () => {
    const [client, org, external, undecided] = await payers();
    expect(client).toBeUndefined();
    expect(org).toMatchObject({
      kind: "organization",
      organizationName: "PAE Desjardins",
      orgStatus: "invoiced",
      orgInvoiceNumber: "JCO-2026-000007",
      orgAmount: 120,
    });
    expect(external).toMatchObject({ kind: "external", externalLabel: "CNESST", orgInvoiceNumber: "" });
    expect(undecided).toMatchObject({ state: "awaiting_decision", organizationName: "PAE Desjardins" });
  });

  it("looks organizations and invoices up once for the whole page", async () => {
    await payers();
    expect(h.orgFind).toHaveBeenCalledTimes(1);
    expect(h.invFind).toHaveBeenCalledTimes(1);
  });

  it("makes no lookup at all on a page with no third party", async () => {
    h.page = [apt("a1")];
    await payers();
    expect(h.orgFind).not.toHaveBeenCalled();
    expect(h.invFind).not.toHaveBeenCalled();
  });
});
