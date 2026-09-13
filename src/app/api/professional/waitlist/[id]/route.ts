import { NextResponse, after } from "next/server";
import { requireShowcaseProfessional } from "@/lib/showcase-http";
import { removeWaitlistEntry } from "@/lib/waitlist-entries";
import { afterSlotFreed } from "@/lib/waitlist-slot-freed";

/**
 * DELETE /api/professional/waitlist/<id> — the professional takes someone off
 * their own waitlist (spec 003 phase 4). The person is emailed. 404 for an
 * entry that is not open on this professional's list, or while the person is
 * booking an offered time.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  try {
    const { id } = await params;
    const result = await removeWaitlistEntry({ entryId: id, by: "professional", professionalId: gate.userId });
    if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.freedTime) after(() => afterSlotFreed(result.professionalId));
    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error("[waitlist] professional removal failed:", error);
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
