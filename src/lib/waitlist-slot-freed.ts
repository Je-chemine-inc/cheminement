/**
 * Call from after() in any route that frees a professional's future time — a
 * cancelled or moved session, a declined or withdrawn request — so the people
 * on their waitlist are offered it at once (spec 003 phase 4). The waitlist job
 * catches anything missed within two minutes anyway.
 *
 * No module-level import of the offer engine: routes and their specs load this
 * file without pulling in server-only code. Never throws.
 */
export async function afterSlotFreed(professional: unknown): Promise<void> {
  const raw =
    professional && typeof professional === "object" && "_id" in professional
      ? (professional as { _id: unknown })._id
      : professional;
  const professionalId = raw ? String(raw) : "";
  if (!/^[a-f0-9]{24}$/i.test(professionalId)) return;
  try {
    const { notifySlotFreed } = await import("@/lib/waitlist-offers");
    await notifySlotFreed(professionalId);
  } catch (error) {
    console.error("[waitlist] freed time not offered:", professionalId, error);
  }
}
