import { randomBytes } from "crypto";

/**
 * Helpers for the professional calendar-sync (iCal subscription) feature.
 *
 * The feed is authenticated only by a long unguessable token embedded in the
 * URL (calendar apps cannot carry a session), so the token must be high-entropy
 * and rotatable. 32 random bytes → 43-char URL-safe string.
 */
export function generateCalendarFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Absolute subscription URLs for a token: https:// (fetch) + webcal:// (one-tap add). */
export function buildCalendarFeedUrls(token: string): {
  url: string;
  webcalUrl: string;
} {
  const base = (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const url = `${base}/api/calendar/${token}`;
  const webcalUrl = url.replace(/^https?:\/\//, "webcal://");
  return { url, webcalUrl };
}
