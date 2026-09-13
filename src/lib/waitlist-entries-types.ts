import type { DirectRequestService } from "@/lib/direct-request-rules";

/**
 * What a waitlist offer link shows (spec 003 phase 4). Client-safe: the claim
 * page imports it, and a client component must not import the server library.
 */
export interface WaitlistOfferView {
  professionalName: string;
  service: DirectRequestService;
  /** Montréal calendar day and wall-clock start. */
  dayKey: string;
  time: string;
  durationMinutes: number;
  /** Until when the time is held, ISO. */
  expiresAt: string;
  /** What the person would pay, or null when no usable price exists. */
  price: number | null;
  pageUrl: string;
}
