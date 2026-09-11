import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 — the "one covered session left" and "used up" notices go out once:
 * claimed on the coverage before sending, given back if nobody could be told.
 */

const h = vi.hoisted(() => ({
  coverage: null as Record<string, unknown> | null,
  claimModified: 1,
  updateOne: vi.fn(),
  clientEmail: vi.fn(async () => true),
  adminEmail: vi.fn(async () => true),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/OrganizationCoverage", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => h.coverage }) }),
    updateOne: h.updateOne,
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => ({ name: "PAE Desjardins" }) }) }) },
}));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => ({
      select: () => ({ lean: async () => ({ firstName: "Léa", lastName: "Roy", email: "lea@x.ca", language: "fr" }) }),
    }),
  },
}));
vi.mock("@/models/Appointment", () => ({ default: {} }));
vi.mock("@/lib/notifications", () => ({
  sendClientCoverageCapEmail: h.clientEmail,
  sendAdminCoverageCapWarning: h.adminEmail,
  sendClientCoverageConfirmedEmail: vi.fn(async () => true),
}));

import { notifyCoverageCap } from "@/lib/coverage-notices";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

beforeEach(() => {
  h.coverage = { _id: "cov", clientId: "c1", organizationId: "o1", maxSessions: 6, consumedAppointmentIds: ids(5) };
  h.claimModified = 1;
  h.updateOne.mockReset();
  h.updateOne.mockImplementation(async () => ({ modifiedCount: h.claimModified }));
  h.clientEmail.mockReset();
  h.clientEmail.mockResolvedValue(true);
  h.adminEmail.mockReset();
  h.adminEmail.mockResolvedValue(true);
});

describe("notifyCoverageCap", () => {
  it("at one session left: claims the stamp, tells the client and the team", async () => {
    const r = await notifyCoverageCap("cov");
    expect(r).toEqual({ lastSession: true, exhausted: false });
    const [filter, update] = h.updateOne.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(filter).toMatchObject({ lastSessionWarningSentAt: { $exists: false } });
    expect(update.$set).toHaveProperty("lastSessionWarningSentAt");
    expect(h.clientEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "last_session", used: 5, max: 6, clientEmail: "lea@x.ca" }),
    );
    expect(h.adminEmail).toHaveBeenCalledTimes(1);
  });

  it("when used up: tells the client only", async () => {
    h.coverage = { ...h.coverage, consumedAppointmentIds: ids(6) };
    const r = await notifyCoverageCap("cov");
    expect(r).toEqual({ lastSession: false, exhausted: true });
    expect(h.updateOne.mock.calls[0][0]).toMatchObject({ exhaustedNotifiedAt: { $exists: false } });
    expect(h.clientEmail).toHaveBeenCalledWith(expect.objectContaining({ kind: "exhausted" }));
    expect(h.adminEmail).not.toHaveBeenCalled();
  });

  it("sends nothing twice: an existing stamp or a lost claim stops it", async () => {
    h.coverage = { ...h.coverage, lastSessionWarningSentAt: new Date() };
    await notifyCoverageCap("cov");
    h.coverage = { ...h.coverage, lastSessionWarningSentAt: undefined };
    h.claimModified = 0;
    await notifyCoverageCap("cov");
    expect(h.clientEmail).not.toHaveBeenCalled();
    expect(h.adminEmail).not.toHaveBeenCalled();
  });

  it("gives the claim back when nobody could be told, so a later pass retries", async () => {
    h.clientEmail.mockResolvedValue(false);
    h.adminEmail.mockResolvedValue(false);
    const r = await notifyCoverageCap("cov");
    expect(r).toEqual({ lastSession: false, exhausted: false });
    expect(h.updateOne.mock.calls[1][1]).toEqual({ $unset: { lastSessionWarningSentAt: 1 } });
  });

  it("stays silent with sessions to spare, or without a cap", async () => {
    h.coverage = { ...h.coverage, consumedAppointmentIds: ids(3) };
    await notifyCoverageCap("cov");
    h.coverage = { ...h.coverage, maxSessions: undefined };
    await notifyCoverageCap("cov");
    expect(h.updateOne).not.toHaveBeenCalled();
    expect(h.clientEmail).not.toHaveBeenCalled();
  });

  it("writes to the person the session emails go to (an adult loved one)", async () => {
    await notifyCoverageCap("cov", { recipient: { email: "leo@x.ca", name: "Léo", language: "en" } });
    expect(h.clientEmail).toHaveBeenCalledWith(
      expect.objectContaining({ clientEmail: "leo@x.ca", clientName: "Léo", locale: "en" }),
    );
  });
});
