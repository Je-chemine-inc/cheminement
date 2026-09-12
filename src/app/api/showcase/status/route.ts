import { NextResponse } from "next/server";
import { isShowcaseEnabled } from "@/lib/showcase-settings";

/**
 * Public: is the showcase module on? The booking funnel only honours a
 * "book this professional" link while it is (spec 003). Says nothing else.
 */
export async function GET() {
  return NextResponse.json(
    { enabled: await isShowcaseEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
