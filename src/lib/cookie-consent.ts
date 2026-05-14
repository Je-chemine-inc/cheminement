/**
 * Law 25 (Quebec) cookie consent.
 *
 * - Stored as a first-party cookie so the choice survives a session refresh
 *   and is shared across tabs. Cookie-based storage matches the user's
 *   intuition that clearing "navigation data" (cookies) resets the choice.
 * - Lives for 6 months by default. After that, the banner re-prompts.
 * - The `version` field lets us re-prompt every user if the policy materially
 *   changes — bump COOKIE_CONSENT_VERSION and existing decisions are ignored.
 *
 * Essential cookies / scripts (NextAuth session, locale, theme, Stripe.js on
 * payment pages) are NEVER gated by this value — they're required for the
 * service to function. Only tracking and marketing scripts should check
 * `hasConsent("statistics")` or `hasConsent("marketing")` before firing.
 */

import { useEffect, useState } from "react";

/**
 * Browser event dispatched whenever the consent record is updated via
 * `writeCookieConsent`. Components that need to react in-session (e.g. to
 * load Google Analytics the moment statistics consent is granted) can
 * listen to this event without polling.
 */
export const COOKIE_CONSENT_EVENT = "cookie-consent:changed";

export const COOKIE_CONSENT_NAME = "cc_consent";
export const COOKIE_CONSENT_VERSION = "v1";
export const COOKIE_CONSENT_MAX_AGE_DAYS = 180; // 6 months

/** Cookie categories the banner can toggle. Essential is always granted. */
export type CookieCategory = "statistics" | "marketing";

export interface CookieConsentCategories {
  statistics: boolean;
  marketing: boolean;
}

export interface CookieConsentRecord {
  categories: CookieConsentCategories;
  version: string;
  decidedAt: string;
}

export const ACCEPT_ALL: CookieConsentCategories = {
  statistics: true,
  marketing: true,
};

export const REFUSE_NON_ESSENTIAL: CookieConsentCategories = {
  statistics: false,
  marketing: false,
};

function parseConsent(raw: string | undefined | null): CookieConsentRecord | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<CookieConsentRecord>;
    if (
      parsed.categories &&
      typeof parsed.categories.statistics === "boolean" &&
      typeof parsed.categories.marketing === "boolean" &&
      typeof parsed.version === "string" &&
      typeof parsed.decidedAt === "string"
    ) {
      return parsed as CookieConsentRecord;
    }
  } catch {
    /* malformed — treat as no decision */
  }
  return null;
}

/** Read the consent cookie from `document.cookie` (client only). */
export function readCookieConsent(): CookieConsentRecord | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${COOKIE_CONSENT_NAME}=`));
  if (!match) return null;
  const value = match.slice(COOKIE_CONSENT_NAME.length + 1);
  const record = parseConsent(value);
  if (!record) return null;
  // Treat decisions made against an older version as no decision.
  if (record.version !== COOKIE_CONSENT_VERSION) return null;
  return record;
}

/** Write the consent cookie. Returns the record that was stored. */
export function writeCookieConsent(
  categories: CookieConsentCategories,
): CookieConsentRecord {
  const record: CookieConsentRecord = {
    categories: { ...categories },
    version: COOKIE_CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
  };
  if (typeof document !== "undefined") {
    const maxAgeSeconds = COOKIE_CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
    const value = encodeURIComponent(JSON.stringify(record));
    const secure =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "; Secure"
        : "";
    document.cookie = `${COOKIE_CONSENT_NAME}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
    window.dispatchEvent(
      new CustomEvent<CookieConsentRecord>(COOKIE_CONSENT_EVENT, {
        detail: record,
      }),
    );
  }
  return record;
}

/**
 * React hook that returns the current consent record and re-renders whenever
 * the user updates their choice via the banner. Returns `null` when the user
 * has not yet decided.
 */
export function useCookieConsent(): CookieConsentRecord | null {
  const [record, setRecord] = useState<CookieConsentRecord | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(readCookieConsent());
    const handler = () => setRecord(readCookieConsent());
    window.addEventListener(COOKIE_CONSENT_EVENT, handler);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, handler);
  }, []);

  return record;
}

/**
 * Did the user opt in to a specific cookie category?
 *
 * Use this gate before initialising any analytics, marketing, or tracking
 * library. Returns `false` when no decision has been made yet — i.e. consent
 * is opt-in (Law 25 default).
 */
export function hasConsent(category: CookieCategory): boolean {
  const record = readCookieConsent();
  return record?.categories[category] === true;
}
