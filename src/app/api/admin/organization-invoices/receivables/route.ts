import { NextRequest, NextResponse } from "next/server";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { agingCsv, loadOrganizationReceivables } from "@/lib/organization-receivables";

/**
 * GET /api/admin/organization-invoices/receivables — what organizations owe
 * by age, and what in organization billing needs a person (spec 002, phase 6).
 * `?format=csv` returns the aging table for the accountant.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const data = await loadOrganizationReceivables(new Date());
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const csv = agingCsv(data.aging.rows, data.aging.totals, (id) => data.organizations[id] ?? id);
      const day = data.generatedAt.toISOString().slice(0, 10);
      return new NextResponse(`﻿${csv}\n`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="comptes-a-recevoir-organismes-${day}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Organization receivables error:", error);
    return NextResponse.json({ error: "Failed to load receivables" }, { status: 500 });
  }
}
