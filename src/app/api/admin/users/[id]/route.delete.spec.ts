/**
 * DELETE /api/admin/users/[id] hard-deletes a user and cascades to their
 * sessions and receipts. For a client, that left each professional's ledger
 * line for sessions that no longer exist: ten such lines were still owed to
 * professionals, eight counted as revenue in the sales journal (2026-09-11).
 * Someone with billing history is now deactivated, not deleted. A deleted
 * professional's products leave the site (spec 003 phase 5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const USER_ID = "c2c2c2c2c2c2c2c2c2c2c2c2";

const h = vi.hoisted(() => {
  const deletes: string[] = [];
  const del = (name: string) => async () => {
    deletes.push(name);
    return { deletedCount: 0 };
  };
  return {
    getServerSession: vi.fn(),
    user: { _id: "c2c2c2c2c2c2c2c2c2c2c2c2", role: "client" } as Record<string, unknown> | null,
    counts: { billedSessions: 0, receipts: 0, ledgerLines: 0 },
    appointmentFilter: { value: null as unknown },
    deletes,
    deletesAtSync: [] as string[],
    syncProfessionalProducts: vi.fn(),
    del,
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: (fn: () => unknown) => {
    fn();
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/intake-rematch", () => ({ rematchWaitingDemandesForReenabledPro: vi.fn() }));
vi.mock("@/lib/products", () => ({ syncProfessionalProducts: h.syncProfessionalProducts }));
vi.mock("@/models/User", () => ({
  default: { findById: async () => h.user, deleteOne: h.del("User") },
}));
vi.mock("@/models/Admin", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
    deleteMany: h.del("Admin"),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    countDocuments: async (filter: unknown) => {
      h.appointmentFilter.value = filter;
      return h.counts.billedSessions;
    },
    deleteMany: h.del("Appointment"),
  },
}));
vi.mock("@/models/ClientReceipt", () => ({
  default: { countDocuments: async () => h.counts.receipts, deleteMany: h.del("ClientReceipt") },
}));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: { countDocuments: async () => h.counts.ledgerLines, deleteMany: h.del("ProfessionalLedgerEntry") },
}));
vi.mock("@/models/Profile", () => ({ default: { deleteMany: h.del("Profile") } }));
vi.mock("@/models/MedicalProfile", () => ({ default: { deleteMany: h.del("MedicalProfile") } }));
vi.mock("@/models/ClientDocument", () => ({ default: { deleteMany: h.del("ClientDocument") } }));
vi.mock("@/models/Review", () => ({ default: { deleteMany: h.del("Review") } }));
vi.mock("@/models/Resource", () => ({ ResourcePurchase: { deleteMany: h.del("ResourcePurchase") } }));
vi.mock("@/models/ResourceEntitlement", () => ({ default: { deleteMany: h.del("ResourceEntitlement") } }));
vi.mock("@/models/Conversation", () => ({ default: { deleteMany: h.del("Conversation") } }));
vi.mock("@/models/Message", () => ({ default: { deleteMany: h.del("Message") } }));

import { DELETE } from "@/app/api/admin/users/[id]/route";

const remove = async () => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: ADMIN_ID, role: "admin" } });
  return (await DELETE({} as never, { params: Promise.resolve({ id: USER_ID }) })) as unknown as {
    status: number;
    body: Record<string, unknown>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.deletes.length = 0;
  h.deletesAtSync.length = 0;
  h.counts = { billedSessions: 0, receipts: 0, ledgerLines: 0 };
  h.appointmentFilter.value = null;
  h.user = { _id: USER_ID, role: "client" };
  h.syncProfessionalProducts.mockImplementation(async () => {
    h.deletesAtSync.push(...h.deletes);
    return 0;
  });
});

describe("DELETE /api/admin/users/[id] — never erases billing records", () => {
  it("refuses a client with a closed, invoiced or paid session, and deletes nothing", async () => {
    h.counts.billedSessions = 2;
    const res = await remove();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "HAS_BILLING_HISTORY", billedSessions: 2 });
    expect(h.deletes).toEqual([]);
  });

  it("refuses a professional who has ledger lines", async () => {
    h.user = { _id: USER_ID, role: "professional" };
    h.counts.ledgerLines = 3;
    const res = await remove();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ledgerLines: 3 });
    expect(h.deletes).toEqual([]);
  });

  it("refuses someone who has receipts", async () => {
    h.counts.receipts = 1;
    const res = await remove();
    expect(res.status).toBe(409);
    expect(h.deletes).toEqual([]);
  });

  it("counts a session as billed once closed, invoiced or paid — as client or as professional", async () => {
    await remove();
    const text = JSON.stringify(h.appointmentFilter.value);
    expect(text).toContain("clientId");
    expect(text).toContain("professionalId");
    expect(text).toContain("sessionCompletedAt");
    expect(text).toContain("invoiceNumber");
    for (const status of ["paid", "processing", "refunded", "partially_refunded"]) {
      expect(text).toContain(`"${status}"`);
    }
  });

  it("still deletes an account with no billing history", async () => {
    const res = await remove();
    expect(res.status).toBe(200);
    expect(h.deletes).toEqual(expect.arrayContaining(["User", "Appointment", "ClientReceipt", "ProfessionalLedgerEntry"]));
  });

  it("takes a deleted professional's products off sale, once the account is gone", async () => {
    h.user = { _id: USER_ID, role: "professional" };
    const res = await remove();
    expect(res.status).toBe(200);
    expect(h.syncProfessionalProducts).toHaveBeenCalledWith(USER_ID);
    expect(h.deletesAtSync).toContain("User");
  });

  it("leaves products alone when the delete is refused, and for a client", async () => {
    h.user = { _id: USER_ID, role: "professional" };
    h.counts.ledgerLines = 1;
    expect((await remove()).status).toBe(409);
    h.user = { _id: USER_ID, role: "client" };
    h.counts.ledgerLines = 0;
    expect((await remove()).status).toBe(200);
    expect(h.syncProfessionalProducts).not.toHaveBeenCalled();
  });
});
