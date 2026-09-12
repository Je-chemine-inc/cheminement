import { NextRequest, NextResponse } from "next/server";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { loadShowcaseEditor, saveShowcaseDraft } from "@/lib/showcase-service";

/**
 * The signed-in professional's showcase page (spec 003): what the editor
 * shows, and saving the draft. The page exists only once an admin invites the
 * professional; before that the answer is `{ invited: false }`.
 */
export async function GET() {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const view = await loadShowcaseEditor(gate.userId);
  return NextResponse.json(view ? { invited: true, ...view } : { invited: false });
}

export async function PUT(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const body = await req.json().catch(() => null);
  const result = await saveShowcaseDraft({ userId: gate.userId, body, actor: "professional" });
  return respondShowcase(result, async () => ({
    invited: true,
    ...(await loadShowcaseEditor(gate.userId)),
  }));
}
