import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { loadShowcaseEditor, unpublishShowcase } from "@/lib/showcase-service";

/**
 * The professional takes their page off the site. It stays down until they
 * put it back or send it for review again; an admin cannot republish it over
 * their decision.
 */
export async function POST() {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const result = await unpublishShowcase({
    userId: gate.userId,
    actor: "professional",
    byUserId: gate.userId,
  });
  return respondShowcase(result, async () => ({
    invited: true,
    ...(await loadShowcaseEditor(gate.userId)),
  }));
}
