import { describe, it, expect } from "vitest";
import {
  decideGuestPayment,
  hasClosedLateOrNoShowFee,
} from "@/lib/guest-payment-eligibility";

/**
 * Pins who may pay through the no-login /pay link. The regression: closure
 * emails a pay link for late-cancellation and no-show fees, but those sessions
 * carry status "cancelled" / "no-show", and the link refused both.
 */

const CLOSED = new Date("2026-09-10T15:00:00Z");

describe("decideGuestPayment", () => {
  it("lets a completed session be paid", () => {
    expect(
      decideGuestPayment({ status: "completed", payment: { status: "pending" } }),
    ).toEqual({ payable: true });
  });

  it("lets a closed NO-SHOW fee be paid (the link used to refuse it)", () => {
    expect(
      decideGuestPayment({
        status: "no-show",
        sessionCompletedAt: CLOSED,
        sessionOutcome: "no_show",
        payment: { status: "pending" },
      }),
    ).toEqual({ payable: true });
  });

  it("lets a closed LATE-CANCELLATION fee be paid (the link used to refuse it)", () => {
    expect(
      decideGuestPayment({
        status: "cancelled",
        sessionCompletedAt: CLOSED,
        sessionOutcome: "cancelled_late",
        payment: { status: "overdue" },
      }),
    ).toEqual({ payable: true });
  });

  it("still refuses a free cancellation (48 h or more ahead)", () => {
    expect(
      decideGuestPayment({
        status: "cancelled",
        sessionCompletedAt: CLOSED,
        sessionOutcome: "cancelled_48h_plus",
        payment: { status: "cancelled" },
      }),
    ).toEqual({ payable: false, code: "NOT_AVAILABLE" });
  });

  it("refuses a cancellation nobody closed as a fee", () => {
    expect(
      decideGuestPayment({ status: "cancelled", payment: { status: "pending" } }),
    ).toEqual({ payable: false, code: "NOT_AVAILABLE" });
    expect(
      decideGuestPayment({ status: "no-show", payment: { status: "pending" } }),
    ).toEqual({ payable: false, code: "NOT_AVAILABLE" });
  });

  it("refuses paying twice", () => {
    expect(
      decideGuestPayment({ status: "completed", payment: { status: "paid" } }),
    ).toEqual({ payable: false, code: "ALREADY_PAID" });
  });

  it("refuses while a payment is genuinely in flight", () => {
    expect(
      decideGuestPayment({
        status: "completed",
        payment: { status: "processing" },
      }),
    ).toEqual({ payable: false, code: "PAYMENT_IN_PROGRESS" });
  });

  it("refuses refunded sessions", () => {
    for (const status of ["refunded", "partially_refunded"]) {
      expect(
        decideGuestPayment({ status: "completed", payment: { status } }),
      ).toEqual({ payable: false, code: "NOT_AVAILABLE" });
    }
  });

  it("keeps the unconfirmed and not-yet-held cases as before", () => {
    expect(
      decideGuestPayment({ status: "pending", payment: { status: "pending" } }),
    ).toEqual({ payable: false, code: "NOT_CONFIRMED" });
    expect(
      decideGuestPayment({ status: "scheduled", payment: { status: "pending" } }),
    ).toEqual({ payable: false, code: "NOT_YET_COMPLETED" });
  });

  it("lets a failed or overdue payment be retried", () => {
    for (const status of ["failed", "overdue", "pending"]) {
      expect(
        decideGuestPayment({ status: "completed", payment: { status } }),
      ).toEqual({ payable: true });
    }
  });
});

describe("hasClosedLateOrNoShowFee", () => {
  it("needs both a closure and a late/no-show outcome", () => {
    expect(
      hasClosedLateOrNoShowFee({ sessionCompletedAt: CLOSED, sessionOutcome: "no_show" }),
    ).toBe(true);
    expect(hasClosedLateOrNoShowFee({ sessionOutcome: "no_show" })).toBe(false);
    expect(
      hasClosedLateOrNoShowFee({ sessionCompletedAt: CLOSED, sessionOutcome: "completed" }),
    ).toBe(false);
  });
});
