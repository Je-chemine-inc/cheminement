import "server-only";
import crypto from "crypto";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import WaitlistEntry from "@/models/WaitlistEntry";
import ShowcasePage from "@/models/ShowcasePage";
import Appointment from "@/models/Appointment";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { listShowcaseSlots, loadBookableShowcase, type BookableShowcase } from "@/lib/showcase-booking";
import { SHOWCASE_SLOT_LEAD_MINUTES } from "@/lib/showcase-booking-types";
import { slotStartsAt } from "@/lib/available-slots";
import { acquireSlotHold, releaseSlotHold } from "@/lib/slot-holds";
import { hashVerificationSecret } from "@/lib/account-init";
import { showcasePageUrl } from "@/lib/showcase-hosts";
import { runDirectRequestTimeouts } from "@/lib/direct-request";
import { purgeClosedWaitlistEntries } from "@/lib/data-lifecycle";
import { sendSms } from "@/lib/sms";
import { sendWaitlistOfferEmail, sendWaitlistRemovedEmail } from "@/lib/notifications";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import {
  WAITLIST_MAX_MISSED_OFFERS,
  WAITLIST_MAX_OPEN_PER_PROFESSIONAL,
  WAITLIST_OFFER_MINUTES,
  isWaitlistQuietHours,
  pickOffers,
  waitlistOfferSms,
  waitlistSlotKey,
  waitlistStatusFields,
  type WaitlistPeriod,
  type WaitlistRemovalReason,
  type WaitlistSlot,
  type WaitlistWeekday,
} from "@/lib/waitlist-rules";

/**
 * Offering freed times to the people on a professional's waitlist (spec 003
 * phase 4).
 *
 * An offer holds the time for WAITLIST_OFFER_MINUTES with a `waitlist_offer`
 * hold — taken BEFORE the entry is claimed, so a time is never offered to two
 * people — then emails the person, and texts them only if they consented to
 * it. Claiming it turns the hold into a direct request (lib/waitlist-entries).
 *
 * Everything runs from runWaitlistOffers (the cron every two minutes and the
 * lazy trigger) and from notifySlotFreed (a route just freed a time). Every
 * step is an atomic claim, so overlapping runs are harmless. With the pages
 * off, no new offer is made, but offers and entries still expire.
 */

const MINUTE_MS = 60 * 1000;
/** A claim that has not finished after this long crashed half-way and is recovered. */
const STALE_CLAIM_MINUTES = 10;
const BATCH = 200;

export function generateWaitlistOfferToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}

async function settle(label: string, tasks: Promise<unknown>[]): Promise<void> {
  for (const result of await Promise.allSettled(tasks)) {
    if (result.status === "rejected") console.error(`[waitlist] ${label} failed:`, result.reason);
  }
}

type QueueRow = {
  _id: unknown;
  service: DirectRequestService;
  preferredPeriods?: WaitlistPeriod[];
  preferredDays?: WaitlistWeekday[];
  offers?: { dayKey: string; time: string }[];
};

type ContactRow = {
  _id: unknown;
  firstName: string;
  email: string;
  phone?: string | null;
  locale?: string | null;
  smsConsent?: { given?: boolean } | null;
  professionalName: string;
  showcaseSlug: string;
  cityKey: string;
};

const CONTACT_FIELDS = "firstName email phone locale smsConsent professionalName showcaseSlug cityKey";

/** The free times worth offering: the next two weeks, far enough ahead to be requested once claimed. */
async function offerableSlots(
  bookable: BookableShowcase,
  services: DirectRequestService[],
  now: Date,
): Promise<WaitlistSlot[]> {
  const earliest = now.getTime() + (SHOWCASE_SLOT_LEAD_MINUTES + WAITLIST_OFFER_MINUTES) * MINUTE_MS;
  const slots: WaitlistSlot[] = [];
  for (const service of services) {
    if (!bookable.services[service].offered) continue;
    const window = await listShowcaseSlots(bookable, service, null, now);
    for (const day of window.days) {
      for (const time of day.slots) {
        const startsAt = slotStartsAt(day.day, time);
        if (startsAt && startsAt.getTime() >= earliest) {
          slots.push({ service, dayKey: day.day, time, durationMinutes: window.durationMinutes });
        }
      }
    }
  }
  return slots;
}

/** Offer one time to one waiting person. False when the time or the person was taken meanwhile. */
export async function offerSlotToEntry(input: {
  entryId: string;
  bookable: BookableShowcase;
  slot: WaitlistSlot;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const { bookable, slot, entryId } = input;
  const startsAt = slotStartsAt(slot.dayKey, slot.time);
  if (!startsAt || !mongoose.Types.ObjectId.isValid(entryId)) return false;
  await connectToDatabase();

  const entry = await WaitlistEntry.findOne({ _id: entryId, professionalId: bookable.professionalId, status: "active" })
    .select(CONTACT_FIELDS)
    .lean<ContactRow | null>();
  if (!entry) return false;

  const expiresAt = new Date(now.getTime() + WAITLIST_OFFER_MINUTES * MINUTE_MS);
  const hold = await acquireSlotHold({
    professionalId: bookable.professionalId,
    dayKey: slot.dayKey,
    time: slot.time,
    startsAt,
    durationMinutes: slot.durationMinutes,
    kind: "waitlist_offer",
    expiresAt,
    waitlistEntryId: entryId,
    now,
  });
  if (!hold.ok) return false;

  const token = generateWaitlistOfferToken();
  const sms = entry.smsConsent?.given === true && Boolean(entry.phone);
  const claimed = await WaitlistEntry.updateOne(
    { _id: entryId, status: "active" },
    {
      $set: waitlistStatusFields("offered"),
      $push: {
        offers: {
          dayKey: slot.dayKey,
          time: slot.time,
          startsAt,
          durationMinutes: slot.durationMinutes,
          holdId: new mongoose.Types.ObjectId(hold.holdId),
          tokenHash: hashVerificationSecret(token),
          sentAt: now,
          expiresAt,
          channels: sms ? ["email", "sms"] : ["email"],
          outcome: "pending",
        },
      },
    },
  );
  if (claimed.modifiedCount !== 1) {
    await releaseSlotHold(hold.holdId, { waitlistEntryId: entryId, kind: "waitlist_offer" }).catch((error) =>
      console.error("[waitlist] offer hold not released:", error),
    );
    return false;
  }

  const lang = entry.locale === "en" ? "en" : "fr";
  const tasks: Promise<unknown>[] = [
    sendWaitlistOfferEmail({
      firstName: entry.firstName,
      email: entry.email,
      professionalName: bookable.displayName,
      service: slot.service,
      dayKey: slot.dayKey,
      time: slot.time,
      durationMinutes: slot.durationMinutes,
      expiresAt,
      claimUrl: appUrl(`/liste-attente/reclamer?t=${token}`),
      locale: lang,
    }),
  ];
  if (sms && entry.phone) {
    tasks.push(
      sendSms(
        entry.phone,
        waitlistOfferSms({
          lang,
          professionalName: bookable.displayName,
          dayKey: slot.dayKey,
          time: slot.time,
          url: appUrl(`/la/${token}`),
        }),
      ),
    );
  }
  await settle("offer message", tasks);
  return true;
}

/**
 * Offer a professional's free times to the people waiting for them, in queue
 * order (see pickOffers). Nothing happens unless the page is published and
 * the pages are on.
 */
export async function offerFreeSlotsForProfessional(
  professionalId: string,
  now: Date = new Date(),
): Promise<{ offered: number }> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return { offered: 0 };
  if (!(await isShowcaseEnabled())) return { offered: 0 };
  // At night the times stay free; the job offers them from 8 h.
  if (isWaitlistQuietHours(now)) return { offered: 0 };
  await connectToDatabase();

  const queue = await WaitlistEntry.find({ professionalId, status: "active" })
    .sort({ createdAt: 1, _id: 1 })
    .select("_id service preferredPeriods preferredDays offers.dayKey offers.time")
    .limit(WAITLIST_MAX_OPEN_PER_PROFESSIONAL)
    .lean<QueueRow[]>();
  if (queue.length === 0) return { offered: 0 };

  const page = await ShowcasePage.findOne({ userId: professionalId, status: "published" })
    .select("slug")
    .lean<{ slug: string } | null>();
  const bookable = page ? await loadBookableShowcase(page.slug) : null;
  if (!bookable) return { offered: 0 };

  const services = [...new Set(queue.map((row) => row.service))];
  const slots = await offerableSlots(bookable, services, now);
  const picks = pickOffers(
    queue.map((row) => ({
      id: String(row._id),
      service: row.service,
      periods: row.preferredPeriods ?? [],
      days: row.preferredDays ?? [],
      offeredSlotKeys: (row.offers ?? []).map(waitlistSlotKey),
    })),
    slots,
  );

  let offered = 0;
  for (const pick of picks) {
    if (await offerSlotToEntry({ entryId: pick.entryId, bookable, slot: pick.slot, now })) offered++;
  }
  return { offered };
}

/** A route freed a professional's time: offer it at once rather than at the next run. */
export async function notifySlotFreed(professionalId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return;
  if (!(await isShowcaseEnabled())) return;
  await connectToDatabase();
  if (!(await WaitlistEntry.exists({ professionalId, status: "active" }))) return;
  await offerFreeSlotsForProfessional(professionalId);
}

export async function notifyWaitlistRemoved(entry: ContactRow, reason: WaitlistRemovalReason): Promise<void> {
  await settle("removal email", [
    sendWaitlistRemovedEmail({
      firstName: entry.firstName,
      email: entry.email,
      professionalName: entry.professionalName,
      reason,
      pageUrl: showcasePageUrl(entry.showcaseSlug),
      locale: entry.locale,
    }),
  ]);
}

type OfferedRow = ContactRow & {
  missedOffers?: number;
  offers: { tokenHash: string; holdId: unknown; outcome: string; expiresAt: Date; claimingAt?: Date }[];
};

/**
 * Offers nobody answered within 15 minutes: the time is freed, the person
 * keeps their place and counts a miss; the third miss ends their place.
 */
export async function expireWaitlistOffers(now: Date = new Date()): Promise<{ expired: number; removed: number }> {
  await connectToDatabase();
  const due = await WaitlistEntry.find({
    status: "offered",
    offers: { $elemMatch: { outcome: "pending", expiresAt: { $lte: now } } },
  })
    .select(`_id missedOffers offers.tokenHash offers.holdId offers.outcome offers.expiresAt ${CONTACT_FIELDS}`)
    .limit(BATCH)
    .lean<OfferedRow[]>();

  let expired = 0;
  let removed = 0;
  for (const row of due) {
    const offer = row.offers.find((item) => item.outcome === "pending" && new Date(item.expiresAt) <= now);
    if (!offer) continue;
    const final = (row.missedOffers ?? 0) + 1 >= WAITLIST_MAX_MISSED_OFFERS;
    const set: Record<string, unknown> = {
      "offers.$.outcome": "expired",
      ...waitlistStatusFields(final ? "expired" : "active"),
    };
    if (final) {
      set.removedReason = "missed";
      set.closedAt = now;
    }
    const res = await WaitlistEntry.updateOne(
      { _id: row._id, status: "offered", offers: { $elemMatch: { tokenHash: offer.tokenHash, outcome: "pending" } } },
      { $set: set, $inc: { missedOffers: 1 } },
    );
    if (res.modifiedCount !== 1) continue;
    expired++;
    await releaseSlotHold(String(offer.holdId), { waitlistEntryId: String(row._id), kind: "waitlist_offer" }).catch(
      (error) => console.error("[waitlist] expired offer hold not released:", error),
    );
    if (final) {
      removed++;
      await notifyWaitlistRemoved(row, "missed");
    }
  }
  return { expired, removed };
}

/**
 * A claim that crashed half-way: if its request was saved, the entry is
 * marked converted; otherwise the person gets their place back (not counted
 * as a miss) and the time is freed.
 */
export async function recoverStaleWaitlistClaims(now: Date = new Date()): Promise<{ recovered: number }> {
  await connectToDatabase();
  const stale = new Date(now.getTime() - STALE_CLAIM_MINUTES * MINUTE_MS);
  const rows = await WaitlistEntry.find({
    status: "offered",
    offers: { $elemMatch: { outcome: "claiming", claimingAt: { $lte: stale } } },
  })
    .select("_id offers.tokenHash offers.holdId offers.outcome offers.claimingAt")
    .limit(BATCH)
    .lean<Pick<OfferedRow, "_id" | "offers">[]>();

  let recovered = 0;
  for (const row of rows) {
    const offer = row.offers.find((item) => item.outcome === "claiming");
    if (!offer) continue;
    const filter = { _id: row._id, offers: { $elemMatch: { tokenHash: offer.tokenHash, outcome: "claiming" } } };
    const request = await Appointment.findOne({
      "directRequest.waitlistEntryId": row._id,
      "directRequest.holdId": offer.holdId,
    })
      .select("_id clientId")
      .lean<{ _id: unknown; clientId?: unknown } | null>();
    const res = request
      ? await WaitlistEntry.updateOne(filter, {
          $set: {
            "offers.$.outcome": "claimed",
            "offers.$.appointmentId": request._id,
            ...waitlistStatusFields("converted"),
            closedAt: now,
            ...(request.clientId ? { userId: request.clientId } : {}),
          },
        })
      : await WaitlistEntry.updateOne(filter, {
          $set: { "offers.$.outcome": "slot_lost", ...waitlistStatusFields("active") },
        });
    if (res.modifiedCount !== 1) continue;
    recovered++;
    if (!request) {
      await releaseSlotHold(String(offer.holdId), { waitlistEntryId: String(row._id), kind: "waitlist_offer" }).catch(
        (error) => console.error("[waitlist] stale claim hold not released:", error),
      );
    }
  }
  return { recovered };
}

/** Places still waiting 90 days after joining end. An entry with an offer out waits for the offer first. */
export async function expireWaitlistEntries(now: Date = new Date()): Promise<{ expired: number }> {
  await connectToDatabase();
  const due = await WaitlistEntry.find({ status: "active", expiresAt: { $lte: now } })
    .select(`_id ${CONTACT_FIELDS}`)
    .limit(BATCH)
    .lean<ContactRow[]>();
  let expired = 0;
  for (const row of due) {
    const res = await WaitlistEntry.updateOne(
      { _id: row._id, status: "active" },
      { $set: { ...waitlistStatusFields("expired"), removedReason: "expired", closedAt: now } },
    );
    if (res.modifiedCount !== 1) continue;
    expired++;
    await notifyWaitlistRemoved(row, "expired");
  }
  return { expired };
}

export interface WaitlistRunResult {
  directExpired: number;
  claimsRecovered: number;
  offersExpired: number;
  removedAfterMisses: number;
  entriesExpired: number;
  purged: number;
  offered: number;
}

/**
 * The waitlist job, every two minutes. It also expires direct requests past
 * their deadline, so a declined time reaches the waitlist quickly. Each step
 * runs even if an earlier one failed.
 */
export async function runWaitlistOffers(now: Date = new Date()): Promise<WaitlistRunResult> {
  const result: WaitlistRunResult = {
    directExpired: 0,
    claimsRecovered: 0,
    offersExpired: 0,
    removedAfterMisses: 0,
    entriesExpired: 0,
    purged: 0,
    offered: 0,
  };
  const step = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[waitlist] ${label} failed:`, error);
    }
  };

  await step("direct request timeouts", async () => {
    result.directExpired = (await runDirectRequestTimeouts(now)).expired;
  });
  await step("stale claims", async () => {
    result.claimsRecovered = (await recoverStaleWaitlistClaims(now)).recovered;
  });
  await step("offer expiry", async () => {
    const expired = await expireWaitlistOffers(now);
    result.offersExpired = expired.expired;
    result.removedAfterMisses = expired.removed;
  });
  await step("entry expiry", async () => {
    result.entriesExpired = (await expireWaitlistEntries(now)).expired;
  });
  await step("purge", async () => {
    result.purged = await purgeClosedWaitlistEntries(now);
  });

  if (!(await isShowcaseEnabled())) return result;
  await connectToDatabase();
  const professionals = (await WaitlistEntry.distinct("professionalId", { status: "active" })).slice(0, BATCH);
  for (const professionalId of professionals) {
    await step("offers", async () => {
      result.offered += (await offerFreeSlotsForProfessional(String(professionalId), now)).offered;
    });
  }
  return result;
}
