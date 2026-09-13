import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import WaitlistEntry from "@/models/WaitlistEntry";
import ShowcasePage from "@/models/ShowcasePage";
import Appointment from "@/models/Appointment";
import User, { type IUser } from "@/models/User";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { loadBookableShowcase } from "@/lib/showcase-booking";
import { getValidMotifLabels } from "@/lib/motifs";
import { generateUrlToken, hashVerificationSecret } from "@/lib/account-init";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { releaseSlotHold } from "@/lib/slot-holds";
import { abandonDirectRequest, attachDirectRequest, prepareDirectRequest } from "@/lib/direct-request";
import { notifyWaitlistRemoved } from "@/lib/waitlist-offers";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import {
  WAITLIST_CONSENT_VERSION,
  WAITLIST_ENTRY_DAYS,
  WAITLIST_MAX_OPEN_PER_PROFESSIONAL,
  isWaitlistLeaveToken,
  isWaitlistOfferToken,
  waitlistShortName,
  waitlistStatusFields,
  type WaitlistErrorCode,
  type WaitlistJoinInput,
  type WaitlistModality,
  type WaitlistOfferOutcome,
  type WaitlistPeriod,
  type WaitlistRemovalReason,
  type WaitlistStatus,
  type WaitlistWeekday,
} from "@/lib/waitlist-rules";

/**
 * Joining, leaving and claiming a professional's waitlist (spec 003 phase 4),
 * and the lists the professional and the team see. Offers are made in
 * lib/waitlist-offers.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

/* ------------------------------------------------------------------------ */
/* Join and leave                                                             */
/* ------------------------------------------------------------------------ */

export type WaitlistJoinResult =
  | { ok: true; created: false; professionalId: string }
  | {
      ok: true;
      created: true;
      professionalId: string;
      professionalName: string;
      pageUrl: string;
      leaveUrl: string;
    }
  | { ok: false; status: 400 | 404 | 409; code: WaitlistErrorCode };

/**
 * Put a visitor on a published professional's waitlist. Joining twice is not
 * an error and changes nothing — the answer is the same, so the form cannot
 * tell whether someone else already waits under that address.
 */
export async function joinWaitlist(input: {
  slug: string;
  form: WaitlistJoinInput;
  ip: string;
  now?: Date;
}): Promise<WaitlistJoinResult> {
  const now = input.now ?? new Date();
  const { form } = input;
  if (!(await isShowcaseEnabled())) return { ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" };
  const bookable = await loadBookableShowcase(input.slug);
  if (!bookable) return { ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" };

  await connectToDatabase();
  if (form.motifs.length > 0) {
    const valid = await getValidMotifLabels();
    if (form.motifs.some((motif) => !valid.has(motif))) return { ok: false, status: 400, code: "INVALID_MOTIFS" };
  }

  const professionalId = bookable.professionalId;
  if (await WaitlistEntry.exists({ professionalId, email: form.email, isOpen: true })) {
    return { ok: true, created: false, professionalId };
  }
  if ((await WaitlistEntry.countDocuments({ professionalId, isOpen: true })) >= WAITLIST_MAX_OPEN_PER_PROFESSIONAL) {
    return { ok: false, status: 409, code: "WAITLIST_FULL" };
  }

  const leaveToken = generateUrlToken();
  try {
    await WaitlistEntry.create({
      professionalId,
      showcaseSlug: bookable.slug,
      cityKey: bookable.cityKey,
      professionalName: bookable.displayName,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      ...(form.phone ? { phone: form.phone } : {}),
      locale: form.locale,
      service: form.service,
      modality: form.modality,
      motifs: form.motifs,
      preferredPeriods: form.periods,
      preferredDays: form.days,
      consent: { at: now, version: WAITLIST_CONSENT_VERSION, ip: input.ip },
      smsConsent: form.smsConsent ? { given: true, at: now, version: WAITLIST_CONSENT_VERSION } : { given: false },
      ...waitlistStatusFields("active"),
      offers: [],
      missedOffers: 0,
      leaveTokenHash: hashVerificationSecret(leaveToken),
      expiresAt: new Date(now.getTime() + WAITLIST_ENTRY_DAYS * DAY_MS),
    });
  } catch (error) {
    if (isDuplicateKey(error)) return { ok: true, created: false, professionalId };
    throw error;
  }

  return {
    ok: true,
    created: true,
    professionalId,
    professionalName: bookable.displayName,
    pageUrl: absoluteShowcaseUrl(bookable.cityKey, `/${bookable.slug}`),
    leaveUrl: appUrl(`/liste-attente/quitter?t=${leaveToken}`),
  };
}

type ClosingRow = {
  _id: unknown;
  professionalId: unknown;
  firstName: string;
  email: string;
  locale?: string | null;
  professionalName: string;
  showcaseSlug: string;
  cityKey: string;
  offers?: { holdId: unknown; outcome: WaitlistOfferOutcome }[];
};

/**
 * Close an open entry and free the time of an offer still out. Never while
 * the person is claiming an offer: that finishes first.
 */
async function closeOpenEntry(
  filter: Record<string, unknown>,
  status: "left" | "removed",
  extra: Record<string, unknown>,
  now: Date,
): Promise<{ entry: ClosingRow; freedTime: boolean } | null> {
  await connectToDatabase();
  const before = await WaitlistEntry.findOneAndUpdate(
    { ...filter, isOpen: true, offers: { $not: { $elemMatch: { outcome: "claiming" } } } },
    { $set: { ...waitlistStatusFields(status), closedAt: now, ...extra, "offers.$[out].outcome": "withdrawn" } },
    { new: false, arrayFilters: [{ "out.outcome": "pending" }] },
  ).lean<ClosingRow | null>();
  if (!before) return null;
  const pending = (before.offers ?? []).filter((offer) => offer.outcome === "pending");
  for (const offer of pending) {
    await releaseSlotHold(String(offer.holdId), { waitlistEntryId: String(before._id), kind: "waitlist_offer" }).catch(
      (error) => console.error("[waitlist] hold not released on close:", error),
    );
  }
  return { entry: before, freedTime: pending.length > 0 };
}

/** The person left through the link in their email. Works even with the pages off. */
export async function leaveWaitlist(
  token: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; professionalId: string; freedTime: boolean } | { ok: false }> {
  if (!isWaitlistLeaveToken(token)) return { ok: false };
  const closed = await closeOpenEntry({ leaveTokenHash: hashVerificationSecret(token) }, "left", {}, now);
  return closed
    ? { ok: true, professionalId: String(closed.entry.professionalId), freedTime: closed.freedTime }
    : { ok: false };
}

/** The professional, or the team, removed someone from a list. The person is told. */
export async function removeWaitlistEntry(input: {
  entryId: string;
  by: Extract<WaitlistRemovalReason, "professional" | "admin">;
  /** Required when the professional removes: only their own list. */
  professionalId?: string;
  now?: Date;
}): Promise<{ ok: true; professionalId: string; freedTime: boolean } | { ok: false }> {
  if (!mongoose.Types.ObjectId.isValid(input.entryId)) return { ok: false };
  const filter: Record<string, unknown> = { _id: input.entryId };
  if (input.by === "professional") {
    if (!input.professionalId || !mongoose.Types.ObjectId.isValid(input.professionalId)) return { ok: false };
    filter.professionalId = input.professionalId;
  }
  const closed = await closeOpenEntry(filter, "removed", { removedReason: input.by }, input.now ?? new Date());
  if (!closed) return { ok: false };
  await notifyWaitlistRemoved(closed.entry as Parameters<typeof notifyWaitlistRemoved>[0], input.by);
  return { ok: true, professionalId: String(closed.entry.professionalId), freedTime: closed.freedTime };
}

/* ------------------------------------------------------------------------ */
/* Lists                                                                      */
/* ------------------------------------------------------------------------ */

type OfferRow = {
  dayKey: string;
  time: string;
  sentAt: Date;
  expiresAt: Date;
  outcome: WaitlistOfferOutcome;
  channels?: ("email" | "sms")[];
  appointmentId?: unknown;
};

type ListRow = {
  _id: unknown;
  professionalId: unknown;
  professionalName: string;
  showcaseSlug: string;
  cityKey: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  locale?: "fr" | "en";
  service: DirectRequestService;
  modality: WaitlistModality;
  motifs?: string[];
  preferredPeriods?: WaitlistPeriod[];
  preferredDays?: WaitlistWeekday[];
  consent: { at: Date; version: string };
  smsConsent?: { given?: boolean };
  status: WaitlistStatus;
  isOpen: boolean;
  offers?: OfferRow[];
  missedOffers?: number;
  removedReason?: WaitlistRemovalReason;
  expiresAt: Date;
  closedAt?: Date;
  createdAt: Date;
};

const LIST_FIELDS = [
  "professionalId professionalName showcaseSlug cityKey firstName lastName email phone locale service modality motifs",
  "preferredPeriods preferredDays consent.at consent.version smsConsent.given status isOpen missedOffers removedReason",
  "expiresAt closedAt createdAt offers.dayKey offers.time offers.sentAt offers.expiresAt offers.outcome offers.channels",
  "offers.appointmentId",
].join(" ");

function currentOffer(row: Pick<ListRow, "offers">): { dayKey: string; time: string; expiresAt: string } | null {
  const offer = (row.offers ?? []).find((item) => item.outcome === "pending" || item.outcome === "claiming");
  return offer ? { dayKey: offer.dayKey, time: offer.time, expiresAt: new Date(offer.expiresAt).toISOString() } : null;
}

export interface ProfessionalWaitlistRow {
  id: string;
  /** First name and initial only. */
  name: string;
  position: number;
  service: DirectRequestService;
  modality: WaitlistModality;
  motifs: string[];
  periods: WaitlistPeriod[];
  days: WaitlistWeekday[];
  joinedAt: string;
  expiresAt: string;
  offer: { dayKey: string; time: string; expiresAt: string } | null;
}

/** The people waiting for this professional, in queue order. No contact details. */
export async function listProfessionalWaitlist(professionalId: string): Promise<ProfessionalWaitlistRow[]> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return [];
  await connectToDatabase();
  const rows = await WaitlistEntry.find({ professionalId, isOpen: true })
    .sort({ createdAt: 1, _id: 1 })
    .select(LIST_FIELDS)
    .limit(WAITLIST_MAX_OPEN_PER_PROFESSIONAL)
    .lean<ListRow[]>();
  return rows.map((row, index) => ({
    id: String(row._id),
    name: waitlistShortName(row.firstName, row.lastName),
    position: index + 1,
    service: row.service,
    modality: row.modality,
    motifs: row.motifs ?? [],
    periods: row.preferredPeriods ?? [],
    days: row.preferredDays ?? [],
    joinedAt: new Date(row.createdAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    offer: currentOffer(row),
  }));
}

export type AdminWaitlistScope = "open" | "closed" | "all";

export interface AdminWaitlistRow extends Omit<ProfessionalWaitlistRow, "name" | "position"> {
  professionalId: string;
  professionalName: string;
  pageUrl: string;
  firstName: string;
  lastName: string;
  /** Null unless the admin may see patients' contact details. */
  email: string | null;
  phone: string | null;
  locale: "fr" | "en";
  status: WaitlistStatus;
  /** In the professional's queue, for an open entry. */
  position: number | null;
  removedReason: WaitlistRemovalReason | null;
  missedOffers: number;
  closedAt: string | null;
  consent: { at: string; version: string };
  smsConsent: boolean;
  offers: {
    dayKey: string;
    time: string;
    sentAt: string;
    expiresAt: string;
    outcome: WaitlistOfferOutcome;
    channels: ("email" | "sms")[];
    appointmentId: string | null;
  }[];
}

const ADMIN_LIST_LIMIT = 500;

export async function listAdminWaitlist(input: {
  scope: AdminWaitlistScope;
  showContact: boolean;
}): Promise<AdminWaitlistRow[]> {
  await connectToDatabase();
  const filter = input.scope === "all" ? {} : { isOpen: input.scope === "open" };
  const rows = await WaitlistEntry.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .select(LIST_FIELDS)
    .limit(ADMIN_LIST_LIMIT)
    .lean<ListRow[]>();

  // Queue positions, from the open entries of each professional.
  const openIds = [...new Set(rows.filter((row) => row.isOpen).map((row) => String(row.professionalId)))];
  const positions = new Map<string, number>();
  if (openIds.length > 0) {
    const queue = await WaitlistEntry.find({ professionalId: { $in: openIds }, isOpen: true })
      .sort({ createdAt: 1, _id: 1 })
      .select("_id professionalId")
      .lean<{ _id: unknown; professionalId: unknown }[]>();
    const counters = new Map<string, number>();
    for (const item of queue) {
      const key = String(item.professionalId);
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      positions.set(String(item._id), next);
    }
  }

  return rows.map((row) => ({
    id: String(row._id),
    professionalId: String(row.professionalId),
    professionalName: row.professionalName,
    pageUrl: absoluteShowcaseUrl(row.cityKey, `/${row.showcaseSlug}`),
    firstName: row.firstName,
    lastName: row.lastName,
    email: input.showContact ? row.email : null,
    phone: input.showContact ? (row.phone ?? null) : null,
    locale: row.locale === "en" ? "en" : "fr",
    service: row.service,
    modality: row.modality,
    motifs: row.motifs ?? [],
    periods: row.preferredPeriods ?? [],
    days: row.preferredDays ?? [],
    status: row.status,
    position: row.isOpen ? (positions.get(String(row._id)) ?? null) : null,
    removedReason: row.removedReason ?? null,
    missedOffers: row.missedOffers ?? 0,
    joinedAt: new Date(row.createdAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
    consent: { at: new Date(row.consent.at).toISOString(), version: row.consent.version },
    smsConsent: row.smsConsent?.given === true,
    offer: currentOffer(row),
    offers: (row.offers ?? []).map((offer) => ({
      dayKey: offer.dayKey,
      time: offer.time,
      sentAt: new Date(offer.sentAt).toISOString(),
      expiresAt: new Date(offer.expiresAt).toISOString(),
      outcome: offer.outcome,
      channels: offer.channels ?? [],
      appointmentId: offer.appointmentId ? String(offer.appointmentId) : null,
    })),
  }));
}

/* ------------------------------------------------------------------------ */
/* Claiming an offer                                                          */
/* ------------------------------------------------------------------------ */

export interface WaitlistOfferView {
  professionalName: string;
  service: DirectRequestService;
  dayKey: string;
  time: string;
  durationMinutes: number;
  expiresAt: string;
  price: number | null;
  pageUrl: string;
}

type OfferFailureCode = Extract<WaitlistErrorCode, "OFFER_INVALID" | "OFFER_EXPIRED" | "OFFER_CLAIMED">;

type ClaimRow = {
  _id: unknown;
  professionalId: unknown;
  professionalName: string;
  showcaseSlug: string;
  cityKey: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  locale?: "fr" | "en";
  service: DirectRequestService;
  modality: WaitlistModality;
  motifs?: string[];
  status: WaitlistStatus;
  offers: (OfferRow & { tokenHash: string; holdId: unknown; durationMinutes: number })[];
};

/** What the offer link shows. Reading it changes nothing, so a mail scanner opening it is harmless. */
export async function readWaitlistOffer(
  token: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; offer: WaitlistOfferView } | { ok: false; code: OfferFailureCode }> {
  if (!isWaitlistOfferToken(token)) return { ok: false, code: "OFFER_INVALID" };
  await connectToDatabase();
  const hash = hashVerificationSecret(token);
  const entry = await WaitlistEntry.findOne({ "offers.tokenHash": hash })
    .select("professionalId professionalName showcaseSlug cityKey service status offers")
    .lean<ClaimRow | null>();
  const offer = entry?.offers.find((item) => item.tokenHash === hash);
  if (!entry || !offer) return { ok: false, code: "OFFER_INVALID" };
  if (offer.outcome === "claimed" || offer.outcome === "claiming") return { ok: false, code: "OFFER_CLAIMED" };
  if (offer.outcome !== "pending" || entry.status !== "offered" || new Date(offer.expiresAt) <= now) {
    return { ok: false, code: "OFFER_EXPIRED" };
  }

  const bookable = await loadBookableShowcase(entry.showcaseSlug).catch(() => null);
  const samePro = bookable && bookable.professionalId === String(entry.professionalId);
  return {
    ok: true,
    offer: {
      professionalName: entry.professionalName,
      service: entry.service,
      dayKey: offer.dayKey,
      time: offer.time,
      durationMinutes: offer.durationMinutes,
      expiresAt: new Date(offer.expiresAt).toISOString(),
      price: samePro ? bookable.services[entry.service].price : null,
      pageUrl: absoluteShowcaseUrl(entry.cityKey, `/${entry.showcaseSlug}`),
    },
  };
}

async function findOrCreateClient(entry: ClaimRow): Promise<IUser> {
  const existing = await User.findOne({ email: entry.email });
  if (existing) return existing;
  try {
    const created = new User({
      email: entry.email,
      firstName: entry.firstName,
      lastName: entry.lastName,
      ...(entry.phone ? { phone: entry.phone } : {}),
      location: findShowcaseCity(entry.cityKey)?.name,
      role: "prospect",
      status: "active",
      language: entry.locale === "en" ? "en" : "fr",
      preferredPaymentMethod: "interac",
    });
    await created.save();
    return created;
  } catch (error) {
    const again = await User.findOne({ email: entry.email });
    if (again) return again;
    throw error;
  }
}

export type WaitlistClaimResult =
  | { ok: true; appointmentId: string; professionalName: string; dayKey: string; time: string; respondBy: Date }
  | { ok: false; status: 404 | 409 | 410; code: WaitlistErrorCode };

/**
 * The person confirmed an offered time. The offer moves from pending to
 * claiming in one atomic step (a second press, or the expiry job, loses), the
 * person's account is found or created by email, and the offer's hold becomes
 * a direct request to the professional (phase 3): proposed to them alone,
 * answered within the usual deadline. The route sends the emails.
 *
 * If the time can no longer be requested — the professional changed their
 * hours, or unpublished — the person keeps their place without a miss.
 */
export async function claimWaitlistOffer(token: unknown, now: Date = new Date()): Promise<WaitlistClaimResult> {
  if (!isWaitlistOfferToken(token)) return { ok: false, status: 410, code: "OFFER_INVALID" };
  if (!(await isShowcaseEnabled())) return { ok: false, status: 404, code: "SHOWCASE_NOT_FOUND" };
  await connectToDatabase();
  const hash = hashVerificationSecret(token);

  const entry = await WaitlistEntry.findOneAndUpdate(
    { status: "offered", offers: { $elemMatch: { tokenHash: hash, outcome: "pending", expiresAt: { $gt: now } } } },
    { $set: { "offers.$.outcome": "claiming", "offers.$.claimingAt": now } },
    { new: true },
  ).lean<ClaimRow | null>();
  if (!entry) {
    const read = await readWaitlistOffer(token, now);
    return { ok: false, status: 410, code: read.ok ? "OFFER_EXPIRED" : read.code };
  }
  const offer = entry.offers.find((item) => item.tokenHash === hash);
  if (!offer) return { ok: false, status: 410, code: "OFFER_INVALID" };
  const entryId = String(entry._id);
  const holdId = String(offer.holdId);
  const claimingFilter = { _id: entryId, offers: { $elemMatch: { tokenHash: hash, outcome: "claiming" } } };

  const giveBack = async () => {
    await WaitlistEntry.updateOne(claimingFilter, {
      $set: { "offers.$.outcome": "slot_lost", ...waitlistStatusFields("active") },
    });
    await releaseSlotHold(holdId, { waitlistEntryId: entryId, kind: "waitlist_offer" }).catch((error) =>
      console.error("[waitlist] hold not released after a failed claim:", error),
    );
  };

  let client: IUser;
  try {
    client = await findOrCreateClient(entry);
  } catch (error) {
    await giveBack();
    throw error;
  }

  const page = await ShowcasePage.findOne({ userId: entry.professionalId, status: "published" })
    .select("slug")
    .lean<{ slug: string } | null>();
  const prepared = page
    ? await prepareDirectRequest({
        intent: { slug: page.slug, service: entry.service, date: offer.dayKey, time: offer.time },
        therapyType: "solo",
        now,
        waitlist: { entryId, holdId },
      })
    : null;
  if (!prepared?.ok) {
    await giveBack();
    return { ok: false, status: 409, code: "OFFER_UNAVAILABLE" };
  }

  const appointment = new Appointment({
    clientId: client._id,
    type: entry.modality,
    bookingFor: "self",
    needs: entry.motifs ?? [],
    payment: {
      price: prepared.pricing.sessionPrice,
      platformFee: prepared.pricing.platformFee,
      professionalPayout: prepared.pricing.professionalPayout,
      status: "pending",
      method: "card",
    },
    ...prepared.fields,
  });
  try {
    await appointment.save();
  } catch (error) {
    await abandonDirectRequest(prepared);
    await giveBack();
    throw error;
  }
  const appointmentId = String(appointment._id);
  await attachDirectRequest(prepared, appointmentId);

  const converted = await WaitlistEntry.updateOne(claimingFilter, {
    $set: {
      "offers.$.outcome": "claimed",
      "offers.$.appointmentId": appointment._id,
      ...waitlistStatusFields("converted"),
      closedAt: now,
      userId: client._id,
    },
  });
  if (converted.modifiedCount !== 1) {
    // The stale-claim recovery finds the request and marks the entry converted.
    console.error("[waitlist] claimed entry not marked converted:", entryId);
  }

  return {
    ok: true,
    appointmentId,
    professionalName: prepared.fields.directRequest.professionalName,
    dayKey: offer.dayKey,
    time: offer.time,
    respondBy: prepared.fields.directRequest.respondBy,
  };
}
