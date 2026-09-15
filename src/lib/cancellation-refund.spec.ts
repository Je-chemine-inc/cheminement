import { describe, expect, it } from "vitest";
import { cancellationRefund } from "@/lib/cancellation-refund";

describe("cancellationRefund", () => {
  it("refunds everything to a client cancelling in time, and always when the professional or the team cancels", () => {
    expect(cancellationRefund({ priceCad: 120, cancelledBy: "client", hoursUntil: 72, freeHours: 48 })).toEqual({ refundCents: 12000, feeCents: 0 });
    expect(cancellationRefund({ priceCad: 120, cancelledBy: "client", hoursUntil: 48, freeHours: 48 })).toEqual({ refundCents: 12000, feeCents: 0 });
    for (const cancelledBy of ["professional", "admin"]) {
      expect(cancellationRefund({ priceCad: 120, cancelledBy, hoursUntil: 2, freeHours: 48 })).toEqual({ refundCents: 12000, feeCents: 0 });
    }
  });

  it("keeps a 15 % fee on a late client cancellation, in whole cents", () => {
    expect(cancellationRefund({ priceCad: 120, cancelledBy: "client", hoursUntil: 47.9, freeHours: 48 })).toEqual({ refundCents: 10200, feeCents: 1800 });
    expect(cancellationRefund({ priceCad: 99.99, cancelledBy: "client", hoursUntil: 1, freeHours: 48 })).toEqual({ refundCents: 8499, feeCents: 1500 });
  });

  it("refunds nothing when nothing was charged", () => {
    expect(cancellationRefund({ priceCad: 0, cancelledBy: "professional", hoursUntil: 72, freeHours: 48 })).toEqual({ refundCents: 0, feeCents: 0 });
    expect(cancellationRefund({ priceCad: Number.NaN, cancelledBy: "client", hoursUntil: 72, freeHours: 48 })).toEqual({ refundCents: 0, feeCents: 0 });
  });
});
