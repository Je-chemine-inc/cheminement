"use client";

import { useEffect, useState } from "react";
import { isDayKey, isSlotTime } from "@/lib/available-slots";
import { isDirectRequestService, type DirectRequestService } from "@/lib/direct-request-rules";
import type { ShowcaseBookingSummary } from "@/lib/showcase-booking-types";

/** A time chosen on a professional's showcase page, as the funnel's URL carries it. */
export interface ShowcaseDirectIntent {
  slug: string;
  service: DirectRequestService;
  /** Montréal calendar day, "YYYY-MM-DD". */
  date: string;
  /** Montréal wall-clock start, "HH:mm". */
  time: string;
}

export type ShowcaseDirectRequestState =
  | { status: "none" }
  | { status: "loading"; intent: ShowcaseDirectIntent }
  | { status: "ready"; intent: ShowcaseDirectIntent; summary: ShowcaseBookingSummary }
  | { status: "unavailable"; intent: ShowcaseDirectIntent };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `?pro=&service=&date=&time=` when all four are well formed; null otherwise. */
export function readShowcaseDirectIntent(params: { get(name: string): string | null }): ShowcaseDirectIntent | null {
  const slug = params.get("pro") ?? "";
  const service = params.get("service");
  const date = params.get("date");
  const time = params.get("time");
  if (slug.length > 80 || !SLUG.test(slug) || !isDirectRequestService(service) || !isDayKey(date) || !isSlotTime(time)) {
    return null;
  }
  return { slug, service, date, time };
}

/**
 * The booking funnel's view of a showcase slot (spec 003 phase 3): the intent
 * from the URL, and the page's summary once it confirms the consultation is
 * still offered. "unavailable" when the page is gone or the consultation
 * closed: the funnel then sends an ordinary request. The slot itself is checked
 * and held by the server when the request is sent.
 */
export function useShowcaseDirectRequest(params: { get(name: string): string | null }): ShowcaseDirectRequestState {
  const intent = readShowcaseDirectIntent(params);
  const key = intent ? [intent.slug, intent.service, intent.date, intent.time].join("|") : "";
  const [loaded, setLoaded] = useState<{ key: string; summary: ShowcaseBookingSummary | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let active = true;
    const slug = key.split("|")[0];
    fetch(`/api/showcase/${encodeURIComponent(slug)}/summary`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ShowcaseBookingSummary) : null))
      .catch(() => null)
      .then((summary) => {
        if (active) setLoaded({ key, summary });
      });
    return () => {
      active = false;
    };
  }, [key]);

  if (!intent) return { status: "none" };
  if (!loaded || loaded.key !== key) return { status: "loading", intent };
  if (!loaded.summary || !loaded.summary.services[intent.service]?.offered) {
    return { status: "unavailable", intent };
  }
  return { status: "ready", intent, summary: loaded.summary };
}
