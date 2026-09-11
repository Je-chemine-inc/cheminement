import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the coverage lookup and the session-cap reservation (spec 002). The cap
 * is race-safe only because of the exact filter shape sent to MongoDB, so the
 * specs assert that shape, not just the return value.
 */

const h = vi.hoisted(() => ({
  find: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("@/models/OrganizationCoverage", () => ({
  default: {
    find: h.find,
    findOneAndUpdate: h.findOneAndUpdate,
    updateOne: h.updateOne,
  },
}));

import {
  beneficiaryKeyOf,
  findApplicableCoverage,
  isWithinValidity,
  mergeOrganizationCoverages,
  releaseCoverageSlot,
  reserveCoverageSlot,
  toCoverageTerms,
} from "@/lib/organization-coverage";

const COV = "cov-1";
const APT = "apt-7";
const ids = (...xs: string[]) => xs.map((x) => ({ toString: () => x }));

beforeEach(() => {
  h.find.mockReset();
  h.findOneAndUpdate.mockReset();
  h.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
});

describe("beneficiaryKeyOf", () => {
  it("is 'self' for the account holder and for a referred patient", () => {
    expect(beneficiaryKeyOf({ bookingFor: "self" })).toBe("self");
    expect(beneficiaryKeyOf({ bookingFor: "patient" })).toBe("self");
    expect(beneficiaryKeyOf({})).toBe("self");
  });

  it("keys a relative by their normalized name, so a guardian's own sessions stay separate", () => {
    expect(
      beneficiaryKeyOf({
        bookingFor: "loved-one",
        lovedOneInfo: { firstName: "Élodie ", lastName: " Côté" },
      }),
    ).toBe("loved-one:elodie cote");
  });

  it("never falls back to 'self' for a relative with no name", () => {
    expect(beneficiaryKeyOf({ bookingFor: "loved-one", lovedOneInfo: null })).toBe(
      "loved-one:unknown",
    );
  });
});

describe("reserveCoverageSlot — the atomic cap", () => {
  it("sends one conditional update: retry-safe and full-aware", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 6,
      status: "active",
      consumedAppointmentIds: ids("a", "b", APT),
    });
    await reserveCoverageSlot(COV, APT);
    expect(h.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: COV,
        $or: [
          { consumedAppointmentIds: APT },
          {
            status: "active",
            $expr: { $lt: [{ $size: "$consumedAppointmentIds" }, "$maxSessions"] },
          },
        ],
      },
      { $addToSet: { consumedAppointmentIds: APT } },
      { new: true },
    );
  });

  it("grants a slot and reports the count", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 6,
      status: "active",
      consumedAppointmentIds: ids("a", "b", APT),
    });
    expect(await reserveCoverageSlot(COV, APT)).toEqual({
      granted: true,
      used: 3,
      max: 6,
      exhaustedNow: false,
    });
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("marks the coverage exhausted when the last slot is taken", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 3,
      status: "active",
      consumedAppointmentIds: ids("a", "b", APT),
    });
    const r = await reserveCoverageSlot(COV, APT);
    expect(r).toMatchObject({ granted: true, used: 3, exhaustedNow: true });
    expect(h.updateOne).toHaveBeenCalledWith(
      { _id: COV, status: "active" },
      { $set: { status: "exhausted" } },
    );
  });

  it("denies when the filter matched nothing (cap reached, or coverage ended)", async () => {
    h.findOneAndUpdate.mockResolvedValue(null);
    expect(await reserveCoverageSlot(COV, APT)).toEqual({ granted: false });
  });

  it("denies a coverage with no cap (nothing to reserve)", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      status: "active",
      consumedAppointmentIds: ids(APT),
    });
    expect(await reserveCoverageSlot(COV, APT)).toEqual({ granted: false });
  });
});

describe("releaseCoverageSlot", () => {
  it("pulls only this appointment's slot", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 6,
      status: "active",
      consumedAppointmentIds: ids("a"),
    });
    expect(await releaseCoverageSlot(COV, APT)).toBe(true);
    expect(h.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: COV, consumedAppointmentIds: APT },
      { $pull: { consumedAppointmentIds: APT } },
      { new: true },
    );
  });

  it("re-opens an exhausted coverage when that frees room", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 3,
      status: "exhausted",
      consumedAppointmentIds: ids("a", "b"),
    });
    await releaseCoverageSlot(COV, APT);
    expect(h.updateOne).toHaveBeenCalledWith(
      { _id: COV, status: "exhausted" },
      { $set: { status: "active" } },
    );
  });

  it("leaves it exhausted when a renewal is already active (unique index)", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 3,
      status: "exhausted",
      consumedAppointmentIds: ids("a"),
    });
    h.updateOne.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    await expect(releaseCoverageSlot(COV, APT)).resolves.toBe(true);
  });

  it("does not re-open a coverage whose validity has ended", async () => {
    h.findOneAndUpdate.mockResolvedValue({
      maxSessions: 3,
      status: "exhausted",
      validUntil: new Date("2026-01-01"),
      consumedAppointmentIds: ids("a"),
    });
    await releaseCoverageSlot(COV, APT, new Date("2026-09-11"));
    expect(h.updateOne).not.toHaveBeenCalled();
  });

  it("returns false when the session held no slot", async () => {
    h.findOneAndUpdate.mockResolvedValue(null);
    expect(await releaseCoverageSlot(COV, APT)).toBe(false);
  });
});

describe("findApplicableCoverage", () => {
  const args = {
    clientId: "client-1",
    beneficiaryKey: "self",
    appointmentId: APT,
    sessionDate: new Date("2026-09-10T12:00:00Z"),
  };

  it("finds an active coverage for the person, or one already holding this session", async () => {
    h.find.mockResolvedValue([]);
    await findApplicableCoverage(args);
    expect(h.find).toHaveBeenCalledWith({
      clientId: "client-1",
      beneficiaryKey: "self",
      $or: [{ status: "active" }, { consumedAppointmentIds: APT }],
    });
  });

  it("prefers the coverage that already holds this session (closure retry after exhaustion)", async () => {
    const exhausted = { _id: "old", status: "exhausted", consumedAppointmentIds: ids(APT) };
    const renewal = { _id: "new", status: "active", consumedAppointmentIds: ids() };
    h.find.mockResolvedValue([renewal, exhausted]);
    expect(await findApplicableCoverage(args)).toBe(exhausted);
  });

  it("ignores an active coverage whose validity window excludes the session date", async () => {
    h.find.mockResolvedValue([
      {
        _id: "c",
        status: "active",
        validFrom: new Date("2026-10-01"),
        consumedAppointmentIds: ids(),
      },
    ]);
    expect(await findApplicableCoverage(args)).toBeNull();
  });
});

describe("isWithinValidity / toCoverageTerms", () => {
  it("treats an open-ended window as always valid", () => {
    expect(isWithinValidity({}, new Date())).toBe(true);
  });

  it("maps consent and the cap for the resolver", () => {
    const terms = toCoverageTerms({
      _id: "cov-9",
      mode: "full",
      maxSessions: 6,
      consent: { status: "withdrawn" },
      caseNumber: "PAE-1",
    } as never);
    expect(terms).toMatchObject({ id: "cov-9", hasCap: true, consentGiven: false, caseNumber: "PAE-1" });
  });
});

describe("mergeOrganizationCoverages (account merge)", () => {
  const loserId = "loser" as never;
  const survivorId = "survivor" as never;

  it("moves each coverage to the surviving account, one at a time", async () => {
    h.find.mockResolvedValue([{ _id: "c1" }, { _id: "c2" }]);
    h.updateOne.mockResolvedValue({ modifiedCount: 1 });
    expect(await mergeOrganizationCoverages({ loserId, survivorId })).toBe(2);
    expect(h.updateOne).toHaveBeenCalledWith({ _id: "c1" }, { $set: { clientId: survivorId } });
  });

  it("on a clash of two active coverages, keeps the survivor's and retires the other — without aborting", async () => {
    h.find.mockResolvedValue([{ _id: "c1" }]);
    h.updateOne
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }))
      .mockResolvedValueOnce({ modifiedCount: 1 });
    expect(await mergeOrganizationCoverages({ loserId, survivorId })).toBe(1);
    const retire = h.updateOne.mock.calls[1] as [unknown, { $set: Record<string, unknown> }];
    expect(retire[1].$set).toMatchObject({ clientId: survivorId, status: "ended" });
  });

  it("rethrows anything other than a duplicate-key clash", async () => {
    h.find.mockResolvedValue([{ _id: "c1" }]);
    h.updateOne.mockRejectedValueOnce(new Error("connection lost"));
    await expect(mergeOrganizationCoverages({ loserId, survivorId })).rejects.toThrow("connection lost");
  });
});
