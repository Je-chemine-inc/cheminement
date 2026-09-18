import type { DirectRequestService } from "@/lib/direct-request-rules";
import type { ShowcasePublicProfile } from "@/lib/showcase-public";

/**
 * The public booking contract of a showcase page (spec 003 phase 3), shared by
 * the routes and the components that call them. Client-safe.
 */

/** The anchor of a page's free times; the page's booking buttons lead there. */
export const SHOWCASE_SLOTS_ANCHOR = "disponibilites";

/** Days shown at a time. */
export const SHOWCASE_SLOT_WINDOW_DAYS = 14;
/** How far ahead a page offers times, today included. */
export const SHOWCASE_SLOT_HORIZON_DAYS = 42;
/** Nothing is offered sooner than this: the professional needs time to answer. */
export const SHOWCASE_SLOT_LEAD_MINUTES = 120;

export interface ShowcaseSlotDay {
  /** Montréal calendar day, "YYYY-MM-DD". */
  day: string;
  /** Start times that day, "HH:mm", Montréal wall clock. */
  slots: string[];
}

/** GET /api/showcase/<slug>/slots?service=&from= */
export interface ShowcaseSlotsResponse {
  service: DirectRequestService;
  /** False when the professional has not switched this consultation on for their page. */
  available: boolean;
  durationMinutes: number;
  /** What the client pays, or null when the price is set at confirmation. */
  price: number | null;
  /** Days with at least one free time, in order. */
  days: ShowcaseSlotDay[];
  /** First day of the next window, or null at the end of what is bookable. */
  nextFrom: string | null;
}

/** A consultation a page can offer a time for, as its « Disponibilités » section lists it. */
export interface ShowcaseBookingOption {
  service: DirectRequestService;
  minutes: number;
  /** What the client pays, or null when the price is set at confirmation. */
  price: number | null;
  /** Its first free time: Montréal day "YYYY-MM-DD" and wall-clock "HH:mm". */
  first: { day: string; time: string };
}

/** GET /api/showcase/<slug>/summary — what the booking funnel shows about the professional. */
export interface ShowcaseBookingSummary {
  slug: string;
  url: string;
  displayName: string;
  title: ShowcasePublicProfile["title"];
  photoUrl: string | null;
  city: { key: string; name: string };
  services: ShowcasePublicProfile["services"];
}
