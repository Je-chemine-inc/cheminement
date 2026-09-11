import { NextRequest, NextResponse } from "next/server";
import PlatformSettings from "@/models/PlatformSettings";
import { requireBillingAdmin } from "@/lib/organization-admin";

/**
 * The organization-billing switches (spec 002).
 *  - `enabled`: organization billing itself. Off: session closure is exactly
 *    what it was before the feature existed — no coverage is looked up and
 *    every session is billed to the client. On: coverages apply at closure.
 *  - `padEnabled`: organizations may also pay an invoice by pre-authorized
 *    bank debit (DPA) from the pay link. Off by default, for a pilot.
 */
export async function GET() {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  const settings = await PlatformSettings.findOne()
    .select("organizationBillingEnabled organizationPadEnabled")
    .lean();
  return NextResponse.json({
    enabled: settings?.organizationBillingEnabled === true,
    padEnabled: settings?.organizationPadEnabled === true,
  });
}

export async function PUT(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as { enabled?: unknown; padEnabled?: unknown } | null;
  // Each switch given must be a boolean; at least one must be given.
  const valid = (v: unknown) => v === undefined || typeof v === "boolean";
  const set: Record<string, boolean> = {};
  if (typeof body?.enabled === "boolean") set.organizationBillingEnabled = body.enabled;
  if (typeof body?.padEnabled === "boolean") set.organizationPadEnabled = body.padEnabled;
  if (!body || !valid(body.enabled) || !valid(body.padEnabled) || Object.keys(set).length === 0) {
    return NextResponse.json({ error: "enabled / padEnabled must be true or false" }, { status: 400 });
  }
  const res = await PlatformSettings.updateOne({}, { $set: set });
  if (res.matchedCount === 0) {
    return NextResponse.json(
      { error: "Save the platform settings once before turning this on." },
      { status: 409 },
    );
  }
  for (const [key, value] of Object.entries(set)) {
    console.info(
      `[org-billing] ${key === "organizationPadEnabled" ? "bank debit" : "switch"} ${value ? "ON" : "OFF"} by admin ${gate.session.user.id}`,
    );
  }
  const settings = await PlatformSettings.findOne()
    .select("organizationBillingEnabled organizationPadEnabled")
    .lean();
  return NextResponse.json({
    enabled: settings?.organizationBillingEnabled === true,
    padEnabled: settings?.organizationPadEnabled === true,
  });
}
