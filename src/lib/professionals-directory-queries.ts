import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import ShowcasePage from "@/models/ShowcasePage";
import PlatformSettings from "@/models/PlatformSettings";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import {
  buildProfessionalsDirectory,
  buildProfessionalsDirectoryAdminRows,
  type DirectoryAdminRow,
  type DirectoryCurationInput,
  type DirectoryCurationSource,
  type DirectoryLocale,
  type DirectoryPageSource,
  type DirectoryProfessional,
  type DirectoryProfileSource,
} from "@/lib/professionals-directory";

/** Reads and the team's save behind « Nos professionnels ». Only the fields the list may use are loaded. */

type CurationDoc = DirectoryCurationSource & { updatedAt?: Date | null };

async function loadInputs() {
  await connectToDatabase();
  const users = await User.find({ role: "professional", status: "active" }).select("firstName lastName").lean();
  const settings = (await PlatformSettings.findOne().select("professionalsDirectory").lean()) as {
    professionalsDirectory?: CurationDoc | null;
  } | null;
  const curation = settings?.professionalsDirectory ?? null;
  if (users.length === 0) return { users, profiles: [], pages: [], showcaseOn: false, curation };
  const ids = users.map((user) => user._id);
  const [profiles, showcaseOn] = await Promise.all([
    Profile.find({ userId: { $in: ids } })
      .select("userId specialty bio education.degree profileVisible profileCompleted languages modalities yearsOfExperience")
      .lean(),
    isShowcaseEnabled(),
  ]);
  // A page in a city the registry does not know does not render, so it gets no link (as in the sitemap).
  const pages = showcaseOn
    ? (
        (await ShowcasePage.find({ userId: { $in: ids }, status: "published" })
          .select("userId slug cityKey published.displayName published.photoFileId published.headline published.intro published.bio")
          .lean()) as unknown as (DirectoryPageSource & { cityKey: string })[]
      ).filter((page) => isShowcaseCityKey(page.cityKey))
    : [];
  return { users, profiles: profiles as unknown as DirectoryProfileSource[], pages, showcaseOn, curation };
}

/** The rows of the public page. */
export async function loadProfessionalsDirectory(locale: DirectoryLocale): Promise<DirectoryProfessional[]> {
  return buildProfessionalsDirectory({ locale, ...(await loadInputs()) });
}

/** The team's screen: every active professional in the public order, and the version it was saved at. */
export async function loadProfessionalsDirectoryAdmin(): Promise<{ rows: DirectoryAdminRow[]; updatedAt: string | null }> {
  const inputs = await loadInputs();
  const updatedAt = inputs.curation?.updatedAt ? new Date(inputs.curation.updatedAt).toISOString() : null;
  return { rows: buildProfessionalsDirectoryAdminRows({ locale: "fr", ...inputs }), updatedAt };
}

export type DirectoryCurationSaveResult =
  | { ok: true; updatedAt: string }
  /** Someone saved since this screen loaded. */
  | { ok: false; code: "CHANGED" }
  | { ok: false; code: "SETTINGS_MISSING" };

/**
 * The team's order and hidden list, replaced whole. Ids that are not active professionals are dropped,
 * so a departed professional does not linger. A save made on an older version changes nothing.
 */
export async function saveProfessionalsDirectoryCuration(
  input: DirectoryCurationInput & { adminId: string; now?: Date },
): Promise<DirectoryCurationSaveResult> {
  const now = input.now ?? new Date();
  await connectToDatabase();
  const mentioned = [...new Set([...input.order, ...input.hidden])];
  const active = mentioned.length
    ? await User.find({ _id: { $in: mentioned }, role: "professional", status: "active" }).select("_id").lean()
    : [];
  const keep = new Set(active.map((user) => String(user._id)));
  const toIds = (ids: string[]) => ids.filter((id) => keep.has(id)).map((id) => new mongoose.Types.ObjectId(id));

  const res = await PlatformSettings.updateOne(
    input.expectedUpdatedAt
      ? { "professionalsDirectory.updatedAt": new Date(input.expectedUpdatedAt) }
      : { "professionalsDirectory.updatedAt": { $exists: false } },
    {
      $set: {
        professionalsDirectory: {
          order: toIds(input.order),
          hidden: toIds(input.hidden),
          updatedAt: now,
          ...(mongoose.Types.ObjectId.isValid(input.adminId) ? { updatedBy: new mongoose.Types.ObjectId(input.adminId) } : {}),
        },
      },
    },
  );
  if (res.matchedCount === 1) return { ok: true, updatedAt: now.toISOString() };
  return (await PlatformSettings.exists({})) ? { ok: false, code: "CHANGED" } : { ok: false, code: "SETTINGS_MISSING" };
}
