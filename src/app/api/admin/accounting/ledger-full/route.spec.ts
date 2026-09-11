/**
 * The full ledger export (archive / taxes). Its rows are populated, and a
 * populated reference is a document: the professional and session id
 * columns printed "[object Object]".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string; isAdmin?: boolean } } | null,
  permissions: null as Record<string, boolean> | null,
  reads: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  appointmentModelLoaded: false,
}));

// Loading the module is what registers the model populate() needs.
vi.mock("@/models/Appointment", () => {
  h.appointmentModelLoaded = true;
  return { default: {} };
});

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
    find: () => {
      h.reads();
      const q = { populate: () => q, sort: () => q, lean: async () => h.rows };
      return q;
    },
  },
}));

import { GET } from "./route";

const exportCsv = async () => {
  const res = (await GET({ url: "https://x/api/admin/accounting/ledger-full?year=2026" } as never)) as unknown as {
    status: number;
    body: string;
  };
  return { status: res.status, lines: String(res.body).replace(/^\uFEFF/, "").split("\n") };
};

beforeEach(() => {
  h.session = { user: { id: "admin1", role: "admin", isAdmin: true } };
  h.permissions = { manageBilling: true };
  h.reads.mockReset();
  h.rows = [
    {
      entryKind: "credit",
      createdAt: new Date("2026-09-10T17:21:06Z"),
      cycleKey: "2026-B19",
      professionalId: { _id: "pro-1", firstName: "Nathalie", lastName: "Pro" },
      appointmentId: { _id: "apt-1", date: new Date("2026-09-09T12:00:00Z"), time: "12:00" },
      netToProfessionalCad: 150,
      paymentChannel: "transfer",
    },
    {
      // A payout: no session.
      entryKind: "debit",
      createdAt: new Date("2026-09-11T10:00:00Z"),
      cycleKey: "2026-B19",
      professionalId: { _id: "pro-1", firstName: "Nathalie", lastName: "Pro" },
      payoutAmountCad: 150,
      payoutReference: "VIR-1",
      paymentChannel: "transfer",
    },
  ];
});

describe("GET /api/admin/accounting/ledger-full", () => {
  it("registers the Appointment model it populates", () => {
    // Otherwise a freshly started server answers 500 "Schema hasn't been
    // registered for model Appointment" until another route loads it.
    expect(h.appointmentModelLoaded).toBe(true);
  });

  it("is refused to anyone but an admin", async () => {
    h.session = { user: { id: "u", role: "client" } };
    const res = (await GET({ url: "https://x/api/admin/accounting/ledger-full" } as never)) as unknown as { status: number };
    expect(res.status).toBe(401);
  });

  it("is refused to an admin without billing rights, before anything is read", async () => {
    h.permissions = { managePatients: true, manageBilling: false };
    const res = (await GET({ url: "https://x/api/admin/accounting/ledger-full" } as never)) as unknown as { status: number };
    expect(res.status).toBe(403);
    expect(h.reads).not.toHaveBeenCalled();
  });

  it("prints the professional and session ids, not [object Object]", async () => {
    const { status, lines } = await exportCsv();
    expect(status).toBe(200);
    const [credit, debit] = [lines[1].split(","), lines[2].split(",")];
    expect(credit[3]).toBe("pro-1");
    expect(credit[5]).toBe("apt-1");
    expect(debit[3]).toBe("pro-1");
    expect(debit[5]).toBe("");
    expect(lines.join("\n")).not.toContain("[object Object]");
  });
});
