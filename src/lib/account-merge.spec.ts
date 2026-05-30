/**
 * Account-merge engine: re-points every collection that references the loser to
 * the survivor, handles the MedicalProfile singleton, backfills missing survivor
 * fields, and deletes the loser LAST. Client-accounts only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SURV = "aaaaaaaaaaaaaaaaaaaaaaaa";
const LOSER = "bbbbbbbbbbbbbbbbbbbbbbbb";

const updateManyMock = () => vi.fn().mockResolvedValue({ modifiedCount: 1 });

const h = vi.hoisted(() => {
  const mk = () => ({ updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) });
  const user = {
    findById: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: vi.fn().mockResolvedValue({}),
  };
  const mp = {
    findOne: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteMany: vi.fn().mockResolvedValue({}),
  };
  const profile = { deleteMany: vi.fn().mockResolvedValue({}) };
  const admin = { exists: vi.fn().mockResolvedValue(null) };
  const appt = mk();
  const cdoc = mk();
  const crcpt = mk();
  const review = mk();
  const stored = mk();
  const message = mk();
  const convo = mk();
  const extMsg = mk();
  const rpurch = mk();
  const store: {
    survivor: Record<string, unknown> | null;
    loser: Record<string, unknown> | null;
    survivorHasMedical: unknown;
  } = { survivor: null, loser: null, survivorHasMedical: null };
  return {
    user,
    mp,
    profile,
    admin,
    appt,
    cdoc,
    crcpt,
    review,
    stored,
    message,
    convo,
    extMsg,
    rpurch,
    store,
  };
});

vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ default: h.user }));
vi.mock("@/models/MedicalProfile", () => ({ default: h.mp }));
vi.mock("@/models/Profile", () => ({ default: h.profile }));
vi.mock("@/models/Appointment", () => ({ default: h.appt }));
vi.mock("@/models/ClientDocument", () => ({ default: h.cdoc }));
vi.mock("@/models/ClientReceipt", () => ({ default: h.crcpt }));
vi.mock("@/models/Review", () => ({ default: h.review }));
vi.mock("@/models/StoredFile", () => ({ default: h.stored }));
vi.mock("@/models/Message", () => ({ default: h.message }));
vi.mock("@/models/Conversation", () => ({ default: h.convo }));
vi.mock("@/models/ExternalMessage", () => ({ default: h.extMsg }));
vi.mock("@/models/Admin", () => ({ default: h.admin }));
vi.mock("@/models/AdminAccessLog", () => ({
  default: { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) },
}));
vi.mock("@/models/AuthAuditLog", () => ({
  default: { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) },
}));
vi.mock("@/models/Resource", () => ({ ResourcePurchase: h.rpurch }));

import { mergeAccounts } from "@/lib/account-merge";

const makeUser = (over: Record<string, unknown> = {}) => ({
  role: "client",
  managedAccounts: [],
  possibleDuplicateOf: [],
  paymentGuaranteeStatus: "none",
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // default: each model touched re-points 1 doc
  for (const m of [
    h.appt,
    h.cdoc,
    h.crcpt,
    h.review,
    h.stored,
    h.message,
    h.convo,
    h.extMsg,
    h.rpurch,
  ]) {
    m.updateMany = updateManyMock();
  }
  h.mp.findOne = vi.fn(() => ({
    select: () => ({ lean: () => Promise.resolve(h.store.survivorHasMedical) }),
  }));
  h.mp.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
  h.admin.exists = vi.fn().mockResolvedValue(null);
  h.store.survivor = makeUser();
  h.store.loser = makeUser();
  h.store.survivorHasMedical = { _id: "mp1" };
  h.user.findById = vi.fn((idArg: string) =>
    Promise.resolve(
      String(idArg) === SURV
        ? h.store.survivor
        : String(idArg) === LOSER
          ? h.store.loser
          : null,
    ),
  );
});

describe("mergeAccounts — guards", () => {
  it("rejects merging an account into itself", async () => {
    await expect(
      mergeAccounts({ survivorId: SURV, loserId: SURV }),
    ).rejects.toThrow(/into itself/i);
  });

  it("rejects merging non-client accounts", async () => {
    h.store.survivor = makeUser({ role: "professional" });
    await expect(
      mergeAccounts({ survivorId: SURV, loserId: LOSER }),
    ).rejects.toThrow(/client accounts/i);
  });

  it("refuses (fail-safe) when either account owns an Admin record", async () => {
    h.admin.exists = vi.fn().mockResolvedValue({ _id: "adm1" });
    await expect(
      mergeAccounts({ survivorId: SURV, loserId: LOSER }),
    ).rejects.toThrow(/admin record/i);
    expect(h.user.deleteOne).not.toHaveBeenCalled();
  });

  it("refuses merging a guardian with their own managed minor", async () => {
    h.store.survivor = makeUser({ managedAccounts: [LOSER] });
    await expect(
      mergeAccounts({ survivorId: SURV, loserId: LOSER }),
    ).rejects.toThrow(/guardian/i);
    expect(h.user.deleteOne).not.toHaveBeenCalled();
  });
});

describe("mergeAccounts — happy path", () => {
  it("re-points loser data to the survivor and deletes the loser last", async () => {
    const res = await mergeAccounts({ survivorId: SURV, loserId: LOSER });

    // appointments re-pointed: filter on loser, set survivor
    const [filter, update] = h.appt.updateMany.mock.calls[0];
    expect(String((filter as { clientId: unknown }).clientId)).toBe(LOSER);
    expect(
      String((update as { $set: { clientId: unknown } }).$set.clientId),
    ).toBe(SURV);

    // a representative spread of collections was touched
    expect(h.crcpt.updateMany).toHaveBeenCalled();
    expect(h.review.updateMany).toHaveBeenCalled();
    expect(h.rpurch.updateMany).toHaveBeenCalled();
    expect(h.convo.updateMany).toHaveBeenCalled();

    // loser removed last
    expect(String(h.user.deleteOne.mock.calls[0][0]._id)).toBe(LOSER);
    expect(res.deletedLoser).toBe(true);
    expect(res.reassigned.appointments).toBe(1);
  });

  it("keeps the survivor's MedicalProfile (loser's is NOT moved)", async () => {
    h.store.survivorHasMedical = { _id: "mp-survivor" };
    const res = await mergeAccounts({ survivorId: SURV, loserId: LOSER });
    expect(h.mp.updateMany).not.toHaveBeenCalled();
    expect(res.movedMedicalProfile).toBe(false);
  });

  it("moves the loser's MedicalProfile when the survivor has none", async () => {
    h.store.survivorHasMedical = null;
    h.mp.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const res = await mergeAccounts({ survivorId: SURV, loserId: LOSER });
    expect(h.mp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.anything() }),
      { $set: { userId: expect.anything() } },
    );
    expect(res.movedMedicalProfile).toBe(true);
  });

  it("backfills missing survivor fields from the loser (never overwrites)", async () => {
    h.store.survivor = makeUser({ phone: undefined, location: "Montreal" });
    h.store.loser = makeUser({ phone: "5145551234", location: "Quebec" });
    const res = await mergeAccounts({ survivorId: SURV, loserId: LOSER });
    expect((h.store.survivor as Record<string, unknown>).phone).toBe(
      "5145551234",
    );
    // existing survivor value is preserved, not overwritten
    expect((h.store.survivor as Record<string, unknown>).location).toBe(
      "Montreal",
    );
    expect(res.filledFields).toContain("phone");
    expect(res.filledFields).not.toContain("location");
    expect(
      (h.store.survivor as { save: ReturnType<typeof vi.fn> }).save,
    ).toHaveBeenCalled();
  });
});
