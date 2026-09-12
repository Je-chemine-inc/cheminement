import { NextRequest, NextResponse } from "next/server";
import PlatformSettings from "@/models/PlatformSettings";
import { requireProfessionalsAdmin } from "@/lib/professional-admin";

/**
 * The showcase switch (spec 003). Off: every psy<city>.jechemine.ca host sends
 * its visitors to www, no showcase API answers, and the booking funnel ignores
 * "book this professional" links. On: published pages go live.
 */
export async function GET() {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;
  const settings = await PlatformSettings.findOne().select("showcaseEnabled").lean();
  return NextResponse.json({ enabled: settings?.showcaseEnabled === true });
}

export async function PUT(req: NextRequest) {
  const gate = await requireProfessionalsAdmin();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const res = await PlatformSettings.updateOne({}, { $set: { showcaseEnabled: body.enabled } });
  if (res.matchedCount === 0) {
    return NextResponse.json(
      { error: "Save the platform settings once before turning this on." },
      { status: 409 },
    );
  }
  console.info(`[showcase] switch ${body.enabled ? "ON" : "OFF"} by admin ${gate.session.user.id}`);
  const settings = await PlatformSettings.findOne().select("showcaseEnabled").lean();
  return NextResponse.json({ enabled: settings?.showcaseEnabled === true });
}
