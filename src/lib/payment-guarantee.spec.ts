/**
 * Saving a card links it onto the client's open sessions — and now also puts
 * those sessions on the card's rails. An Interac client's sessions are stored
 * as "transfer", and closure bills a "transfer" session by Interac whatever
 * card it carries, so a client who then gave us a card would never have been
 * charged on it. A PAD charged as a card is refused by Stripe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  updateMany: vi.fn(),
  userUpdate: vi.fn(),
  customerUpdate: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ stripe: { customers: { update: h.customerUpdate } } }));
vi.mock("@/models/User", () => ({ default: { findByIdAndUpdate: h.userUpdate } }));
vi.mock("@/models/Appointment", () => ({ default: { updateMany: h.updateMany } }));
vi.mock("@/lib/field-encryption", () => ({
  encryptPaymentMethodReference: (id: string) => `enc:${id}`,
}));

import {
  linkPaymentMethodToOpenAppointments,
  markClientPaymentGuaranteeGreen,
} from "@/lib/payment-guarantee";

type Filter = Record<string, unknown>;
const call = (i: number) => h.updateMany.mock.calls[i] as [Filter, { $set: Record<string, unknown> }];

beforeEach(() => {
  vi.clearAllMocks();
  h.updateMany.mockResolvedValue({ modifiedCount: 2 });
});

describe("linkPaymentMethodToOpenAppointments", () => {
  it("first moves the open sessions onto the card, then links it", async () => {
    const linked = await linkPaymentMethodToOpenAppointments("u1", "pm_1");

    expect(linked).toBe(2);
    expect(h.updateMany).toHaveBeenCalledTimes(2);
    const [railsFilter, railsUpdate] = call(0);
    expect(railsUpdate).toEqual({ $set: { "payment.method": "card" } });
    const [linkFilter, linkUpdate] = call(1);
    expect(linkUpdate).toEqual({ $set: { "payment.stripePaymentMethodId": "enc:pm_1" } });
    // Both touch only the client's open, unsettled sessions with no card yet.
    for (const f of [railsFilter, linkFilter]) {
      expect(f).toMatchObject({
        clientId: "u1",
        status: { $in: ["pending", "scheduled", "ongoing"] },
      });
      expect((f["payment.status"] as { $nin: string[] }).$nin).toEqual(
        expect.arrayContaining(["paid", "processing", "cancelled", "covered"]),
      );
    }
    expect(JSON.stringify(railsFilter)).toContain("payment.stripePaymentMethodId");
    expect(linkFilter.$or).toEqual([
      { "payment.stripePaymentMethodId": { $exists: false } },
      { "payment.stripePaymentMethodId": null },
      { "payment.stripePaymentMethodId": "" },
    ]);
  });

  it("moves Interac sessions only when the client was never sent Interac instructions for them", async () => {
    await linkPaymentMethodToOpenAppointments("u1", "pm_1");

    const [railsFilter] = call(0);
    const which = ((railsFilter.$and as Filter[])[1].$or as Filter[]);
    expect(which).toContainEqual({ "payment.method": { $in: ["card", "direct_debit"] } });
    const transfer = which.find((w) => w["payment.method"] === "transfer");
    // An Interac reference means instructions went out: money may be on its way.
    expect(transfer).toEqual({
      "payment.method": "transfer",
      $or: [
        { "payment.interacReferenceCode": { $exists: false } },
        { "payment.interacReferenceCode": null },
        { "payment.interacReferenceCode": "" },
      ],
    });
  });

  it("puts sessions on a PAD's own rails", async () => {
    await linkPaymentMethodToOpenAppointments("u1", "pm_pad", "direct_debit");
    expect(call(0)[1]).toEqual({ $set: { "payment.method": "direct_debit" } });
  });

  it("never fails the card save when the sessions cannot be updated", async () => {
    h.updateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(linkPaymentMethodToOpenAppointments("u1", "pm_1")).resolves.toBe(0);
  });
});

describe("markClientPaymentGuaranteeGreen", () => {
  it("links a saved card on card rails", async () => {
    await markClientPaymentGuaranteeGreen("u1", "cus_1", "pm_1", false, "card");
    expect(call(0)[1]).toEqual({ $set: { "payment.method": "card" } });
    expect(h.userUpdate).toHaveBeenCalledWith("u1", expect.objectContaining({ preferredPaymentMethod: "card" }));
  });

  it("links a saved PAD on bank-debit rails", async () => {
    await markClientPaymentGuaranteeGreen("u1", "cus_1", "pm_pad", false, "acss_debit");
    expect(call(0)[1]).toEqual({ $set: { "payment.method": "direct_debit" } });
  });
});
