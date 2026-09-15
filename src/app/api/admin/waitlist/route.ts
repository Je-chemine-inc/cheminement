import { NextRequest, NextResponse } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import { listAdminWaitlist, type AdminWaitlistScope } from "@/lib/waitlist-entries";

/**
 * GET /api/admin/waitlist?scope=open|closed|all — every professional's waitlist
 * (spec 003 phase 4), newest first, 500 at most. Gated like the showcase
 * pages (`manageProfessionals`); the email and phone of the people waiting
 * are shown only to an admin who also has `managePatients`.
 */
const SCOPES: AdminWaitlistScope[] = ["open", "closed", "all"];

export async function GET(req: NextRequest) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const scopeParam = req.nextUrl.searchParams.get("scope") ?? "open";
  if (!(SCOPES as string[]).includes(scopeParam)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }
  try {
    const permissions = await getActiveAdminPermissions(gate.session.user.id);
    const showContact = permissions?.managePatients === true;
    const entries = await listAdminWaitlist({ scope: scopeParam as AdminWaitlistScope, showContact });
    return NextResponse.json({ entries, showContact }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[waitlist] admin list failed:", error);
    return NextResponse.json({ error: "Failed to load the waitlists" }, { status: 500 });
  }
}
