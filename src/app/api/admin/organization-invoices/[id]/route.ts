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
import type { IOrganizationInvoice } from "@/models/OrganizationInvoice";

type Ctx = { params: Promise<{ id: string }> };

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
  const org = await Organization.findById(inv.organizationId).select("name").lean();
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
  const org = await Organization.findById(inv.organizationId).select("name").lean();
  return NextResponse.json({ invoice: serializeInvoice(inv, org) });
}

/**
 * POST /api/admin/organization-invoices/[id] — one action:
 *  `{ action: "send" }` issue a draft and email it (consent-gated);
 *  `{ action: "resend" }`; `{ action: "refresh" }` rebuild a draft;
 *  `{ action: "void", reason }` (a draft is discarded);
 *  `{ action: "pay", amount, method, reference?, receivedOn? }` money received.
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
    switch (body?.action) {
      case "send":
        return respond(await issueAndSend({ invoiceId: id, byUserId }));
      case "resend":
        return respond(await resendInvoice({ invoiceId: id, byUserId }));
      case "refresh":
        return respond(await refreshDraft(id));
      case "void": {
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        return respond(await voidInvoice({ invoiceId: id, reason, byUserId }));
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
        return respond(
          await recordOrganizationPayment({
            invoiceId: id,
            amountCents: cents,
            method: method as IOrganizationInvoice["payments"][number]["method"],
            reference: typeof body.reference === "string" ? body.reference.trim() : undefined,
            receivedAt: receivedAt ?? undefined,
            source: "admin",
            byUserId,
          }),
        );
      }
      default:
        return NextResponse.json(
          { error: "action: send, resend, refresh, void or pay" },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Admin organization invoice action error:", error);
    return NextResponse.json({ error: "Failed to update the invoice" }, { status: 500 });
  }
}
