import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { renderInvoicePdf } from "@/lib/organization-invoice";

/**
 * GET /api/admin/organization-invoices/[id]/pdf — the PDF an organization
 * received (or will receive, for a draft: marked "BROUILLON" by its missing
 * number). Billing admins only — it names patients.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const inv = await OrganizationInvoice.findById(id).lean();
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const org = await Organization.findById(inv.organizationId)
    .select("name language contactName address billingEmails")
    .lean();
  const language = org?.language === "en" ? "en" : "fr";
  const pdf = await renderInvoicePdf(
    {
      ...inv,
      number: inv.number ?? (language === "fr" ? "BROUILLON" : "DRAFT"),
      billTo: inv.billTo?.name ? inv.billTo : { name: org?.name ?? "", emails: [], contactName: org?.contactName },
    },
    language,
  );
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${inv.number ?? "brouillon"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
