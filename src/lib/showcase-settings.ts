import connectToDatabase from "@/lib/mongodb";
import PlatformSettings from "@/models/PlatformSettings";

/**
 * Is the showcase module on (spec 003)? Only `true` counts: a field never set,
 * a missing settings document or a database error all read as off, so the
 * city hosts fail closed to www rather than half-render.
 */
export async function isShowcaseEnabled(): Promise<boolean> {
  try {
    await connectToDatabase();
    const settings = await PlatformSettings.findOne().select("showcaseEnabled").lean();
    return settings?.showcaseEnabled === true;
  } catch (error) {
    console.error("[showcase] could not read the switch:", error);
    return false;
  }
}
