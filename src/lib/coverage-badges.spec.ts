import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 — the badge a professional sees ("PAE · 3/6"): the right person's
 * coverage, and nothing about the organization beyond its kind.
 */

const CLIENT = "0123456789abcdef01234560";
const OTHER_CLIENT = "0123456789abcdef01234561";

const h = vi.hoisted(() => ({
  coverages: [] as Record<string, unknown>[],
}));

vi.mock("@/models/OrganizationCoverage", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => h.coverages }) }) },
}));
vi.mock("@/models/Organization", () => ({
  default: {
    find: () => ({
      select: () => ({ lean: async () => [{ _id: "o1", kind: "eap", name: "PAE Desjardins", negotiatedRateCents: 9000 }] }),
    }),
  },
}));

import { coverageBadgesFor } from "@/lib/coverage-badges";

beforeEach(() => {
  h.coverages = [
    { clientId: CLIENT, beneficiaryKey: "self", organizationId: "o1", maxSessions: 6, consumedAppointmentIds: ["a", "b", "c"] },
  ];
});

describe("coverageBadgesFor", () => {
  it("gives the kind and the sessions used — no name, no rate", async () => {
    const badges = await coverageBadgesFor([{ _id: "apt1", clientId: { _id: CLIENT }, bookingFor: "self" }]);
    expect(badges.get("apt1")).toEqual({ kind: "eap", used: 3, max: 6 });
    expect(JSON.stringify([...badges.values()])).not.toMatch(/Desjardins|9000/);
  });

  it("matches the person, not just the account: a loved one's session gets no badge from the guardian's coverage", async () => {
    const badges = await coverageBadgesFor([
      { _id: "apt1", clientId: CLIENT, bookingFor: "loved-one", lovedOneInfo: { firstName: "Léo", lastName: "Roy" } },
      { _id: "apt2", clientId: OTHER_CLIENT, bookingFor: "self" },
    ]);
    expect(badges.size).toBe(0);
  });

  it("shows no cap when there is none", async () => {
    h.coverages = [{ ...h.coverages[0], maxSessions: undefined }];
    const badges = await coverageBadgesFor([{ _id: "apt1", clientId: CLIENT }]);
    expect(badges.get("apt1")).toEqual({ kind: "eap", used: 3, max: null });
  });
});
