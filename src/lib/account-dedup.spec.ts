/**
 * Anti-doublon helpers: phone-shell consolidation (auto-merge of passwordless
 * lead-capture shells, flag real accounts), name-based flagging, and strong-key
 * lookup (email then phone).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const userFind = vi.fn();
  const userFindOne = vi.fn();
  const userDeleteOne = vi.fn().mockResolvedValue({});
  const apptUpdateMany = vi.fn().mockResolvedValue({});
  const mpDeleteMany = vi.fn().mockResolvedValue({});
  const makeQuery = (result: unknown) => ({
    select() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return {
    userFind,
    userFindOne,
    userDeleteOne,
    apptUpdateMany,
    mpDeleteMany,
    makeQuery,
  };
});

vi.mock("@/models/User", () => ({
  default: {
    find: h.userFind,
    findOne: h.userFindOne,
    deleteOne: h.userDeleteOne,
  },
}));
vi.mock("@/models/MedicalProfile", () => ({
  default: { deleteMany: h.mpDeleteMany },
}));
vi.mock("@/models/Appointment", () => ({
  default: { updateMany: h.apptUpdateMany },
}));

import {
  consolidatePhoneShells,
  findNameDuplicates,
  findUserByStrongKey,
} from "@/lib/account-dedup";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consolidatePhoneShells", () => {
  it("merges a passwordless shell's appointments into the survivor and deletes it", async () => {
    h.userFind.mockReturnValueOnce(
      h.makeQuery([{ _id: "shell1", role: "prospect", password: undefined }]),
    );
    const res = await consolidatePhoneShells({
      survivorId: "surv1",
      phone: "514-555-1234",
    });
    expect(res.merged).toEqual(["shell1"]);
    expect(res.flagged).toEqual([]);
    expect(h.apptUpdateMany).toHaveBeenCalledWith(
      { clientId: "shell1" },
      { $set: { clientId: "surv1" } },
    );
    expect(h.mpDeleteMany).toHaveBeenCalledWith({ userId: "shell1" });
    expect(h.userDeleteOne).toHaveBeenCalledWith({ _id: "shell1" });
  });

  it("flags a real account (has password) instead of merging it", async () => {
    h.userFind.mockReturnValueOnce(
      h.makeQuery([{ _id: "real1", role: "client", password: "hash" }]),
    );
    const res = await consolidatePhoneShells({
      survivorId: "surv1",
      phone: "514-555-1234",
    });
    expect(res.flagged).toEqual(["real1"]);
    expect(res.merged).toEqual([]);
    expect(h.userDeleteOne).not.toHaveBeenCalled();
  });

  it("no-ops when the phone can't be normalized", async () => {
    const res = await consolidatePhoneShells({
      survivorId: "surv1",
      phone: "123",
    });
    expect(res).toEqual({ merged: [], flagged: [] });
    expect(h.userFind).not.toHaveBeenCalled();
  });
});

describe("findNameDuplicates", () => {
  it("returns matching ids (excluding self) by normalized full name", async () => {
    h.userFind.mockReturnValueOnce(h.makeQuery([{ _id: "u2" }, { _id: "u3" }]));
    const ids = await findNameDuplicates({
      firstName: "Joël",
      lastName: "Roy",
      excludeId: "u1",
    });
    expect(ids).toEqual(["u2", "u3"]);
    expect(h.userFind).toHaveBeenCalledWith({
      fullNameLookup: "joel roy",
      _id: { $ne: "u1" },
    });
  });

  it("returns [] for an empty name", async () => {
    const ids = await findNameDuplicates({ firstName: "", lastName: "" });
    expect(ids).toEqual([]);
    expect(h.userFind).not.toHaveBeenCalled();
  });
});

describe("findUserByStrongKey", () => {
  it("matches by email first", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.co" });
    const m = await findUserByStrongKey({
      email: "A@B.co",
      phone: "514-555-1234",
    });
    expect(m?.key).toBe("email");
    expect(h.userFindOne).toHaveBeenCalledWith({ email: "a@b.co" });
  });

  it("falls back to phone hash when there is no email match", async () => {
    h.userFindOne.mockResolvedValueOnce(null); // email miss
    h.userFindOne.mockResolvedValueOnce({ _id: "u9" }); // phone hit
    const m = await findUserByStrongKey({
      email: "none@x.co",
      phone: "514-555-1234",
    });
    expect(m?.key).toBe("phone");
  });

  it("returns null when nothing matches", async () => {
    h.userFindOne.mockResolvedValue(null);
    const m = await findUserByStrongKey({ email: "none@x.co", phone: "123" });
    expect(m).toBeNull();
  });
});
