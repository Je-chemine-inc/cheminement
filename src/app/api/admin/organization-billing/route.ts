import { NextRequest, NextResponse } from "next/server";
import PlatformSettings from "@/models/PlatformSettings";
import { requireBillingAdmin } from "@/lib/organization-admin";

/**
 * The organization-billing switch (spec 002). Off: session closure is exactly
 * what it was before the feature existed — no coverage is looked up and every
 * session is billed to the client. On: coverages apply at closure.
 */
export async function GET() {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  const settings = await PlatformSettings.findOne()
    .select("organizationBillingEnabled")
    .lean();
  return NextResponse.json({ enabled: settings?.organizationBillingEnabled === true });
}

export async function PUT(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const res = await PlatformSettings.updateOne(
    {},
    { $set: { organizationBillingEnabled: body.enabled } },
  );
  if (res.matchedCount === 0) {
    return NextResponse.json(
      { error: "Save the platform settings once before turning this on." },
      { status: 409 },
    );
  }
  console.info(
    `[org-billing] switch ${body.enabled ? "ON" : "OFF"} by admin ${gate.session.user.id}`,
  );
  return NextResponse.json({ enabled: body.enabled });
}
