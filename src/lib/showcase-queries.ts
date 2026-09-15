import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ShowcasePage from "@/models/ShowcasePage";
import User from "@/models/User";
import Profile from "@/models/Profile";
import ProCatalogItem from "@/models/ProCatalogItem";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import {
  SHOWCASE_THERAPY_TYPES,
  buildShowcasePublicProfile,
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
  "quickConsultation.durationMinutes",
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

/** What a client pays, per therapy type and for a quick consultation, under the platform's pricing rules. */
async function loadClientPrices(professionalId: string): Promise<{
  prices: Partial<Record<ShowcaseTherapyType, number>>;
  quickPrice: number;
}> {
  const prices: Partial<Record<ShowcaseTherapyType, number>> = {};
  for (const type of SHOWCASE_THERAPY_TYPES) {
    prices[type] = (await calculateAppointmentPricing(professionalId, type)).sessionPrice;
  }
  const quick = await calculateAppointmentPricing(professionalId, "solo", { quick: true });
  return { prices, quickPrice: quick.sessionPrice };
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
  const [user, profile, expertises, pricing] = await Promise.all([
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
    prices: pricing.prices,
    quickPrice: pricing.quickPrice,
  });
}

export type ShowcaseLookup =
  | { kind: "found"; profile: ShowcasePublicProfile; updatedAt: Date | null }
  | { kind: "moved"; slug: string }
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
      .select("slug")
      .lean();
    return moved ? { kind: "moved", slug: moved.slug } : { kind: "missing" };
  }
  if (!page.published) return { kind: "missing" };
  const profile = await buildFromPage(page, page.published, locale, true);
  return profile
    ? { kind: "found", profile, updatedAt: page.updatedAt ?? null }
    : { kind: "missing" };
}

/** One published page of an active professional, as the www sitemap lists it. */
export interface ShowcaseDirectoryEntry {
  slug: string;
  lastModified: Date | null;
}

type DirectoryPageDoc = {
  userId: unknown;
  cityKey: string;
  slug: string;
  updatedAt?: Date;
};

/** Every published page of an active professional in a registry city (a page elsewhere does not render). */
export async function loadShowcaseDirectory(): Promise<ShowcaseDirectoryEntry[]> {
  await connectToDatabase();
  const pages = (await ShowcasePage.find({ status: "published" })
    .select("userId cityKey slug updatedAt")
    .lean()) as unknown as DirectoryPageDoc[];
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
    .filter((page) => activeIds.has(String(page.userId)) && isShowcaseCityKey(page.cityKey))
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
  // The draft is previewed in the city it asks for, before an admin approves the move.
  const cityKey = source === "draft" && content.cityKey && isShowcaseCityKey(content.cityKey) ? content.cityKey : page.cityKey;
  return buildFromPage({ ...page, cityKey }, content, locale, false);
}
