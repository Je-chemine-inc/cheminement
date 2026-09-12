import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { loadShowcaseEditor, republishShowcase } from "@/lib/showcase-service";

/**
 * The professional puts back the page they took down themselves: the version
 * an admin last approved. A page an admin took down is refused.
 */
export async function POST() {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const result = await republishShowcase({
    userId: gate.userId,
    actor: "professional",
    byUserId: gate.userId,
  });
  return respondShowcase(result, async () => ({
    invited: true,
    ...(await loadShowcaseEditor(gate.userId)),
  }));
}
