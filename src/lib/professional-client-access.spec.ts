import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Appointment model the helper dynamically imports.
const h = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock("@/models/Appointment", () => ({ default: { findOne: h.findOne } }));

import { professionalCanAccessClient } from "@/lib/professional-client-access";

// The helper calls Appointment.findOne(filter).select("_id").
function mockFindOne(result: unknown) {
  h.findOne.mockReturnValue({ select: () => Promise.resolve(result) });
}

describe("professionalCanAccessClient", () => {
  beforeEach(() => h.findOne.mockReset());

  it("returns true when a linking appointment exists", async () => {
    mockFindOne({ _id: "apt1" });
    expect(await professionalCanAccessClient("pro1", "cli1")).toBe(true);
  });

  it("returns false when no link exists", async () => {
    mockFindOne(null);
    expect(await professionalCanAccessClient("pro1", "cli1")).toBe(false);
  });

  it("grants access for assigned, proposed, AND general-pool links", async () => {
    mockFindOne(null);
    await professionalCanAccessClient("pro1", "cli1");
    const filter = h.findOne.mock.calls[0][0] as {
      clientId: string;
      status: { $in: string[] };
      $or: unknown[];
    };
    expect(filter.clientId).toBe("cli1");
    // Pending requests must be reachable (a proposed request is "pending").
    expect(filter.status.$in).toContain("pending");
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { professionalId: "pro1" },
        { proposedTo: "pro1", routingStatus: "proposed" },
        { routingStatus: { $in: ["general", "refused"] } },
      ]),
    );
  });
});
