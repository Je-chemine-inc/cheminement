import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import OrganizationInvoice, { ORGANIZATION_PAYMENT_METHODS } from "@/models/OrganizationInvoice";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { parseDollarsToCents, parseDay } from "@/lib/organization-input";
import {
  issueAndSend,
  recordOrganizationPayment,
  refreshDraft,
  resendInvoice,
  voidInvoice,
  type InvoiceResult,
} from "@/lib/organization-invoice";
import { serializeInvoice } from "@/lib/organization-invoice-serialize";
import { cancelOpenOrganizationPaymentIntent } from "@/lib/organization-invoice-card";
import { checkOrganizationRefund, refundOrganizationPayment } from "@/lib/organization-invoice-refund";
import type { IOrganizationInvoice } from "@/models/OrganizationInvoice";

/** The key the refund dialog mints when it opens: the same click twice refunds once. */
const REQUEST_KEY = /^[A-Za-z0-9_-]{8,64}$/;

type Ctx = { params: Promise<{ id: string }> };

/** What the serializer shows of the organization. */
const ORG_FIELDS = "name requiresOwnForm formNotes";

async function respond(result: InvoiceResult<IOrganizationInvoice | null> | null) {
  if (result === null) {
    return NextResponse.json(
      { error: "Nothing left to invoice: the draft was removed.", code: "NOTHING_TO_BILL" },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, ...(result.details ? { details: result.details } : {}) },
      { status: result.status },
    );
  }
  if (!result.invoice) return NextResponse.json({ invoice: null });
  const inv = "toObject" in result.invoice ? result.invoice.toObject() : result.invoice;
  const org = await Organization.findById(inv.organizationId).select(ORG_FIELDS).lean();
  return NextResponse.json({ invoice: serializeInvoice(inv, org) });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const inv = await OrganizationInvoice.findById(id).lean();
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const org = await Organization.findById(inv.organizationId).select(ORG_FIELDS).lean();
  return NextResponse.json({ invoice: serializeInvoice(inv, org) });
}

/**
 * POST /api/admin/organization-invoices/[id] — one action:
 *  `{ action: "send" }` issue a draft and email it (consent-gated);
 *  `{ action: "resend" }`; both take `withoutOwnForm: true` to send to an
 *  organization that requires its own form without it (recorded);
 *  `{ action: "refresh" }` rebuild a draft;
 *  `{ action: "void", reason }` (a draft is discarded);
 *  `{ action: "pay", amount, method, reference?, receivedOn? }` money received;
 *  `{ action: "refund", paymentId, amount, owed?, reason, requestKey, notify?,
 *     method?, reference?, refundedOn? }` refund a payment — through Stripe for
 *  a card, recorded as made outside for the rest;
 *  `{ action: "refund_check", refundId }` where a Stripe refund stands.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const byUserId = gate.session.user.id;
    // Only an explicit `true`: anything else keeps the form requirement.
    const withoutOwnForm = body?.withoutOwnForm === true;
    switch (body?.action) {
      case "send":
        return respond(await issueAndSend({ invoiceId: id, byUserId, withoutOwnForm }));
      case "resend":
        return respond(await resendInvoice({ invoiceId: id, byUserId, withoutOwnForm }));
      case "refresh":
        return respond(await refreshDraft(id));
      case "void": {
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        const result = await voidInvoice({ invoiceId: id, reason, byUserId });
        // A card payment the organization started must not go through now.
        if (result.ok) await cancelOpenOrganizationPaymentIntent(id);
        return respond(result);
      }
      case "pay": {
        const cents = parseDollarsToCents(body.amount);
        if (!cents || Number.isNaN(cents)) {
          return NextResponse.json({ error: "amount: dollars received" }, { status: 400 });
        }
        const method = body.method;
        if (
          typeof method !== "string" ||
          !(ORGANIZATION_PAYMENT_METHODS as readonly string[]).includes(method) ||
          method === "card"
        ) {
          return NextResponse.json(
            { error: "method: interac, cheque, eft, portal or other" },
            { status: 400 },
          );
        }
        const receivedAt = parseDay(body.receivedOn, "start");
        if (receivedAt && Number.isNaN(receivedAt.getTime())) {
          return NextResponse.json({ error: "receivedOn: YYYY-MM-DD" }, { status: 400 });
        }
        const result = await recordOrganizationPayment({
          invoiceId: id,
          amountCents: cents,
          method: method as IOrganizationInvoice["payments"][number]["method"],
          reference: typeof body.reference === "string" ? body.reference.trim() : undefined,
          receivedAt: receivedAt ?? undefined,
          source: "admin",
          byUserId,
        });
        // The balance moved: a card payment started for the old amount goes.
        if (result.ok) await cancelOpenOrganizationPaymentIntent(id);
        return respond(result);
      }
      case "refund": {
        const cents = parseDollarsToCents(body.amount);
        if (!cents || Number.isNaN(cents)) {
          return NextResponse.json({ error: "amount: dollars to refund", code: "INVALID_AMOUNT" }, { status: 400 });
        }
        if (typeof body.paymentId !== "string" || !mongoose.Types.ObjectId.isValid(body.paymentId)) {
          return NextResponse.json({ error: "paymentId", code: "PAYMENT_NOT_FOUND" }, { status: 400 });
        }
        if (typeof body.requestKey !== "string" || !REQUEST_KEY.test(body.requestKey)) {
          return NextResponse.json({ error: "requestKey" }, { status: 400 });
        }
        const owed = body.owed === "still" || body.owed === "no_longer" ? body.owed : null;
        const refundedAt = parseDay(body.refundedOn, "start");
        if (refundedAt && Number.isNaN(refundedAt.getTime())) {
          return NextResponse.json({ error: "refundedOn: YYYY-MM-DD" }, { status: 400 });
        }
        return respond(
          await refundOrganizationPayment({
            invoiceId: id,
            paymentId: body.paymentId,
            amountCents: cents,
            owed,
            reason: typeof body.reason === "string" ? body.reason : "",
            requestKey: body.requestKey,
            // On unless explicitly unticked.
            notify: body.notify !== false,
            byUserId,
            outside:
              typeof body.method === "string"
                ? {
                    method: body.method,
                    reference: typeof body.reference === "string" ? body.reference : undefined,
                    refundedAt: refundedAt ?? undefined,
                  }
                : null,
          }),
        );
      }
      case "refund_check": {
        if (typeof body.refundId !== "string") {
          return NextResponse.json({ error: "refundId" }, { status: 400 });
        }
        return respond(await checkOrganizationRefund({ invoiceId: id, refundId: body.refundId }));
      }
      default:
        return NextResponse.json(
          { error: "action: send, resend, refresh, void, pay, refund or refund_check" },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Admin organization invoice action error:", error);
    return NextResponse.json({ error: "Failed to update the invoice" }, { status: 500 });
  }
}
