"use client";

import { useEffect } from "react";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Apply a `?lang=fr|en` deep-link hint to the cookie-based locale.
 *
 * Locale is resolved server-side from the NEXT_LOCALE cookie only (there is no
 * [locale] routing), so a `?lang=` param on its own cannot change the rendered
 * language. Email payment deep-links carry `&lang=<recipient locale>`; this
 * hook — mounted on the landing pages (/pay, client billing) — reads the param
 * and, if it differs from the current cookie, writes NEXT_LOCALE and reloads so
 * next-intl re-resolves server-side (same mechanism as LocaleSwitcher). If it
 * already matches (or is absent/invalid) it just strips the param without
 * reloading, so there is no reload loop. Other params (?token, ?action) are
 * preserved across the reload.
 */
export function useLocaleFromQuery(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const raw = url.searchParams.get("lang");
    if (raw !== "fr" && raw !== "en") return;

    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith("NEXT_LOCALE="))
      ?.split("=")[1];

    // Strip the param either way so it doesn't linger or re-trigger.
    url.searchParams.delete("lang");

    if (current === raw) {
      window.history.replaceState(null, "", url.toString());
      return;
    }

    document.cookie = `NEXT_LOCALE=${raw};path=/;max-age=${ONE_YEAR_SECONDS}`;
    // Reload (new request carries the cookie just set) so the server re-resolves
    // the locale; keep the lang-stripped URL so ?token / ?action survive.
    window.location.replace(url.toString());
  }, []);
}
