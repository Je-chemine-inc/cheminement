/**
 * Single-unique-service-request guarantee: ensurePendingServiceRequest is
 * idempotent (Path A + Path B converge on ONE request) and seeds a pending,
 * routable appointment from the client's medical profile. provisionClient-
 * ServiceRequest consolidates duplicates, flags collisions, and auto-routes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const userFindById = vi.fn();
  const userUpdateOne = vi.fn().mockResolvedValue({});
  const apptFindOne = vi.fn();
  const mpFindOne = vi.fn();
  const route = vi.fn().mockResolvedValue({});
  const consolidate = vi.fn().mockResolvedValue({ merged: [], flagged: [] });
  const nameDups = vi.fn().mockResolvedValue([]);
  const created: Array<Record<string, unknown>> = [];
  function FakeAppointment(this: Record<string, unknown>, data: Record<string, unknown>) {
    Object.assign(this, data);
    this._id = "apt_new_1";
    this.save = vi.fn().mockImplementation(async () => {
      created.push(data);
    });
  }
  const makeQuery = (result: unknown) => ({
    select() {
      return this;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });
  return {
    userFindById,
    userUpdateOne,
    apptFindOne,
    mpFindOne,
    route,
    consolidate,
    nameDups,
    created,
    FakeAppointment,
    makeQuery,
  };
});

vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({
  default: { findById: h.userFindById, updateOne: h.userUpdateOne },
}));
vi.mock("@/models/MedicalProfile", () => ({
  default: { findOne: h.mpFindOne },
}));
vi.mock("@/models/Appointment", () => {
  const A = h.FakeAppointment as unknown as {
    findOne: typeof h.apptFindOne;
  };
  A.findOne = h.apptFindOne;
  return { default: A };
});
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi
    .fn()
    .mockResolvedValue({ sessionPrice: 120, platformFee: 12, professionalPayout: 108 }),
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: h.route,
}));
vi.mock("@/lib/account-dedup", () => ({
  consolidatePhoneShells: h.consolidate,
  findNameDuplicates: h.nameDups,
}));

import {
  ensurePendingServiceRequest,
  provisionClientServiceRequest,
} from "@/lib/service-request";

beforeEach(() => {
  vi.clearAllMocks();
  h.created.length = 0;
});

describe("ensurePendingServiceRequest", () => {
  it("is idempotent — reuses an existing open request and creates nothing", async () => {
    h.userFindById.mockReturnValueOnce(h.makeQuery({ _id: "u1", role: "client" }));
    h.apptFindOne.mockReturnValueOnce(h.makeQuery({ _id: "existing1" }));
    const res = await ensurePendingServiceRequest("u1");
    expect(res).toEqual({ created: false, appointmentId: "existing1" });
    expect(h.created).toHaveLength(0);
  });

  it("creates a pending request seeded from the medical profile", async () => {
    h.userFindById.mockReturnValueOnce(
      h.makeQuery({ _id: "u1", role: "client", preferredPaymentMethod: "interac" }),
    );
    h.apptFindOne.mockReturnValueOnce(h.makeQuery(null));
    h.mpFindOne.mockReturnValueOnce(
      h.makeQuery({
        modality: "inPerson",
        primaryIssue: "Anxiety",
        availability: ["week_morning"],
      }),
    );
    const res = await ensurePendingServiceRequest("u1");
    expect(res.created).toBe(true);
    expect(res.appointmentId).toBe("apt_new_1");
    const data = h.created[0];
    expect(data.status).toBe("pending");
    expect(data.routingStatus).toBe("pending");
    expect(data.type).toBe("in-person");
    expect(data.needs).toContain("Anxiety");
    expect((data.payment as Record<string, unknown>).method).toBe("transfer");
  });

  it("skips non-client users", async () => {
    h.userFindById.mockReturnValueOnce(
      h.makeQuery({ _id: "p1", role: "professional" }),
    );
    const res = await ensurePendingServiceRequest("p1");
    expect(res).toEqual({ created: false, appointmentId: null });
  });
});

describe("provisionClientServiceRequest", () => {
  it("flags collisions, ensures a request, and auto-routes it", async () => {
    h.userFindById
      .mockReturnValueOnce(
        h.makeQuery({
          _id: "u1",
          role: "client",
          firstName: "A",
          lastName: "B",
          phone: "514-555-1234",
        }),
      )
      .mockReturnValueOnce(h.makeQuery({ _id: "u1", role: "client" }));
    h.consolidate.mockResolvedValueOnce({ merged: [], flagged: ["real9"] });
    h.nameDups.mockResolvedValueOnce(["name9"]);
    h.apptFindOne.mockReturnValueOnce(h.makeQuery(null));
    h.mpFindOne.mockReturnValueOnce(h.makeQuery({}));

    await provisionClientServiceRequest("u1");

    expect(h.userUpdateOne).toHaveBeenCalledWith(
      { _id: "u1" },
      { $set: { possibleDuplicateOf: ["real9", "name9"] } },
    );
    expect(h.route).toHaveBeenCalledWith("apt_new_1");
  });
});
