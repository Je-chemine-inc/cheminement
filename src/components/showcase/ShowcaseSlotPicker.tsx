"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Loader2 } from "lucide-react";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import { SHOWCASE_SLOTS_ANCHOR, type ShowcaseSlotsResponse } from "@/lib/showcase-booking-types";

/**
 * The professional's next free times on their public page (spec 003 phase 3).
 * Choosing one opens the booking funnel on www with the slot; the request that
 * follows holds it until the professional confirms or declines. Nothing is
 * booked on the city host. With no free time, it offers Je chemine's matching.
 */
export function ShowcaseSlotPicker({
  slug,
  services,
  bookingBaseUrl,
}: {
  slug: string;
  /** The consultations this page offers, the default first. */
  services: DirectRequestService[];
  /** The funnel's URL on www, without the service and slot parameters. */
  bookingBaseUrl: string;
}) {
  const t = useTranslations("ShowcaseBooking");
  const locale = useLocale();
  const localeTag = locale === "en" ? "en-CA" : "fr-CA";
  const [service, setService] = useState<DirectRequestService>(services[0] ?? "standard");
  const [pages, setPages] = useState<ShowcaseSlotsResponse[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (from?: string): Promise<ShowcaseSlotsResponse> => {
      const query = new URLSearchParams({ service });
      if (from) query.set("from", from);
      const res = await fetch(`/api/showcase/${encodeURIComponent(slug)}/slots?${query.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`slots ${res.status}`);
      return (await res.json()) as ShowcaseSlotsResponse;
    },
    [service, slug],
  );

  useEffect(() => {
    let active = true;
    fetchPage()
      .then((page) => {
        if (!active) return;
        setPages([page]);
        setSelectedDay(page.days[0]?.day ?? null);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [fetchPage]);

  const chooseService = (next: DirectRequestService) => {
    if (next === service) return;
    setService(next);
    setPages([]);
    setSelectedDay(null);
    setState("loading");
  };

  const loadMore = async () => {
    const from = pages.at(-1)?.nextFrom;
    if (!from) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(from);
      setPages((current) => [...current, page]);
      setSelectedDay((current) => current ?? page.days[0]?.day ?? null);
    } catch {
      setState("error");
    } finally {
      setLoadingMore(false);
    }
  };

  const first = pages[0];
  const days = useMemo(() => pages.flatMap((page) => page.days), [pages]);
  const slots = days.find((entry) => entry.day === selectedDay)?.slots ?? [];
  const nextFrom = pages.at(-1)?.nextFrom ?? null;

  // Day keys and times are Montréal wall-clock values: format them as such, in UTC, so the
  // visitor's own time zone never shifts a day or an hour.
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(localeTag, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T12:00:00Z`),
    );
  const timeLabel = (day: string, time: string) =>
    new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
      new Date(`${day}T${time}:00Z`),
    );
  const money = new Intl.NumberFormat(localeTag, {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const requestUrl = (day: string, time: string) => {
    const url = new URL(bookingBaseUrl);
    url.searchParams.set("service", service);
    url.searchParams.set("date", day);
    url.searchParams.set("time", time);
    return url.toString();
  };

  const moreButton = nextFrom ? (
    <button
      type="button"
      onClick={() => void loadMore()}
      disabled={loadingMore}
      className="inline-flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-60"
    >
      {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {t("more")}
    </button>
  ) : null;
  const matchLink = (
    <a href={bookingBaseUrl} data-showcase-cta="" className="inline-flex text-sm text-primary hover:underline">
      {t("matchInstead")}
    </a>
  );

  return (
    <section
      id={SHOWCASE_SLOTS_ANCHOR}
      aria-labelledby="showcase-slots"
      className="scroll-mt-24 rounded-2xl border border-border/60 bg-card p-6"
    >
      <h2 id="showcase-slots" className="flex items-center gap-2 font-serif text-xl font-light text-foreground">
        <CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />
        {t("title")}
      </h2>

      {services.length > 1 ? (
        <div role="tablist" aria-label={t("servicesLabel")} className="mt-4 flex flex-wrap gap-1 rounded-full bg-muted p-1">
          {services.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={service === option}
              onClick={() => chooseService(option)}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                service === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`services.${option}`)}
            </button>
          ))}
        </div>
      ) : null}

      {state === "ready" && first?.available ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {first.price === null
            ? t("durationOnly", { minutes: first.durationMinutes })
            : t("durationAndPrice", { minutes: first.durationMinutes, price: money.format(first.price) })}
        </p>
      ) : null}

      <div className="mt-4" aria-live="polite">
        {state === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("loading")}
          </p>
        ) : state === "error" ? (
          <p className="text-sm text-destructive">{t("error")}</p>
        ) : !first?.available ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
            {matchLink}
          </div>
        ) : days.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t("none")}</p>
            {moreButton}
            {matchLink}
          </div>
        ) : (
          <>
            <ul aria-label={t("daysLabel")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.map(({ day }) => (
                <li key={day} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={day === selectedDay}
                    onClick={() => setSelectedDay(day)}
                    className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors ${
                      day === selectedDay
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {dayLabel(day)}
                  </button>
                </li>
              ))}
            </ul>
            {selectedDay ? (
              <ul aria-label={t("slotsLabel", { day: dayLabel(selectedDay) })} className="mt-4 grid grid-cols-3 gap-2">
                {slots.map((time) => (
                  <li key={time}>
                    <a
                      href={requestUrl(selectedDay, time)}
                      data-showcase-cta=""
                      aria-label={t("slotAction", { day: dayLabel(selectedDay), time: timeLabel(selectedDay, time) })}
                      className="block rounded-lg border border-border/60 px-2 py-2 text-center text-sm text-foreground transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      {timeLabel(selectedDay, time)}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {moreButton ? <div className="mt-4">{moreButton}</div> : null}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("howItWorks")}</p>
          </>
        )}
      </div>
    </section>
  );
}
