import { NextResponse } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { listProfessionalWaitlist } from "@/lib/waitlist-entries";

/**
 * GET /api/professional/waitlist — the people waiting for the signed-in
 * professional, in queue order (spec 003 phase 4): first name and initial,
 * what they asked for, the time currently offered to them. Never their email
 * or phone: a waiting person is not a client yet.
 */
export async function GET() {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  try {
    const entries = await listProfessionalWaitlist(gate.userId);
    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[waitlist] professional list failed:", error);
    return NextResponse.json({ error: "Failed to load the waitlist" }, { status: 500 });
  }
}
