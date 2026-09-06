/**
 * The paywall's authority.
 *
 * Most of these assert a DENIAL. The failure mode that matters is not "a buyer
 * cannot read what they bought" — it is "someone reads what they did not buy".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);

const h = vi.hoisted(() => ({
  ent: { findOne: vi.fn(), updateOne: vi.fn() },
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/models/ResourceEntitlement", () => ({ default: h.ent }));

import { resolveResourceAccess } from "@/lib/resource-access";

const paidRow = (over: Record<string, unknown> = {}) => ({
  _id: "ent1",
  slug: "gerer-son-stress",
  status: "paid",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.getServerSession.mockResolvedValue(null);
  h.ent.findOne.mockResolvedValue(null);
  h.ent.updateOne.mockResolvedValue({ modifiedCount: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("free resources", () => {
  it("are readable by anyone, with no database work at all", async () => {
    const res = await resolveResourceAccess("un-guide-gratuit", { isPremium: false });

    expect(res).toEqual({ granted: true, via: "free" });
    expect(h.ent.findOne).not.toHaveBeenCalled();
    expect(h.getServerSession).not.toHaveBeenCalled();
  });
});

describe("anonymous visitors", () => {
  it("are denied a premium resource", async () => {
    const res = await resolveResourceAccess("gerer-son-stress", { isPremium: true });
    expect(res).toEqual({ granted: false, via: null });
  });

  it("are denied when they present no token", async () => {
    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: null,
    });
    expect(res.granted).toBe(false);
  });
});

describe("guest access tokens", () => {
  it("unlock the resource they were bought for", async () => {
    h.ent.findOne.mockResolvedValue(paidRow());

    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: TOKEN,
    });

    expect(res.granted).toBe(true);
    expect(res.via).toBe("token");
  });

  it("are always scoped to the slug", async () => {
    // Without `slug` in the query, one purchase would open the whole catalogue.
    h.ent.findOne.mockResolvedValue(paidRow());

    await resolveResourceAccess("gerer-son-stress", { isPremium: true, token: TOKEN });

    expect(h.ent.findOne).toHaveBeenCalledWith({
      slug: "gerer-son-stress",
      accessToken: TOKEN,
      status: "paid",
    });
  });

  it("cannot open a different resource", async () => {
    // Mongo returns nothing because the slug does not match the token's row.
    h.ent.findOne.mockResolvedValue(null);

    const res = await resolveResourceAccess("une-autre-ressource", {
      isPremium: true,
      token: OTHER_TOKEN,
    });

    expect(res.granted).toBe(false);
  });

  it("are rejected when malformed, without hitting the database", async () => {
    for (const bad of ["", "abc", "../../etc", "z".repeat(64), TOKEN.toUpperCase()]) {
      h.ent.findOne.mockClear();
      const res = await resolveResourceAccess("gerer-son-stress", {
        isPremium: true,
        token: bad,
      });
      expect(res.granted).toBe(false);
      expect(h.ent.findOne).not.toHaveBeenCalled();
    }
  });

  it("stop working once the purchase is refunded", async () => {
    // The status filter does the work: a refunded row simply is not found.
    h.ent.findOne.mockResolvedValue(null);

    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: TOKEN,
    });

    expect(res.granted).toBe(false);
    expect(h.ent.findOne.mock.calls[0][0]).toMatchObject({ status: "paid" });
  });

  it("respect an expiry when one is set", async () => {
    h.ent.findOne.mockResolvedValue(
      paidRow({ accessTokenExpiry: new Date(Date.now() - 1000) }),
    );

    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: TOKEN,
    });

    expect(res.granted).toBe(false);
  });

  it("work forever when no expiry is set", async () => {
    // A bought good does not expire — this is the normal case.
    h.ent.findOne.mockResolvedValue(paidRow({ accessTokenExpiry: undefined }));

    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: TOKEN,
    });

    expect(res.granted).toBe(true);
  });
});

describe("signed-in members", () => {
  const session = { user: { id: "user1", email: "Acheteur@Example.com" } };

  it("read what they bought", async () => {
    h.getServerSession.mockResolvedValue(session);
    h.ent.findOne.mockResolvedValue(paidRow());

    const res = await resolveResourceAccess("gerer-son-stress", { isPremium: true });

    expect(res.granted).toBe(true);
    expect(res.via).toBe("member");
  });

  it("are matched by user id or by the email they bought as", async () => {
    // The email arm is what carries a guest purchase into a later account,
    // before the merge job has run.
    h.getServerSession.mockResolvedValue(session);
    h.ent.findOne.mockResolvedValue(paidRow());

    await resolveResourceAccess("gerer-son-stress", { isPremium: true });

    const query = h.ent.findOne.mock.calls[0][0] as {
      $or: Record<string, unknown>[];
      status: string;
    };
    expect(query.status).toBe("paid");
    expect(query.$or).toContainEqual({ userId: "user1" });
    expect(query.$or).toContainEqual({ buyerEmail: "acheteur@example.com" });
  });

  it("are denied a resource they never bought", async () => {
    // A session is not an entitlement.
    h.getServerSession.mockResolvedValue(session);
    h.ent.findOne.mockResolvedValue(null);

    const res = await resolveResourceAccess("gerer-son-stress", { isPremium: true });

    expect(res.granted).toBe(false);
    expect(res.via).toBeNull();
  });

  it("can still fall back to a token they were emailed", async () => {
    h.getServerSession.mockResolvedValue(session);
    h.ent.findOne
      .mockResolvedValueOnce(null) // no member-owned row
      .mockResolvedValueOnce(paidRow()); // but the token matches

    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: TOKEN,
    });

    expect(res.granted).toBe(true);
    expect(res.via).toBe("token");
  });
});

describe("access telemetry", () => {
  it("records a granted read", async () => {
    h.ent.findOne.mockResolvedValue(paidRow());

    await resolveResourceAccess("gerer-son-stress", { isPremium: true, token: TOKEN });

    const [filter, update] = h.ent.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "ent1" });
    expect((update as { $inc: Record<string, number> }).$inc.accessCount).toBe(1);
  });

  it("never blocks a paying reader when the write fails", async () => {
    h.ent.findOne.mockResolvedValue(paidRow());
    h.ent.updateOne.mockRejectedValue(new Error("mongo down"));

    const res = await resolveResourceAccess("gerer-son-stress", {
      isPremium: true,
      token: TOKEN,
    });

    expect(res.granted).toBe(true);
  });

  it("records nothing for a denied read", async () => {
    await resolveResourceAccess("gerer-son-stress", { isPremium: true });
    expect(h.ent.updateOne).not.toHaveBeenCalled();
  });
});
