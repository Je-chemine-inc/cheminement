import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ShowcasePage from "@/models/ShowcasePage";
import User from "@/models/User";
import Profile from "@/models/Profile";
import ProCatalogItem from "@/models/ProCatalogItem";
import { calculateAppointmentPricing } from "@/lib/pricing";
import {
  SHOWCASE_THERAPY_TYPES,
  buildShowcasePublicProfile,
  toShowcaseCard,
  type ShowcaseCard,
  type ShowcaseContentSource,
  type ShowcaseExpertiseSource,
  type ShowcaseLocale,
  type ShowcaseProfileSource,
  type ShowcasePublicProfile,
  type ShowcaseTherapyType,
} from "@/lib/showcase-public";

/**
 * Reads behind the public showcase pages (spec 003). Documents are loaded
 * here and leave only through buildShowcasePublicProfile. Public reads see
 * published pages of active professionals only; the switch is checked by the
 * pages themselves.
 */

/** Profile fields a showcase page may read. Nothing else is loaded. */
export const SHOWCASE_PROFILE_SELECT = [
  "userId",
  "specialty",
  "license",
  "languages",
  "modalities",
  "sessionTypes",
  "officeAddress.city",
  "yearsOfExperience",
  "acceptingNewClients",
  "acceptingEmergencyConsultations",
  "availability.sessionDurationMinutes",
].join(" ");

const PAGE_SELECT = "userId slug cityKey services published publishedAt updatedAt";
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type PageDoc = {
  _id: unknown;
  userId: unknown;
  slug: string;
  cityKey: string;
  services?: { standard?: boolean; quick?: boolean };
  published?: ShowcaseContentSource;
  draft?: ShowcaseContentSource;
  publishedAt?: Date;
  updatedAt?: Date;
};

async function loadExpertises(ids: readonly unknown[]): Promise<ShowcaseExpertiseSource[]> {
  const valid = [...new Set(ids.map((id) => String(id)))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (valid.length === 0) return [];
  const docs = await ProCatalogItem.find({
    _id: { $in: valid },
    category: "expertise",
    showcase: true,
    active: true,
  })
    .select("slug labelFr labelEn")
    .lean();
  return docs.map((doc) => ({
    id: String(doc._id),
    slug: doc.slug ?? null,
    labelFr: doc.labelFr,
    labelEn: doc.labelEn ?? null,
  }));
}

/** What a client pays, per therapy type, under the platform's pricing rules. */
async function loadClientPrices(
  professionalId: string,
): Promise<Partial<Record<ShowcaseTherapyType, number>>> {
  const prices: Partial<Record<ShowcaseTherapyType, number>> = {};
  for (const type of SHOWCASE_THERAPY_TYPES) {
    prices[type] = (await calculateAppointmentPricing(professionalId, type)).sessionPrice;
  }
  return prices;
}

async function buildFromPage(
  page: PageDoc,
  content: ShowcaseContentSource,
  locale: ShowcaseLocale,
  requireActive: boolean,
): Promise<ShowcasePublicProfile | null> {
  const userId = String(page.userId);
  const userFilter = requireActive
    ? { _id: userId, role: "professional" as const, status: "active" as const }
    : { _id: userId, role: "professional" as const };
  const [user, profile, expertises, prices] = await Promise.all([
    User.findOne(userFilter).select("firstName lastName").lean(),
    Profile.findOne({ userId }).select(SHOWCASE_PROFILE_SELECT).lean(),
    loadExpertises(content.expertiseIds ?? []),
    loadClientPrices(userId),
  ]);
  if (!user) return null;
  return buildShowcasePublicProfile({
    locale,
    page: { slug: page.slug, cityKey: page.cityKey, services: page.services },
    content,
    user,
    profile: profile as unknown as ShowcaseProfileSource | null,
    expertises,
    prices,
  });
}

export type ShowcaseLookup =
  | { kind: "found"; profile: ShowcasePublicProfile; updatedAt: Date | null }
  | { kind: "moved"; cityKey: string; slug: string }
  | { kind: "missing" };

/** A published page by its slug, or where a former slug moved to. */
export async function findPublishedShowcase(
  slug: string,
  locale: ShowcaseLocale,
): Promise<ShowcaseLookup> {
  if (!SLUG_FORMAT.test(slug)) return { kind: "missing" };
  await connectToDatabase();
  const page = (await ShowcasePage.findOne({ slug, status: "published" })
    .select(PAGE_SELECT)
    .lean()) as unknown as PageDoc | null;
  if (!page) {
    const moved = await ShowcasePage.findOne({ previousSlugs: slug, status: "published" })
      .select("slug cityKey")
      .lean();
    return moved ? { kind: "moved", cityKey: moved.cityKey, slug: moved.slug } : { kind: "missing" };
  }
  if (!page.published) return { kind: "missing" };
  const profile = await buildFromPage(page, page.published, locale, true);
  return profile
    ? { kind: "found", profile, updatedAt: page.updatedAt ?? null }
    : { kind: "missing" };
}

/** The professionals presented in a city, for its page. */
export async function listPublishedShowcaseCards(
  cityKey: string,
  locale: ShowcaseLocale,
): Promise<ShowcaseCard[]> {
  await connectToDatabase();
  const pages = (await ShowcasePage.find({ cityKey, status: "published" })
    .select(PAGE_SELECT)
    .lean()) as unknown as PageDoc[];
  if (pages.length === 0) return [];
  const userIds = pages.map((page) => page.userId);
  const [users, profiles, expertises] = await Promise.all([
    User.find({ _id: { $in: userIds }, role: "professional", status: "active" })
      .select("firstName lastName")
      .lean(),
    Profile.find({ userId: { $in: userIds } }).select(SHOWCASE_PROFILE_SELECT).lean(),
    loadExpertises(pages.flatMap((page) => page.published?.expertiseIds ?? [])),
  ]);
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const profileByUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));

  const cards: ShowcaseCard[] = [];
  for (const page of pages) {
    const user = userById.get(String(page.userId));
    if (!user || !page.published) continue;
    const profile = buildShowcasePublicProfile({
      locale,
      page: { slug: page.slug, cityKey: page.cityKey, services: page.services },
      content: page.published,
      user,
      profile: (profileByUser.get(String(page.userId)) ?? null) as unknown as ShowcaseProfileSource | null,
      expertises,
      prices: {},
    });
    if (profile) cards.push(toShowcaseCard(profile));
  }
  return cards.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
}

/** Published pages of active professionals in a city, for its sitemap. */
export async function listShowcaseSitemapPages(
  cityKey: string,
): Promise<{ slug: string; lastModified: Date | null }[]> {
  await connectToDatabase();
  const pages = await ShowcasePage.find({ cityKey, status: "published" })
    .select("userId slug updatedAt")
    .lean();
  if (pages.length === 0) return [];
  const active = await User.find({
    _id: { $in: pages.map((page) => page.userId) },
    role: "professional",
    status: "active",
  })
    .select("_id")
    .lean();
  const activeIds = new Set(active.map((user) => String(user._id)));
  return pages
    .filter((page) => activeIds.has(String(page.userId)))
    .map((page) => ({ slug: page.slug, lastModified: page.updatedAt ?? null }));
}

/**
 * A page as it would look, for the professional's own preview or an admin's
 * review: the draft or the published copy, whatever the page's state.
 */
export async function buildShowcasePreview(
  userId: string,
  source: "draft" | "published",
  locale: ShowcaseLocale,
): Promise<ShowcasePublicProfile | null> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return null;
  await connectToDatabase();
  const page = (await ShowcasePage.findOne({ userId })
    .select(`${PAGE_SELECT} draft`)
    .lean()) as unknown as PageDoc | null;
  const content = page?.[source];
  if (!page || !content) return null;
  return buildFromPage(page, content, locale, false);
}
