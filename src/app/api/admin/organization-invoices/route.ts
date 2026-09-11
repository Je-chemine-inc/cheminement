import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import OrganizationInvoice, { ORGANIZATION_INVOICE_STATUSES } from "@/models/OrganizationInvoice";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { isPeriodKey } from "@/lib/organization-invoice-lines";
import {
  draftForSession,
  draftSessionsForOrganization,
  draftStatement,
  unbilledSummary,
} from "@/lib/organization-invoice";
import { serializeInvoice } from "@/lib/organization-invoice-serialize";

/**
 * GET /api/admin/organization-invoices?status=&organizationId= — invoices,
 * newest first, plus what each organization still owes that is not invoiced.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const params = new URL(req.url).searchParams;
    const status = params.get("status");
    const organizationId = params.get("organizationId");
    const query: Record<string, unknown> = {};
    if (status && (ORGANIZATION_INVOICE_STATUSES as readonly string[]).includes(status)) {
      query.status = status;
    } else {
      query.status = { $ne: "void" };
    }
    if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
      query.organizationId = organizationId;
    }
    const [invoices, unbilled, orgs] = await Promise.all([
      OrganizationInvoice.find(query).sort({ createdAt: -1 }).limit(200).lean(),
      unbilledSummary(),
      Organization.find({}).select("name billingCycle active billingEmails requiresOwnForm formNotes").lean(),
    ]);
    const orgById = new Map(orgs.map((o) => [String(o._id), o]));
    return NextResponse.json({
      invoices: invoices.map((i) => serializeInvoice(i, orgById.get(String(i.organizationId)))),
      unbilled: unbilled.map((u) => {
        const o = orgById.get(u.organizationId);
        return {
          ...u,
          organizationName: o?.name ?? "",
          billingCycle: o?.billingCycle ?? "per_session",
          hasBillingEmail: (o?.billingEmails?.length ?? 0) > 0,
          requiresOwnForm: Boolean(o?.requiresOwnForm),
        };
      }),
    });
  } catch (error) {
    console.error("Admin list organization invoices error:", error);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }
}

/**
 * POST /api/admin/organization-invoices — create or rebuild a draft:
 * `{ kind: "session", appointmentId }` or
 * `{ kind: "statement", organizationId, periodKey: "YYYY-MM" }`, or
 * `{ kind: "sessions", organizationId }` — one draft per unbilled session.
 */
export async function POST(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.kind === "sessions" && typeof body.organizationId === "string") {
      const drafted = await draftSessionsForOrganization(body.organizationId);
      if (drafted === 0) {
        return NextResponse.json(
          { error: "Nothing to invoice: no closed, unbilled session for this.", code: "NOTHING_TO_BILL" },
          { status: 409 },
        );
      }
      return NextResponse.json({ drafted }, { status: 201 });
    }
    let result;
    if (body?.kind === "session" && typeof body.appointmentId === "string") {
      result = await draftForSession(body.appointmentId);
    } else if (
      body?.kind === "statement" &&
      typeof body.organizationId === "string" &&
      isPeriodKey(body.periodKey)
    ) {
      result = await draftStatement(body.organizationId, body.periodKey);
    } else {
      return NextResponse.json(
        { error: "kind session + appointmentId, or kind statement + organizationId + periodKey (YYYY-MM)" },
        { status: 400 },
      );
    }
    if (result === null) {
      return NextResponse.json(
        { error: "Nothing to invoice: no closed, unbilled session for this.", code: "NOTHING_TO_BILL" },
        { status: 409 },
      );
    }
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ invoice: serializeInvoice(result.invoice.toObject()) }, { status: 201 });
  } catch (error) {
    console.error("Admin draft organization invoice error:", error);
    return NextResponse.json({ error: "Failed to create the draft" }, { status: 500 });
  }
}
