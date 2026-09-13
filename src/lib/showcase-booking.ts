import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ShowcasePage from "@/models/ShowcasePage";
import User from "@/models/User";
import Profile from "@/models/Profile";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { quickConsultationMinutes } from "@/lib/professional-pricing";
import { isShowcaseCityKey } from "@/lib/showcase-cities";
import { showcaseServiceOffered, type ShowcaseServiceSwitches } from "@/lib/showcase-public";
import {
  addDays,
  computeFreeSlots,
  daysBetween,
  isDayKey,
  isSlotTime,
  slotGridOf,
  torontoDayKey,
  type WeeklyAvailability,
} from "@/lib/available-slots";
import { loadOccupiedIntervals } from "@/lib/slot-occupancy";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import {
  SHOWCASE_SLOT_HORIZON_DAYS,
  SHOWCASE_SLOT_LEAD_MINUTES,
  SHOWCASE_SLOT_WINDOW_DAYS,
  type ShowcaseSlotsResponse,
} from "@/lib/showcase-booking-types";

/**
 * A published page as something one can book (spec 003 phase 3): the
 * professional, the consultations open right now with their length and price,
 * and the professional's free times. Internal — the professional's id never
 * leaves the server; the public routes answer with ShowcaseSlotsResponse.
 */

export interface BookableService {
  offered: boolean;
  durationMinutes: number;
  /** What the client pays, or null when no usable price came out of the rules. */
  price: number | null;
}

export interface BookableShowcase {
  pageId: string;
  professionalId: string;
  slug: string;
  cityKey: string;
  displayName: string;
  availability: WeeklyAvailability | null;
  services: Record<DirectRequestService, BookableService>;
}

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type PageRow = {
  _id: unknown;
  userId: unknown;
  slug: string;
  cityKey: string;
  services?: ShowcaseServiceSwitches;
  published?: { displayName?: string | null } | null;
};

type ProfileRow = {
  availability?: WeeklyAvailability | null;
  acceptingNewClients?: boolean | null;
  acceptingEmergencyConsultations?: boolean | null;
  quickConsultation?: { durationMinutes?: number | null } | null;
};

function usablePrice(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A published page of an active professional, in a city of the registry; null otherwise. */
export async function loadBookableShowcase(slug: string): Promise<BookableShowcase | null> {
  if (typeof slug !== "string" || !SLUG_FORMAT.test(slug)) return null;
  await connectToDatabase();
  const page = (await ShowcasePage.findOne({ slug, status: "published" })
    .select("_id userId slug cityKey services published.displayName")
    .lean()) as unknown as PageRow | null;
  if (!page?.published || !isShowcaseCityKey(page.cityKey)) return null;
  const professionalId = String(page.userId);
  if (!mongoose.Types.ObjectId.isValid(professionalId)) return null;

  const [user, profile] = await Promise.all([
    User.findOne({ _id: professionalId, role: "professional", status: "active" })
      .select("firstName lastName")
      .lean(),
    Profile.findOne({ userId: professionalId })
      .select("availability acceptingNewClients acceptingEmergencyConsultations quickConsultation")
      .lean() as unknown as Promise<ProfileRow | null>,
  ]);
  if (!user) return null;

  const [standardPricing, quickPricing] = await Promise.all([
    calculateAppointmentPricing(professionalId, "solo"),
    calculateAppointmentPricing(professionalId, "solo", { quick: true }),
  ]);

  return {
    pageId: String(page._id),
    professionalId,
    slug: page.slug,
    cityKey: page.cityKey,
    displayName:
      page.published.displayName?.trim() || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    availability: profile?.availability ?? null,
    services: {
      standard: {
        offered: showcaseServiceOffered("standard", page.services, profile),
        durationMinutes: slotGridOf(profile?.availability).sessionMinutes,
        price: usablePrice(standardPricing.sessionPrice),
      },
      quick: {
        offered: showcaseServiceOffered("quick", page.services, profile),
        durationMinutes: quickConsultationMinutes(profile?.quickConsultation?.durationMinutes),
        price: usablePrice(quickPricing.sessionPrice),
      },
    },
  };
}

/**
 * One window of free times for a consultation: SHOWCASE_SLOT_WINDOW_DAYS from
 * `from` (today at the earliest), never past the horizon. Only days with a free
 * time are listed; nothing is read for a consultation that is not offered.
 */
export async function listShowcaseSlots(
  bookable: BookableShowcase,
  service: DirectRequestService,
  from: string | null,
  now: Date = new Date(),
): Promise<ShowcaseSlotsResponse> {
  const offer = bookable.services[service];
  const today = torontoDayKey(now);
  const lastDay = addDays(today, SHOWCASE_SLOT_HORIZON_DAYS - 1);
  const firstDay = from && isDayKey(from) && from > today ? from : today;
  const base = {
    service,
    available: offer.offered,
    durationMinutes: offer.durationMinutes,
    price: offer.price,
  };
  if (!offer.offered || firstDay > lastDay) return { ...base, days: [], nextFrom: null };

  const windowLast = addDays(firstDay, SHOWCASE_SLOT_WINDOW_DAYS - 1);
  const windowEnd = windowLast < lastDay ? windowLast : lastDay;
  const busy = await loadOccupiedIntervals({
    professionalId: bookable.professionalId,
    fromDay: firstDay,
    toDay: windowEnd,
    now,
  });
  const days = computeFreeSlots({
    availability: bookable.availability,
    fromDay: firstDay,
    days: daysBetween(firstDay, windowEnd) + 1,
    now,
    minLeadMinutes: SHOWCASE_SLOT_LEAD_MINUTES,
    durationMinutes: offer.durationMinutes,
    busy,
  });
  const next = addDays(windowEnd, 1);
  return {
    ...base,
    days: days.filter((day) => day.slots.length > 0),
    nextFrom: next <= lastDay ? next : null,
  };
}

/**
 * Whether a time can still be requested: offered, on the grid, within the lead
 * time and the horizon, and overlapping nothing busy. The booking intake
 * re-checks the visitor's choice with this before it holds the slot.
 */
export async function isShowcaseSlotFree(
  bookable: BookableShowcase,
  service: DirectRequestService,
  dayKey: string,
  time: string,
  now: Date = new Date(),
): Promise<boolean> {
  const offer = bookable.services[service];
  if (!offer.offered || !isDayKey(dayKey) || !isSlotTime(time)) return false;
  const today = torontoDayKey(now);
  if (dayKey < today || dayKey > addDays(today, SHOWCASE_SLOT_HORIZON_DAYS - 1)) return false;
  const busy = await loadOccupiedIntervals({
    professionalId: bookable.professionalId,
    fromDay: dayKey,
    toDay: dayKey,
    now,
  });
  const [day] = computeFreeSlots({
    availability: bookable.availability,
    fromDay: dayKey,
    days: 1,
    now,
    minLeadMinutes: SHOWCASE_SLOT_LEAD_MINUTES,
    durationMinutes: offer.durationMinutes,
    busy,
  });
  return day?.slots.includes(time) ?? false;
}
