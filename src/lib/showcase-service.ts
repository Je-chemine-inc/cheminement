import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ShowcasePage, { type IShowcaseContent, type IShowcasePage } from "@/models/ShowcasePage";
import User from "@/models/User";
import Profile from "@/models/Profile";
import ProCatalogItem from "@/models/ProCatalogItem";
import StoredFile from "@/models/StoredFile";
import { slugify } from "@/lib/content-kind";
import { SHOWCASE_CITIES, findShowcaseCity, matchShowcaseCity } from "@/lib/showcase-cities";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import {
  ORDER_CODE_BY_TITLE,
  SHOWCASE_CONSENT_VERSION,
  SHOWCASE_LIMITS,
  type ShowcaseActor,
} from "@/lib/showcase-constants";
import {
  SHOWCASE_CHANGE_ALERT_GAP_MS,
  changedShowcaseFields,
  cleanParagraphs,
  decideShowcaseAction,
  isValidShowcaseSlug,
  missingShowcaseRequirements,
  normalizeShowcaseDraft,
  pickShowcaseSlug,
  requestedShowcaseCityKey,
  showcaseCityKeyOf,
  showcaseSlugCandidates,
  type ShowcaseEditableField,
  type ShowcaseRequirement,
  type ShowcaseWorkflowState,
} from "@/lib/showcase-workflow";
import {
  SHOWCASE_LANGUAGE_KEYS,
  SHOWCASE_MODALITY_KEYS,
  showcaseLanguageKey,
  showcaseModalityKey,
} from "@/lib/showcase-public";
import { deleteUnreferencedShowcasePhotos } from "@/lib/showcase-photo";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { SHOWCASE_STATS_DAYS, loadShowcaseStats } from "@/lib/showcase-stats";
import {
  sendAdminShowcaseUpdatedAlert,
  sendShowcasePublishedEmail,
  sendShowcaseUnpublishedEmail,
} from "@/lib/notifications";

/**
 * Everything that changes a showcase page (spec 003): activation, the admin's
 * draft, publication, the professional's live edits, taking a page down and
 * moving it. Each change is one conditional write on the state it was decided
 * from, so two admins, or an admin and the professional, cannot both win.
 * Emails are returned as deferred tasks for the route to run after the response.
 */

export type Deferred = () => Promise<unknown>;
export type ServiceFailure = {
  ok: false;
  status: number;
  code: string;
  details?: Record<string, unknown>;
};
export type ServiceResult<T> = { ok: true; value: T; deferred: Deferred[] } | ServiceFailure;

const fail = (status: number, code: string, details?: Record<string, unknown>): ServiceFailure => ({
  ok: false,
  status,
  code,
  ...(details ? { details } : {}),
});
const success = <T>(value: T, deferred: Deferred[] = []): ServiceResult<T> => ({
  ok: true,
  value,
  deferred,
});

type Localized = { fr?: string; en?: string };
type ContentLean = Partial<Omit<IShowcaseContent, "headline" | "intro" | "bio" | "approach" | "insuranceNote" | "values">> & {
  headline?: Localized;
  intro?: Localized;
  bio?: Localized;
  approach?: Localized;
  insuranceNote?: Localized;
  values?: Localized[];
};

type PageLean = {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  slug: string;
  previousSlugs?: string[];
  cityKey: string;
  status: IShowcasePage["status"];
  draft?: ContentLean;
  draftRevision?: number;
  draftUpdatedAt?: Date;
  draftUpdatedBy?: ShowcaseActor;
  published?: ContentLean;
  publishedRevision?: number;
  publishedAt?: Date;
  unpublishedAt?: Date;
  unpublishedBy?: ShowcaseActor;
  services?: { standard?: boolean; quick?: boolean };
  consent?: { acceptedAt?: Date; version?: string; source?: ShowcaseActor };
  invitedAt?: Date;
  changeAlertedAt?: Date;
  history?: { at: Date; actor: string; action: string; note?: string }[];
};

const PROFILE_FACTS_SELECT =
  "specialty license modalities languages officeAddress.city acceptingNewClients acceptingEmergencyConsultations";

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

function nameOf(user: { firstName?: string; lastName?: string } | null | undefined): string {
  return `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
}

function localeOf(user: { language?: string } | null | undefined): "fr" | "en" {
  return user?.language === "en" ? "en" : "fr";
}

function historyEntry(actor: ShowcaseActor | "system", by: unknown, action: string, note?: string) {
  return {
    history: {
      $each: [{ at: new Date(), actor, by, action, ...(note ? { note } : {}) }],
      $slice: -100,
    },
  };
}

async function loadPage(userId: string): Promise<PageLean | null> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return null;
  await connectToDatabase();
  return (await ShowcasePage.findOne({ userId }).lean()) as unknown as PageLean | null;
}

function workflowState(page: PageLean): ShowcaseWorkflowState {
  return {
    status: page.status,
    draftRevision: page.draftRevision ?? 0,
    publishedRevision: page.publishedRevision ?? null,
    hasPublishedSnapshot: Boolean(page.published),
    unpublishedBy: page.unpublishedBy ?? null,
    consentVersion: page.consent?.version ?? null,
  };
}

async function profileFacts(userId: string) {
  return Profile.findOne({ userId }).select(PROFILE_FACTS_SELECT).lean();
}

async function showcaseExpertiseOptions() {
  return ProCatalogItem.find({ category: "expertise", showcase: true, active: true })
    .sort({ labelFr: 1 })
    .select("labelFr labelEn aliases")
    .lean();
}

/** Every slug in use, current or former, among the candidates. */
async function takenSlugs(candidates: readonly string[], exceptPageId?: unknown): Promise<Set<string>> {
  const filter: Record<string, unknown> = {
    $or: [{ slug: { $in: candidates } }, { previousSlugs: { $in: candidates } }],
  };
  if (exceptPageId) filter._id = { $ne: exceptPageId };
  const docs = await ShowcasePage.find(filter).select("slug previousSlugs").lean();
  const taken = new Set<string>();
  for (const doc of docs) {
    taken.add(doc.slug);
    for (const previous of doc.previousSlugs ?? []) taken.add(previous);
  }
  return taken;
}

function uniqueKeys<K extends string>(
  values: readonly string[] | null | undefined,
  keyOf: (raw: string) => K | null,
  order: readonly K[],
): K[] {
  const found = new Set<K>();
  for (const raw of values ?? []) {
    const key = typeof raw === "string" ? keyOf(raw) : null;
    if (key) found.add(key);
  }
  return order.filter((key) => found.has(key));
}

function photoUrl(id: unknown): string | null {
  return id ? `/api/files/${String(id)}` : null;
}

function contentView(content: ContentLean | undefined) {
  const text = (value?: Localized) => ({ fr: value?.fr ?? "", en: value?.en ?? "" });
  return {
    displayName: content?.displayName ?? "",
    headline: text(content?.headline),
    intro: text(content?.intro),
    bio: text(content?.bio),
    approach: text(content?.approach),
    insuranceNote: text(content?.insuranceNote),
    values: (content?.values ?? []).map(text),
    expertiseIds: (content?.expertiseIds ?? []).map(String),
    orderCode: content?.orderCode ?? null,
    orderLabel: content?.orderLabel ?? "",
    photoUrl: photoUrl(content?.photoFileId),
    cityKey: content?.cityKey ?? null,
  };
}

export type ShowcaseContentView = ReturnType<typeof contentView>;

// ------------------------------------------------------------------- views

export async function loadShowcaseEditor(userId: string) {
  const page = await loadPage(userId);
  if (!page) return null;
  const [profile, options, showcaseEnabled, stats] = await Promise.all([
    profileFacts(userId),
    showcaseExpertiseOptions(),
    isShowcaseEnabled(),
    loadShowcaseStats("page", [String(page._id)]),
  ]);
  const city = findShowcaseCity(page.cityKey);
  const missing: ShowcaseRequirement[] = missingShowcaseRequirements({
    draft: page.draft ?? {},
    profile,
    cityKey: showcaseCityKeyOf(page),
  });
  const requested = findShowcaseCity(requestedShowcaseCityKey(page));
  return {
    page: {
      slug: page.slug,
      cityKey: page.cityKey,
      cityName: city?.name ?? page.cityKey,
      publicUrl: absoluteShowcaseUrl(page.cityKey, `/${page.slug}`),
      requestedCity: requested
        ? { key: requested.key, name: requested.name, publicUrl: absoluteShowcaseUrl(requested.key, `/${page.slug}`) }
        : null,
      status: page.status,
      draft: contentView(page.draft),
      draftRevision: page.draftRevision ?? 0,
      draftUpdatedAt: page.draftUpdatedAt ?? null,
      draftUpdatedBy: page.draftUpdatedBy ?? null,
      published: page.published
        ? { publishedAt: page.publishedAt ?? null, revision: page.publishedRevision ?? null }
        : null,
      hasUnpublishedChanges:
        Boolean(page.published) && (page.draftRevision ?? 0) !== (page.publishedRevision ?? -1),
      unpublishedBy: page.unpublishedBy ?? null,
      services: {
        standard: page.services?.standard !== false,
        quick: page.services?.quick === true,
      },
      consent: {
        version: page.consent?.version ?? null,
        acceptedAt: page.consent?.acceptedAt ?? null,
        source: page.consent?.source ?? null,
        current: page.consent?.version === SHOWCASE_CONSENT_VERSION,
      },
    },
    missing,
    profileFacts: {
      title: profile?.specialty ?? null,
      license: profile?.license ?? null,
      modalities: uniqueKeys(profile?.modalities, showcaseModalityKey, SHOWCASE_MODALITY_KEYS),
      languages: uniqueKeys(profile?.languages, showcaseLanguageKey, SHOWCASE_LANGUAGE_KEYS),
      officeCity: profile?.officeAddress?.city ?? null,
      acceptingNewClients: profile?.acceptingNewClients !== false,
      acceptingEmergencyConsultations: profile?.acceptingEmergencyConsultations !== false,
    },
    expertiseOptions: options.map((option) => ({
      id: String(option._id),
      labelFr: option.labelFr,
      labelEn: option.labelEn ?? "",
    })),
    consentVersion: SHOWCASE_CONSENT_VERSION,
    showcaseEnabled,
    stats: {
      days: SHOWCASE_STATS_DAYS,
      ...(stats.get(String(page._id)) ?? { views: 0, ctaClicks: 0 }),
    },
  };
}

export type ShowcaseEditorView = NonNullable<Awaited<ReturnType<typeof loadShowcaseEditor>>>;

export async function loadShowcaseAdminView(userId: string) {
  const editor = await loadShowcaseEditor(userId);
  if (!editor) return null;
  const [user, page] = await Promise.all([
    User.findById(userId).select("firstName lastName email status").lean(),
    ShowcasePage.findOne({ userId })
      .select("published history previousSlugs invitedAt")
      .lean() as unknown as Promise<PageLean | null>,
  ]);
  return {
    ...editor,
    admin: {
      user: user ? { id: userId, name: nameOf(user), email: user.email, status: user.status } : null,
      published: page?.published ? contentView(page.published) : null,
      history: (page?.history ?? [])
        .slice(-50)
        .reverse()
        .map((entry) => ({ at: entry.at, actor: entry.actor, action: entry.action, note: entry.note ?? "" })),
      previousSlugs: page?.previousSlugs ?? [],
      invitedAt: page?.invitedAt ?? null,
    },
  };
}

/** Every approved professional with the state of their page, for the admin list. */
export async function listShowcasesForAdmin() {
  await connectToDatabase();
  const [professionals, pages, showcaseEnabled] = await Promise.all([
    User.find({ role: "professional", adminApproved: true })
      .select("firstName lastName email status")
      .sort({ lastName: 1, firstName: 1 })
      .lean(),
    ShowcasePage.find({})
      .select(
        "userId slug cityKey status draftRevision draftUpdatedAt draftUpdatedBy publishedRevision published.displayName publishedAt unpublishedBy invitedAt",
      )
      .lean() as unknown as Promise<PageLean[]>,
    isShowcaseEnabled(),
  ]);
  const [profiles, stats] = await Promise.all([
    Profile.find({ userId: { $in: professionals.map((pro) => pro._id) } })
      .select("userId specialty officeAddress.city")
      .lean(),
    loadShowcaseStats(
      "page",
      pages.map((page) => String(page._id)),
    ),
  ]);
  const pageByUser = new Map(pages.map((page) => [String(page.userId), page]));
  const profileByUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));

  const rows = professionals.map((pro) => {
    const id = String(pro._id);
    const page = pageByUser.get(id);
    const profile = profileByUser.get(id);
    return {
      userId: id,
      name: nameOf(pro),
      email: pro.email,
      accountStatus: pro.status,
      title: profile?.specialty ?? null,
      officeCity: profile?.officeAddress?.city ?? null,
      suggestedCityKey: matchShowcaseCity(profile?.officeAddress?.city)?.key ?? null,
      page: page
        ? {
            slug: page.slug,
            cityKey: page.cityKey,
            cityName: findShowcaseCity(page.cityKey)?.name ?? page.cityKey,
            publicUrl: absoluteShowcaseUrl(page.cityKey, `/${page.slug}`),
            status: page.status,
            hasUnpublishedChanges:
              Boolean(page.published) && (page.draftRevision ?? 0) !== (page.publishedRevision ?? -1),
            unpublishedBy: page.unpublishedBy ?? null,
            invitedAt: page.invitedAt ?? null,
            publishedAt: page.publishedAt ?? null,
            professionalEditedAt: page.draftUpdatedBy === "professional" ? (page.draftUpdatedAt ?? null) : null,
            stats: stats.get(String(page._id)) ?? { views: 0, ctaClicks: 0 },
          }
        : null,
    };
  });

  const activeIds = new Set(professionals.filter((pro) => pro.status === "active").map((pro) => String(pro._id)));
  const liveByCity = new Map<string, number>();
  for (const page of pages) {
    if (page.status !== "published" || !activeIds.has(String(page.userId))) continue;
    liveByCity.set(page.cityKey, (liveByCity.get(page.cityKey) ?? 0) + 1);
  }
  const cities = SHOWCASE_CITIES.filter((city) => liveByCity.has(city.key)).map((city) => ({
    key: city.key,
    name: city.name,
    host: city.host,
    region: city.region,
    published: liveByCity.get(city.key) ?? 0,
  }));

  return {
    rows,
    cities,
    cityOptions: SHOWCASE_CITIES.map((city) => ({ key: city.key, name: city.name, region: city.region })),
    showcaseEnabled,
    statsDays: SHOWCASE_STATS_DAYS,
  };
}

// ----------------------------------------------------------------- changes

function suggestExpertiseIds(
  problematics: readonly string[],
  options: readonly { _id: unknown; labelFr: string; labelEn?: string; aliases?: string[] }[],
): string[] {
  const wanted = new Set(problematics.map((value) => slugify(value)).filter(Boolean));
  return options
    .filter((option) =>
      [option.labelFr, option.labelEn ?? "", ...(option.aliases ?? [])].some(
        (label) => label && wanted.has(slugify(label)),
      ),
    )
    .slice(0, SHOWCASE_LIMITS.expertisesMax)
    .map((option) => String(option._id));
}

/**
 * Creates a professional's page, prefilled from their profile, for an admin
 * to prepare. Nothing is sent to the professional: they hear about their page
 * when an admin publishes it with their agreement.
 */
export async function activateShowcase(input: {
  userId: string;
  cityKey?: unknown;
  slug?: unknown;
  adminId: string;
}): Promise<ServiceResult<{ slug: string; cityKey: string }>> {
  if (!mongoose.Types.ObjectId.isValid(input.userId)) return fail(400, "INVALID_ID");
  await connectToDatabase();
  const user = await User.findOne({ _id: input.userId, role: "professional" })
    .select("firstName lastName status adminApproved")
    .lean();
  if (!user) return fail(404, "PROFESSIONAL_NOT_FOUND");
  if (user.status !== "active" || user.adminApproved !== true) {
    return fail(409, "PROFESSIONAL_NOT_ACTIVE");
  }
  const profile = await Profile.findOne({ userId: input.userId })
    .select("specialty problematics bio officeAddress.city")
    .lean();
  const city =
    typeof input.cityKey === "string" && input.cityKey
      ? findShowcaseCity(input.cityKey)
      : matchShowcaseCity(profile?.officeAddress?.city);
  if (!city) return fail(400, "INVALID_CITY");
  if (await ShowcasePage.exists({ userId: input.userId })) return fail(409, "ALREADY_INVITED");

  let slug: string | null;
  if (typeof input.slug === "string" && input.slug.trim()) {
    const requested = input.slug.trim().toLowerCase();
    if (!isValidShowcaseSlug(requested)) return fail(400, "INVALID_SLUG");
    if ((await takenSlugs([requested])).has(requested)) return fail(409, "SLUG_TAKEN");
    slug = requested;
  } else {
    const candidates = showcaseSlugCandidates(user.firstName, user.lastName);
    slug = pickShowcaseSlug(candidates, await takenSlugs(candidates));
    if (!slug) return fail(409, "SLUG_TAKEN");
  }

  const options = await showcaseExpertiseOptions();
  const bio = cleanParagraphs(profile?.bio ?? "", SHOWCASE_LIMITS.bio);
  const orderCode = ORDER_CODE_BY_TITLE[profile?.specialty ?? ""];
  const now = new Date();
  try {
    await ShowcasePage.create({
      userId: input.userId,
      slug,
      cityKey: city.key,
      status: "draft",
      invitedAt: now,
      invitedBy: input.adminId,
      draft: {
        displayName: nameOf(user).slice(0, SHOWCASE_LIMITS.displayName),
        bio: { fr: bio.ok ? bio.value : "", en: "" },
        expertiseIds: suggestExpertiseIds(profile?.problematics ?? [], options),
        ...(orderCode ? { orderCode } : {}),
        cityKey: city.key,
      },
      history: [{ at: now, actor: "admin", by: input.adminId, action: "activate", note: `${city.key}/${slug}` }],
    });
  } catch (error) {
    if (isDuplicateKey(error)) return fail(409, "ALREADY_INVITED");
    throw error;
  }
  return success({ slug, cityKey: city.key });
}

/**
 * Saves the page's text. An admin writes the draft, which goes public when
 * they publish it. The professional edits their published page live: the
 * save writes the draft and the public copy together (see saveLiveEdit).
 */
export async function saveShowcaseDraft(input: {
  userId: string;
  body: unknown;
  actor: ShowcaseActor;
}): Promise<ServiceResult<null>> {
  const page = await loadPage(input.userId);
  if (!page) return fail(404, "NOT_FOUND");
  if (input.actor === "professional") {
    const decision = decideShowcaseAction(workflowState(page), "edit", "professional");
    if (!decision.ok) return fail(409, decision.code);
  }
  const options = await showcaseExpertiseOptions();
  const normalized = normalizeShowcaseDraft(
    input.body,
    new Set(options.map((option) => String(option._id))),
    input.actor,
  );
  if (!normalized.ok) return fail(400, normalized.code, { field: normalized.field });
  if (Object.keys(normalized.set).length === 0 && normalized.unset.length === 0) {
    return fail(400, "NOTHING_TO_SAVE");
  }
  if (input.actor === "professional") {
    // The professional's save never unsets: only the admin-only fields do.
    const fields = Object.fromEntries(
      Object.entries(normalized.set).map(([path, value]) => [path.replace(/^draft\./, ""), value]),
    );
    return saveLiveEdit(page, fields);
  }

  // A page never published has no public address to protect: the city it asks for applies at once.
  // Once it has been public, the move waits for an admin to publish the revision (publishShowcase).
  const askedCity = normalized.set["draft.cityKey"];
  const moveNow = typeof askedCity === "string" && !page.publishedAt && askedCity !== page.cityKey;
  const update: Record<string, unknown> = {
    $set: {
      ...normalized.set,
      ...(moveNow ? { cityKey: askedCity } : {}),
      draftUpdatedAt: new Date(),
      draftUpdatedBy: input.actor,
      ...(page.status === "invited" ? { status: "draft" } : {}),
    },
    $inc: { draftRevision: 1 },
  };
  if (moveNow) {
    update.$push = historyEntry(input.actor, undefined, "move", `${page.cityKey} > ${askedCity}`);
  }
  if (normalized.unset.length > 0) {
    update.$unset = Object.fromEntries(normalized.unset.map((path) => [path, ""]));
  }
  await ShowcasePage.updateOne({ _id: page._id }, update);
  return success(null);
}

/**
 * A professional's change to their published page, written to the draft and
 * to the public copy at once. Refused when it would leave the public page
 * missing something it had; reported to the team (changeAlert).
 */
async function saveLiveEdit(page: PageLean, fields: Record<string, unknown>): Promise<ServiceResult<null>> {
  const published = page.published ?? {};
  const profile = await profileFacts(String(page.userId));
  const missingIn = (content: ContentLean) =>
    missingShowcaseRequirements({ draft: content, profile, cityKey: page.cityKey });
  const before = new Set(missingIn(published));
  const introduced = missingIn({ ...published, ...fields } as ContentLean).filter((item) => !before.has(item));
  if (introduced.length > 0) return fail(422, "INCOMPLETE", { missing: introduced });

  const revision = page.draftRevision ?? 0;
  const changed = changedShowcaseFields(published, fields);
  const now = new Date();
  const set: Record<string, unknown> = {
    draftRevision: revision + 1,
    draftUpdatedAt: now,
    draftUpdatedBy: "professional",
    // Pending admin corrections stay pending: the copies are in step only if they were.
    ...(page.publishedRevision === revision ? { publishedRevision: revision + 1 } : {}),
  };
  for (const [field, value] of Object.entries(fields)) {
    set[`draft.${field}`] = value;
    set[`published.${field}`] = value;
  }
  const updated = await ShowcasePage.findOneAndUpdate(
    { _id: page._id, draftRevision: revision },
    {
      $set: set,
      ...(changed.length > 0 ? { $push: historyEntry("professional", page.userId, "edit", changed.join(", ")) } : {}),
    },
    { new: true },
  )
    .select("_id")
    .lean();
  if (!updated) return fail(409, "CONFLICT");
  return success(null, await changeAlert(page, changed, now));
}

/**
 * The team's email about a professional's live edit, at most one per page
 * within SHOWCASE_CHANGE_ALERT_GAP_MS (claimed with a conditional write).
 * The page's history keeps every edit.
 */
async function changeAlert(
  page: PageLean,
  changed: readonly ShowcaseEditableField[],
  now: Date,
): Promise<Deferred[]> {
  if (changed.length === 0) return [];
  const cutoff = new Date(now.getTime() - SHOWCASE_CHANGE_ALERT_GAP_MS);
  const claimed = await ShowcasePage.findOneAndUpdate(
    {
      _id: page._id,
      $or: [{ changeAlertedAt: { $exists: false } }, { changeAlertedAt: null }, { changeAlertedAt: { $lte: cutoff } }],
    },
    { $set: { changeAlertedAt: now } },
    { new: true },
  )
    .select("_id")
    .lean();
  if (!claimed) return [];
  const user = await User.findById(page.userId).select("firstName lastName").lean();
  const alert = {
    professionalName: nameOf(user),
    professionalId: String(page.userId),
    cityName: findShowcaseCity(page.cityKey)?.name ?? page.cityKey,
    publicUrl: absoluteShowcaseUrl(page.cityKey, `/${page.slug}`),
    fields: [...changed],
  };
  return [() => sendAdminShowcaseUpdatedAlert(alert)];
}

/**
 * Sets (or, with null, removes) the page's photo. An admin changes the
 * draft's; the professional changes the photo of their published page, live,
 * and cannot remove it, since a published page needs one.
 */
export async function setShowcasePhoto(input: {
  userId: string;
  fileId: string | null;
  actor: ShowcaseActor;
}): Promise<ServiceResult<{ photoUrl: string | null }>> {
  if (!mongoose.Types.ObjectId.isValid(input.userId)) return fail(404, "NOT_FOUND");
  await connectToDatabase();
  if (input.actor === "professional") return setLivePhoto(input.userId, input.fileId);

  const set: Record<string, unknown> = { draftUpdatedAt: new Date(), draftUpdatedBy: input.actor };
  const update: Record<string, unknown> = { $inc: { draftRevision: 1 } };
  if (input.fileId) {
    set["draft.photoFileId"] = input.fileId;
  } else {
    update.$unset = { "draft.photoFileId": "" };
  }
  update.$set = set;
  const before = (await ShowcasePage.findOneAndUpdate({ userId: input.userId }, update, { new: false })
    .select("status draft.photoFileId published.photoFileId")
    .lean()) as unknown as PageLean | null;
  if (!before) {
    if (input.fileId) await StoredFile.deleteOne({ _id: input.fileId, kind: "showcase-photo" });
    return fail(404, "NOT_FOUND");
  }
  if (before.status === "invited") {
    await ShowcasePage.updateOne({ _id: before._id, status: "invited" }, { $set: { status: "draft" } });
  }
  await deleteUnreferencedShowcasePhotos(
    [before.draft?.photoFileId],
    [input.fileId, before.published?.photoFileId],
  );
  return success({ photoUrl: photoUrl(input.fileId) });
}

async function setLivePhoto(userId: string, fileId: string | null): Promise<ServiceResult<{ photoUrl: string | null }>> {
  // An uploaded file that no page ends up showing is deleted at once.
  const refuse = async (failure: ServiceFailure) => {
    if (fileId) await StoredFile.deleteOne({ _id: fileId, kind: "showcase-photo" });
    return failure;
  };
  const page = await loadPage(userId);
  if (!page) return refuse(fail(404, "NOT_FOUND"));
  const decision = decideShowcaseAction(workflowState(page), "edit", "professional");
  if (!decision.ok) return refuse(fail(409, decision.code));
  if (!fileId) return fail(422, "INCOMPLETE", { missing: ["photo"] });

  const revision = page.draftRevision ?? 0;
  const now = new Date();
  const updated = await ShowcasePage.findOneAndUpdate(
    { _id: page._id, draftRevision: revision },
    {
      $set: {
        "draft.photoFileId": fileId,
        "published.photoFileId": fileId,
        draftRevision: revision + 1,
        draftUpdatedAt: now,
        draftUpdatedBy: "professional",
        ...(page.publishedRevision === revision ? { publishedRevision: revision + 1 } : {}),
      },
      $push: historyEntry("professional", page.userId, "edit", "photo"),
    },
    { new: true },
  )
    .select("_id")
    .lean();
  if (!updated) return refuse(fail(409, "CONFLICT"));
  await deleteUnreferencedShowcasePhotos([page.draft?.photoFileId, page.published?.photoFileId], [fileId]);
  return success({ photoUrl: photoUrl(fileId) }, await changeAlert(page, ["photo"], now));
}

export async function updateShowcaseServices(input: {
  userId: string;
  body: unknown;
}): Promise<ServiceResult<{ standard: boolean; quick: boolean }>> {
  const body = (typeof input.body === "object" && input.body !== null ? input.body : {}) as {
    standard?: unknown;
    quick?: unknown;
  };
  const set: Record<string, boolean> = {};
  for (const key of ["standard", "quick"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return fail(400, "INVALID_FIELD", { field: key });
    set[`services.${key}`] = body[key] as boolean;
  }
  if (Object.keys(set).length === 0) return fail(400, "NOTHING_TO_SAVE");
  if (!mongoose.Types.ObjectId.isValid(input.userId)) return fail(404, "NOT_FOUND");
  await connectToDatabase();
  const updated = await ShowcasePage.findOneAndUpdate({ userId: input.userId }, { $set: set }, { new: true })
    .select("services")
    .lean();
  if (!updated) return fail(404, "NOT_FOUND");
  return success({
    standard: updated.services?.standard !== false,
    quick: updated.services?.quick === true,
  });
}

/**
 * An admin publishes the draft revision they looked at. The professional's
 * agreement must be on record at the current version, or confirmed by the
 * admin now (`consentAttested`), which records it in the admin's name.
 */
export async function publishShowcase(input: {
  userId: string;
  revision: unknown;
  consentAttested: unknown;
  adminId: string;
}): Promise<ServiceResult<{ publicUrl: string }>> {
  const page = await loadPage(input.userId);
  if (!page) return fail(404, "NOT_FOUND");
  const decision = decideShowcaseAction(workflowState(page), "publish", "admin", {
    consentAttested: input.consentAttested === true,
  });
  if (!decision.ok) return fail(409, decision.code);
  const revision = page.draftRevision ?? 0;
  if (input.revision !== revision) return fail(409, "REVISION_CHANGED", { draftRevision: revision });

  const user = await User.findOne({ _id: input.userId, role: "professional" })
    .select("firstName lastName email language status")
    .lean();
  if (!user || user.status !== "active") return fail(409, "PROFESSIONAL_NOT_ACTIVE");
  const profile = await profileFacts(input.userId);
  const cityKey = showcaseCityKeyOf(page);
  const missing = missingShowcaseRequirements({ draft: page.draft ?? {}, profile, cityKey });
  if (missing.length > 0) return fail(422, "INCOMPLETE", { missing });

  // Publishing the revision publishes the city it asks for: the page moves, and
  // its old address redirects (the page route sends a slug on the wrong host to its city).
  const moving = requestedShowcaseCityKey(page);
  const consentOnRecord = page.consent?.version === SHOWCASE_CONSENT_VERSION;
  const now = new Date();
  const note = [
    `revision ${revision}`,
    moving ? `${page.cityKey} > ${moving}` : null,
    consentOnRecord ? null : "consent attested",
  ]
    .filter(Boolean)
    .join(" · ");
  const updated = (await ShowcasePage.findOneAndUpdate(
    moving ? { _id: page._id, draftRevision: revision, cityKey: page.cityKey } : { _id: page._id, draftRevision: revision },
    {
      $set: {
        published: page.draft,
        publishedRevision: revision,
        publishedAt: now,
        publishedBy: input.adminId,
        status: "published",
        // A review left pending by the retired flow ends here.
        "review.state": "none",
        ...(consentOnRecord
          ? {}
          : {
              consent: {
                acceptedAt: now,
                version: SHOWCASE_CONSENT_VERSION,
                source: "admin",
                attestedBy: input.adminId,
              },
            }),
        ...(moving ? { cityKey: moving } : {}),
      },
      $unset: { unpublishedAt: "", unpublishedBy: "" },
      $push: historyEntry("admin", input.adminId, "approve", note),
    },
    { new: true },
  )
    .select("draft.photoFileId published.photoFileId")
    .lean()) as unknown as PageLean | null;
  if (!updated) return fail(409, "REVISION_CHANGED");

  await deleteUnreferencedShowcasePhotos(
    [page.published?.photoFileId],
    [updated.draft?.photoFileId, updated.published?.photoFileId],
  );

  const publicUrl = absoluteShowcaseUrl(cityKey, `/${page.slug}`);
  const email = {
    professionalName: nameOf(user),
    professionalEmail: user.email,
    publicUrl,
    live: await isShowcaseEnabled(),
    firstPublication: !page.published,
    locale: localeOf(user),
  };
  return success({ publicUrl }, [() => sendShowcasePublishedEmail(email)]);
}

export async function unpublishShowcase(input: {
  userId: string;
  actor: ShowcaseActor;
  byUserId: string;
  note?: unknown;
}): Promise<ServiceResult<null>> {
  const page = await loadPage(input.userId);
  if (!page) return fail(404, "NOT_FOUND");
  const decision = decideShowcaseAction(workflowState(page), "unpublish", input.actor);
  if (!decision.ok) return fail(409, decision.code);
  const note = cleanParagraphs(input.note, SHOWCASE_LIMITS.reviewNotes);
  const noteText = note.ok ? note.value : "";

  const updated = await ShowcasePage.findOneAndUpdate(
    { _id: page._id, status: "published" },
    {
      $set: { status: "unpublished", unpublishedAt: new Date(), unpublishedBy: input.actor },
      $push: historyEntry(input.actor, input.byUserId, "unpublish", noteText || undefined),
    },
    { new: true },
  )
    .select("_id")
    .lean();
  if (!updated) return fail(409, "NOT_PUBLISHED");
  if (input.actor !== "admin") return success(null);

  const user = await User.findById(input.userId).select("firstName lastName email language").lean();
  if (!user) return success(null);
  const email = {
    professionalName: nameOf(user),
    professionalEmail: user.email,
    note: noteText,
    locale: localeOf(user),
  };
  return success(null, [() => sendShowcaseUnpublishedEmail(email)]);
}

export async function republishShowcase(input: {
  userId: string;
  actor: ShowcaseActor;
  byUserId: string;
}): Promise<ServiceResult<null>> {
  const page = await loadPage(input.userId);
  if (!page) return fail(404, "NOT_FOUND");
  const decision = decideShowcaseAction(workflowState(page), "republish", input.actor);
  if (!decision.ok) return fail(409, decision.code);
  const user = await User.findOne({ _id: input.userId, role: "professional" }).select("status").lean();
  if (!user || user.status !== "active") return fail(409, "PROFESSIONAL_NOT_ACTIVE");
  const profile = await profileFacts(input.userId);
  const missing = missingShowcaseRequirements({ draft: page.published ?? {}, profile, cityKey: page.cityKey });
  if (missing.length > 0) return fail(422, "INCOMPLETE", { missing });

  const filter: Record<string, unknown> = { _id: page._id, status: "unpublished" };
  if (page.unpublishedBy) filter.unpublishedBy = page.unpublishedBy;
  const updated = await ShowcasePage.findOneAndUpdate(
    filter,
    {
      $set: { status: "published" },
      $unset: { unpublishedAt: "", unpublishedBy: "" },
      $push: historyEntry(input.actor, input.byUserId, "republish"),
    },
    { new: true },
  )
    .select("_id")
    .lean();
  if (!updated) return fail(409, "NOT_UNPUBLISHED");
  return success(null);
}

/** Moves a page to another slug or city. A page that was ever public keeps its old slug answering. */
export async function moveShowcase(input: {
  userId: string;
  slug?: unknown;
  cityKey?: unknown;
  adminId: string;
}): Promise<ServiceResult<{ slug: string; cityKey: string }>> {
  const page = await loadPage(input.userId);
  if (!page) return fail(404, "NOT_FOUND");
  const nextSlug = typeof input.slug === "string" && input.slug.trim() ? input.slug.trim().toLowerCase() : page.slug;
  const nextCity = typeof input.cityKey === "string" && input.cityKey ? input.cityKey : page.cityKey;
  if (nextSlug === page.slug && nextCity === page.cityKey) {
    return success({ slug: page.slug, cityKey: page.cityKey });
  }
  if (!findShowcaseCity(nextCity)) return fail(400, "INVALID_CITY");

  const set: Record<string, unknown> = { cityKey: nextCity };
  if (nextCity !== page.cityKey) {
    // The copies name the city too: left behind, a publication would move the page back.
    set["draft.cityKey"] = nextCity;
    if (page.published) set["published.cityKey"] = nextCity;
  }
  if (nextSlug !== page.slug) {
    if (!isValidShowcaseSlug(nextSlug)) return fail(400, "INVALID_SLUG");
    if ((await takenSlugs([nextSlug], page._id)).has(nextSlug)) return fail(409, "SLUG_TAKEN");
    const previous = new Set(page.previousSlugs ?? []);
    previous.delete(nextSlug);
    if (page.publishedAt) previous.add(page.slug);
    set.slug = nextSlug;
    set.previousSlugs = [...previous];
  }

  try {
    const updated = await ShowcasePage.findOneAndUpdate(
      { _id: page._id, slug: page.slug, cityKey: page.cityKey },
      {
        $set: set,
        $push: historyEntry("admin", input.adminId, "move", `${page.cityKey}/${page.slug} > ${nextCity}/${nextSlug}`),
      },
      { new: true },
    )
      .select("_id")
      .lean();
    if (!updated) return fail(409, "CONFLICT");
  } catch (error) {
    if (isDuplicateKey(error)) return fail(409, "SLUG_TAKEN");
    throw error;
  }
  return success({ slug: nextSlug, cityKey: nextCity });
}
