/**
 * §3: a targeted proposal left unanswered past 48h must advance the cascade
 * EXACTLY like a refusal — atomic claim, +1 cascadeAttempts, lapsed pro into
 * refusedBy, then re-run the matcher (next pro, or the admin queue once the
 * 2 attempts are exhausted). Concurrency-safe: the atomic claim makes a row
 * already handled by a live refusal a no-op.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const find = vi.fn();
  const findOneAndUpdate = vi.fn();
  const route = vi.fn();
  return { find, findOneAndUpdate, route };
});

vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/User", () => ({ default: {} }));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: h.find,
    findOneAndUpdate: h.findOneAndUpdate,
  },
}));
vi.mock("@/lib/appointment-routing", () => ({
  routeAppointmentToProfessionals: h.route,
}));

import {
  runProposalTimeouts,
  PROPOSAL_TIMEOUT_HOURS,
} from "@/lib/proposal-timeout";

// Appointment.find(...).select(...).limit(...) → resolves to the rows array.
const makeFindResult = (rows: unknown[]) => ({
  select() {
    return this;
  },
  limit() {
    return Promise.resolve(rows);
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.route.mockResolvedValue({
    success: true,
    matches: [],
    routingStatus: "proposed",
  });
});

describe("runProposalTimeouts", () => {
  it("uses a 48h window", () => {
    expect(PROPOSAL_TIMEOUT_HOURS).toBe(48);
  });

  it("queries only proposed + pending rows past the cutoff (proposedAt or legacy createdAt)", async () => {
    h.find.mockReturnValue(makeFindResult([]));
    const res = await runProposalTimeouts();
    expect(res.timedOut).toBe(0);
    const query = h.find.mock.calls[0][0] as Record<string, unknown>;
    expect(query.routingStatus).toBe("proposed");
    expect(query.status).toBe("pending");
    expect(Array.isArray(query.$or)).toBe(true);
  });

  it("claims each timed-out proposal like a refusal and re-runs the matcher", async () => {
    h.find.mockReturnValue(
      makeFindResult([
        { _id: "id1", proposedTo: ["proA"] },
        { _id: "id2", proposedTo: ["proB"] },
      ]),
    );
    h.findOneAndUpdate.mockResolvedValue({ _id: "claimed" }); // we win the claim

    const res = await runProposalTimeouts();

    expect(res.timedOut).toBe(2);
    expect(h.findOneAndUpdate).toHaveBeenCalledTimes(2);

    const [filter, update] = h.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    // Guarded on still being "proposed" so a racing refusal can't double-count.
    expect(filter.routingStatus).toBe("proposed");
    expect(filter.status).toBe("pending");
    // Same transition as the refuse re-route.
    expect(update.$set).toEqual({ routingStatus: "pending" });
    expect(update.$inc).toEqual({ cascadeAttempts: 1 });
    expect(update.$unset).toHaveProperty("proposedTo");
    expect(update.$unset).toHaveProperty("proposedAt");
    expect(
      (update.$addToSet as { refusedBy: { $each: string[] } }).refusedBy.$each,
    ).toEqual(["proA"]);

    expect(h.route).toHaveBeenCalledWith("id1");
    expect(h.route).toHaveBeenCalledWith("id2");
  });

  it("skips a row already advanced by a concurrent refusal (claim returns null)", async () => {
    h.find.mockReturnValue(makeFindResult([{ _id: "id1", proposedTo: ["proA"] }]));
    h.findOneAndUpdate.mockResolvedValue(null); // lost the race

    const res = await runProposalTimeouts();

    expect(res.timedOut).toBe(0);
    expect(h.route).not.toHaveBeenCalled();
  });

  it("omits $addToSet when the proposal had no recorded pros", async () => {
    h.find.mockReturnValue(makeFindResult([{ _id: "id1", proposedTo: [] }]));
    h.findOneAndUpdate.mockResolvedValue({ _id: "claimed" });

    await runProposalTimeouts();

    const [, update] = h.findOneAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update.$addToSet).toBeUndefined();
  });
});
