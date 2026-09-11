import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import PlatformSettings from "@/models/PlatformSettings";

/**
 * Public: is organization billing on? The booking funnel only offers "someone
 * else pays for my sessions" while it is (spec 002). Says nothing else.
 */
export async function GET() {
  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne()
      .select("organizationBillingEnabled")
      .lean();
    return NextResponse.json({ enabled: settings?.organizationBillingEnabled === true });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
