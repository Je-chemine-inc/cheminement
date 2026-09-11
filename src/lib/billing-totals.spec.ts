import { describe, it, expect } from "vitest";
import {
  isLedgerCreditCleared,
  sessionBilledTotalCents,
  SESSION_BILLED_TOTAL_EXPR,
} from "@/lib/billing-totals";

/**
 * Spec 002 — reports must count the organization's share. `payment.price` is
 * only the client's: 0 $ on a fully covered session.
 */

/** Evaluates the tiny subset of Mongo expressions the constant uses. */
function evalExpr(expr: unknown, doc: Record<string, unknown>): number | null {
  if (typeof expr === "number") return expr;
  if (typeof expr === "string" && expr.startsWith("$")) {
    const v = expr
      .slice(1)
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], doc);
    return v == null ? null : Number(v);
  }
  const op = expr as Record<string, unknown[]>;
  if ("$add" in op) return op.$add.reduce<number>((s, e) => s + (evalExpr(e, doc) ?? 0), 0);
  if ("$divide" in op) return (evalExpr(op.$divide[0], doc) ?? 0) / (evalExpr(op.$divide[1], doc) ?? 1);
  if ("$ifNull" in op) return evalExpr(op.$ifNull[0], doc) ?? evalExpr(op.$ifNull[1], doc);
  throw new Error(`unsupported ${JSON.stringify(expr)}`);
}

const fixtures: Array<[string, Record<string, unknown>, number]> = [
  ["a client-paid session (no snapshot)", { payment: { price: 120 } }, 12000],
  ["fully covered", { payment: { price: 0 }, thirdPartyBilling: { orgAmountCents: 12000 } }, 12000],
  ["co-pay", { payment: { price: 30 }, thirdPartyBilling: { orgAmountCents: 9000 } }, 12000],
  ["org rate above the price", { payment: { price: 0 }, thirdPartyBilling: { orgAmountCents: 14000 } }, 14000],
  ["external (counted once)", { payment: { price: 120 }, thirdPartyBilling: { orgAmountCents: 0 } }, 12000],
  ["no payment at all", {}, 0],
];

describe("session billed total", () => {
  it.each(fixtures)("%s", (_name, apt, expected) => {
    expect(sessionBilledTotalCents(apt)).toBe(expected);
    // The aggregation expression agrees with the pure function.
    expect(Math.round((evalExpr(SESSION_BILLED_TOTAL_EXPR, apt) ?? 0) * 100)).toBe(expected);
  });
});

describe("isLedgerCreditCleared", () => {
  it("card credits clear at closure; Interac once confirmed", () => {
    expect(isLedgerCreditCleared({ paymentChannel: "stripe" }, null)).toBe(true);
    expect(isLedgerCreditCleared({ paymentChannel: "transfer" }, { payment: { status: "pending" } })).toBe(false);
    expect(isLedgerCreditCleared({ paymentChannel: "transfer" }, { payment: { status: "paid" } })).toBe(true);
  });

  it("an organization credit is a receivable until the organization pays", () => {
    const covered = { payment: { status: "covered" }, thirdPartyBilling: { orgStatus: "unbilled", clientAmountCents: 0 } };
    expect(isLedgerCreditCleared({ paymentChannel: "organization" }, covered)).toBe(false);
    expect(
      isLedgerCreditCleared(
        { paymentChannel: "organization" },
        { ...covered, thirdPartyBilling: { orgStatus: "paid", clientAmountCents: 0 } },
      ),
    ).toBe(true);
  });

  it("a co-pay clears only when both sides have paid", () => {
    const tpb = { orgStatus: "paid", clientAmountCents: 3000 };
    expect(isLedgerCreditCleared({ paymentChannel: "organization" }, { payment: { status: "pending" }, thirdPartyBilling: tpb })).toBe(false);
    expect(isLedgerCreditCleared({ paymentChannel: "organization" }, { payment: { status: "paid" }, thirdPartyBilling: tpb })).toBe(true);
  });

  it("adjustment and manual rows count as recorded", () => {
    expect(isLedgerCreditCleared({ paymentChannel: "none" }, null)).toBe(true);
  });
});
