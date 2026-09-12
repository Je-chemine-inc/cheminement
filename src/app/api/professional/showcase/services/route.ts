import { NextRequest } from "next/server";
import { requireShowcaseProfessional, respondShowcase } from "@/lib/showcase-http";
import { updateShowcaseServices } from "@/lib/showcase-service";

/**
 * Which consultations the page offers (`{ standard?, quick? }`). A live
 * setting: it applies at once, without a new review.
 */
export async function PUT(req: NextRequest) {
  const gate = await requireShowcaseProfessional();
  if (gate.error) return gate.error;
  const body = await req.json().catch(() => null);
  const result = await updateShowcaseServices({ userId: gate.userId, body });
  return respondShowcase(result, (services) => ({ services }));
}
