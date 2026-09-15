import "server-only";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import ShowcasePage from "@/models/ShowcasePage";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import {
  buildProfessionalsDirectory,
  type DirectoryLocale,
  type DirectoryPageSource,
  type DirectoryProfessional,
  type DirectoryProfileSource,
} from "@/lib/professionals-directory";

/** The rows of « Nos professionnels ». Only the fields the page may show are loaded. */
export async function loadProfessionalsDirectory(locale: DirectoryLocale): Promise<DirectoryProfessional[]> {
  await connectToDatabase();
  const users = await User.find({ role: "professional", status: "active" }).select("firstName lastName").lean();
  if (users.length === 0) return [];
  const ids = users.map((user) => user._id);
  const [profiles, showcaseOn] = await Promise.all([
    Profile.find({ userId: { $in: ids }, profileVisible: { $ne: false } })
      .select("userId specialty bio education.degree profileVisible profileCompleted")
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
  return buildProfessionalsDirectory({
    locale,
    users,
    profiles: profiles as unknown as DirectoryProfileSource[],
    pages,
    showcaseOn,
  });
}
