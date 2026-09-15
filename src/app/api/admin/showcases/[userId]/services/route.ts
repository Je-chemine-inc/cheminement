import { NextRequest } from "next/server";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";
import { respondShowcase } from "@/lib/showcase-http";
import { updateShowcaseServices } from "@/lib/showcase-service";

/** Which consultations a professional's page offers, set by an admin. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const result = await updateShowcaseServices({ userId, body });
  return respondShowcase(result, (services) => ({ services }));
}
