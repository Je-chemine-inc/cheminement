/**
 * Spec 002 — an organization that still covers clients cannot be archived
 * (closure would hold all their sessions), and active names are unique.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_ID = "0123456789abcdef01234567";

const h = vi.hoisted(() => ({
  activeCoverages: 0,
  duplicate: null as unknown,
  findByIdAndUpdate: vi.fn(),
  create: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
vi.mock("@/lib/organization-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organization-admin")>()),
  requireBillingAdmin: vi.fn(async () => ({ session: { user: { id: "aaaaaaaaaaaaaaaaaaaaaaaa" } } })),
}));
vi.mock("@/models/OrganizationCoverage", () => ({
  default: {
    countDocuments: vi.fn(async () => h.activeCoverages),
    aggregate: vi.fn(async () => []),
  },
}));
vi.mock("@/models/Organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/Organization")>()),
  default: {
    findByIdAndUpdate: (...args: unknown[]) => ({ lean: async () => h.findByIdAndUpdate(...args) }),
    exists: vi.fn(async () => h.duplicate),
    create: h.create,
  },
}));

import { POST as archive } from "./route";
import { POST as create } from "../../route";

const req = (body: unknown) => ({ json: async () => body, url: "http://x" }) as never;
const ctx = { params: Promise.resolve({ id: ORG_ID }) };
type Res = { status: number; body: Record<string, unknown> };

beforeEach(() => {
  h.activeCoverages = 0;
  h.duplicate = null;
  h.findByIdAndUpdate.mockReset();
  h.findByIdAndUpdate.mockResolvedValue({ _id: ORG_ID, name: "PAE X", active: false });
  h.create.mockReset();
  h.create.mockImplementation(async (doc: Record<string, unknown>) => ({ toObject: () => ({ _id: ORG_ID, ...doc }) }));
});

describe("archiving an organization", () => {
  it("is refused while it still covers someone", async () => {
    h.activeCoverages = 2;
    const res = (await archive(req({ archived: true }), ctx)) as unknown as Res;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("HAS_ACTIVE_COVERAGES");
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("archives (never deletes) once nobody is covered", async () => {
    const res = (await archive(req({ archived: true }), ctx)) as unknown as Res;
    expect(res.status).toBe(200);
    const update = h.findByIdAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
    expect(update.$set.active).toBe(false);
    expect(update.$set.archivedAt).toBeInstanceOf(Date);
  });

  it("restores without checking coverages", async () => {
    h.activeCoverages = 5;
    const res = (await archive(req({ archived: false }), ctx)) as unknown as Res;
    expect(res.status).toBe(200);
  });
});

describe("creating an organization", () => {
  it("refuses a name an active organization already uses", async () => {
    h.duplicate = { _id: "other" };
    const res = (await create(req({ name: "PAE X" }))) as unknown as Res;
    expect(res.status).toBe(409);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("stores only allow-listed fields, and never a Stripe id or active flag from the body", async () => {
    const res = (await create(
      req({ name: "PAE X", negotiatedRate: "90", stripeCustomerId: "cus_x", active: false, contactName: null }),
    )) as unknown as Res;
    expect(res.status).toBe(201);
    const doc = h.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc).toMatchObject({ name: "PAE X", negotiatedRateCents: 9000, active: true });
    expect(doc).not.toHaveProperty("stripeCustomerId");
    expect(doc).not.toHaveProperty("contactName");
  });
});
