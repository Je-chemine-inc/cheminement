import { NextRequest } from "next/server";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { loadShowcaseEditor, submitShowcase } from "@/lib/showcase-service";

/**
 * The professional sends their page for review, accepting the current consent
 * text. Refused while a review is pending (409), when the consent is not the
 * current version (400) and when the page is incomplete (422 with `missing`).
 */
export async function POST(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => null)) as {
    consent?: unknown;
    consentVersion?: unknown;
  } | null;
  const result = await submitShowcase({
    userId: gate.userId,
    consent: body?.consent,
    consentVersion: body?.consentVersion,
  });
  return respondShowcase(result, async () => ({
    invited: true,
    ...(await loadShowcaseEditor(gate.userId)),
  }));
}
