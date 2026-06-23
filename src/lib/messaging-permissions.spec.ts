import { describe, it, expect, vi, beforeEach } from "vitest";

const PRO = "cccccccccccccccccccccccc";
const ACTIVE = "aaaaaaaaaaaaaaaaaaaaaaaa"; // active client
const INACTIVE = "bbbbbbbbbbbbbbbbbbbbbbbb"; // deleted/deactivated client

const h = vi.hoisted(() => ({
  apptClientIds: vi.fn(),
  userFind: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    find: () => ({ distinct: () => ({ lean: () => h.apptClientIds() }) }),
    findOne: () => ({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
    }),
  },
}));
vi.mock("@/models/User", () => ({
  default: {
    find: (filter: Record<string, unknown>) => ({
      select: () => ({ lean: () => h.userFind(filter) }),
    }),
  },
}));
vi.mock("@/models/Profile", () => ({
  default: { find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) },
}));

import { getAllowedRecipientIds } from "@/lib/messaging-permissions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAllowedRecipientIds — professional client list", () => {
  it("drops clients who are deleted / no longer active (status !== active)", async () => {
    // The pro has appointments with two clients; only ACTIVE is still active.
    h.apptClientIds.mockResolvedValue([
      { toString: () => ACTIVE },
      { toString: () => INACTIVE },
    ]);
    h.userFind.mockImplementation((filter: Record<string, unknown>) => {
      // Peer-pros / admins queries → none for this test.
      if (filter.role === "professional" || filter.role === "admin") {
        return Promise.resolve([]);
      }
      // The clients query MUST filter on status:"active".
      expect(filter.status).toBe("active");
      return Promise.resolve([{ _id: { toString: () => ACTIVE } }]);
    });

    const allowed = await getAllowedRecipientIds(PRO, "professional");
    expect(allowed.has(ACTIVE)).toBe(true); // active client kept
    expect(allowed.has(INACTIVE)).toBe(false); // inactive/deleted client dropped
  });
});
