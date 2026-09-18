"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import type { ShowcaseBookingOption, ShowcaseSlotsResponse } from "@/lib/showcase-booking-types";
import { VITRINE_DAYS_PER_VIEW, canShowNextDays, daysInView, formatShowcasePrice, groupSlotsByPeriod } from "@/lib/showcase-vitrine";

export type VitrineBookingOption = ShowcaseBookingOption;

/**
 * The booking panel of a professional's page (spec 003, « vitrine » design), in
 * three steps side by side: the consultation, the time (five days at a time,
 * free times grouped by period), and « Votre demande », a summary with the
 * request button. The request itself is made in the booking funnel on www,
 * which holds the time until the professional answers; nothing is booked here.
 *
 * Shown only while the professional publishes real hours with a free time in the
 * horizon (phase 3b, `showcaseBookingOptions`), so it carries no waitlist: with
 * nothing free there is no panel, and the page's own button goes to the general list.
 */
export function VitrineBooking({
  slug,
  name,
  options,
  modes,
  bookingBaseUrl,
}: {
  slug: string;
  name: string;
  /** The consultations this page offers, the default first, with their length and fee. */
  options: VitrineBookingOption[];
  /** How the professional consults, as a phrase: « en personne ou en vidéo ». */
  modes: string;
  /** The funnel's URL on www, without the service and time parameters. */
  bookingBaseUrl: string;
}) {
  const t = useTranslations("ShowcaseBooking");
  const locale = useLocale();
  const localeTag = locale === "en" ? "en-CA" : "fr-CA";
  const [service, setService] = useState<DirectRequestService>(options[0]?.service ?? "standard");
  const [pages, setPages] = useState<ShowcaseSlotsResponse[]>([]);
  const [start, setStart] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
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
        setStart(0);
        setSelectedDay(page.days[0]?.day ?? null);
        setSelectedTime(null);
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
    setSelectedTime(null);
    setState("loading");
  };

  const first = pages[0];
  const days = useMemo(() => pages.flatMap((page) => page.days), [pages]);
  const nextFrom = pages.at(-1)?.nextFrom ?? null;
  const visible = daysInView(days, start);
  const slots = days.find((entry) => entry.day === selectedDay)?.slots ?? [];

  const showDays = (index: number, list = days) => {
    setStart(index);
    setSelectedDay(daysInView(list, index)[0]?.day ?? null);
    setSelectedTime(null);
  };

  const goForward = async () => {
    const target = start + VITRINE_DAYS_PER_VIEW;
    if (target < days.length) {
      showDays(target);
      return;
    }
    let from = nextFrom;
    if (!from) return;
    setLoadingMore(true);
    try {
      const fetched: ShowcaseSlotsResponse[] = [];
      let loaded = days.length;
      // A window can hold no free time at all: keep going until there is something to show, or nothing left.
      for (let tries = 0; from && loaded <= target && tries < 3; tries++) {
        const page = await fetchPage(from);
        fetched.push(page);
        loaded += page.days.length;
        from = page.nextFrom;
      }
      const all = [...pages, ...fetched];
      setPages(all);
      const list = all.flatMap((page) => page.days);
      if (target < list.length) showDays(target, list);
    } catch {
      setState("error");
    } finally {
      setLoadingMore(false);
    }
  };

  // Day keys and times are Montréal wall-clock values: format them in UTC so the
  // visitor's own time zone never shifts a day or an hour.
  const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(localeTag) + text.slice(1);
  const weekday = (day: string) =>
    capitalize(new Intl.DateTimeFormat(localeTag, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)));
  const date = (day: string) =>
    new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const dayNumber = (day: string) =>
    new Intl.DateTimeFormat(localeTag, { day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const monthShort = (day: string) =>
    new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const timeLabel = (day: string, time: string) =>
    new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T${time}:00Z`));
  const money = { format: (amount: number) => formatShowcasePrice(amount, localeTag) };
  const requestUrl = (day: string, time: string) => {
    const url = new URL(bookingBaseUrl);
    url.searchParams.set("service", service);
    url.searchParams.set("date", day);
    url.searchParams.set("time", time);
    return url.toString();
  };

  const current = options.find((option) => option.service === service) ?? options[0];
  const chosen = Boolean(selectedDay && selectedTime && first?.available);
  const when = selectedDay && selectedTime ? `${weekday(selectedDay)} ${date(selectedDay)}, ${timeLabel(selectedDay, selectedTime)}` : null;

  const stepLabel = (number: number, label: string, dark = false) => (
    <p className={`flex items-center gap-3 vt-sm font-semibold ${dark ? "text-white" : "text-[#1F2A2E]"}`}>
      <span
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-full font-[family-name:var(--font-vitrine-serif)] text-[15px] ${
          dark ? "bg-white/15 text-white" : "bg-[color:var(--vt-accent-soft,#E6EFEA)] text-[color:var(--vt-accent,#17505F)]"
        }`}
      >
        {number}
      </span>
      {label}
    </p>
  );

  // When the times ran out between the page and this panel: the general list, as the page's own button.
  const fallbackLinks = (
    <span className="mt-5 flex flex-wrap gap-2.5">
      <a href={bookingBaseUrl} data-showcase-cta="" className="rounded-full border border-[#D9D4CA] bg-white px-5 py-3 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)] transition-colors hover:border-[color:var(--vt-accent,#17505F)]">
        {t("matchInstead")}
      </a>
    </span>
  );

  const navButton =
    "flex h-10 w-10 flex-none items-center justify-center rounded-full border border-[#E4E1DA] bg-white text-[#1F2A2E] transition-colors hover:border-[color:var(--vt-accent,#17505F)] hover:text-[color:var(--vt-accent,#17505F)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#E4E1DA] disabled:hover:text-[#1F2A2E]";
  const ready = state === "ready" && first?.available && days.length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-[40px] border border-[#ECE8E1] bg-white p-2 shadow-[0_40px_90px_-64px_rgba(31,42,46,0.55)]">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.7fr)_minmax(0,0.95fr)]">
          {/* 1 · The consultation */}
          <div className="rounded-[32px] bg-[#F6F3EE] p-[clamp(20px,2.2vw,36px)]">
            {stepLabel(1, t("stepService"))}
            <div role="radiogroup" aria-label={t("servicesLabel")} className="mt-6 flex flex-col gap-3">
              {options.map((option) => {
                const on = option.service === service;
                return (
                  <button
                    key={option.service}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => chooseService(option.service)}
                    className={`flex w-full items-center gap-4 rounded-[26px] border-2 p-[clamp(14px,1.2vw,20px)] text-left transition-all duration-300 ${
                      on
                        ? "border-[color:var(--vt-accent,#17505F)] bg-white shadow-[0_20px_44px_-30px_rgba(23,80,95,0.8)]"
                        : "border-transparent bg-white/70 hover:bg-white"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 transition-colors ${
                        on ? "border-[color:var(--vt-accent,#17505F)] bg-[color:var(--vt-accent,#17505F)] text-white" : "border-[#CFC9BE] bg-white"
                      }`}
                    >
                      {on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block vt-md font-semibold leading-snug text-[#1F2A2E]">{t(`services.${option.service}`)}</span>
                      <span className="mt-1 block vt-sm text-[#5B6566]">{t("optionMinutes", { minutes: option.minutes })}</span>
                    </span>
                    {option.price !== null ? (
                      <span className="flex-none font-[family-name:var(--font-vitrine-serif)] text-[clamp(22px,1.7vw,30px)] leading-none text-[#1F2A2E]">
                        {money.format(option.price)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {modes ? (
              <p className="mt-6 flex items-center gap-2.5 vt-sm text-[#3E494B]">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white text-[color:var(--vt-accent,#17505F)]">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                </span>
                {capitalize(modes)}
              </p>
            ) : null}
          </div>

          {/* 2 · The time */}
          <div className="min-w-0 p-[clamp(20px,2.2vw,36px)]">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              {stepLabel(2, t("stepTime"))}
              {ready ? (
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => showDays(Math.max(0, start - VITRINE_DAYS_PER_VIEW))} disabled={start === 0} aria-label={t("prevDays")} className={navButton}>
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <span className="min-w-[10ch] text-center font-[family-name:var(--font-vitrine-serif)] vt-md text-[#1F2A2E]">
                    {visible.length > 0 ? `${date(visible[0].day)} – ${date(visible.at(-1)!.day)}` : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void goForward()}
                    disabled={loadingMore || !canShowNextDays(start, days.length, Boolean(nextFrom))}
                    aria-label={t("nextDays")}
                    className={navButton}
                  >
                    {loadingMore ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-6" aria-live="polite">
              {state === "loading" ? (
                <p className="flex items-center gap-2 vt-sm text-[#5B6566]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("loading")}
                </p>
              ) : state === "error" ? (
                <p className="vt-sm text-[#B42318]">{t("error")}</p>
              ) : !first?.available ? (
                <div className="rounded-[26px] bg-[#F6F3EE] p-6">
                  <p className="vt-md leading-relaxed text-[#3E494B]">{t("unavailable")}</p>
                  {fallbackLinks}
                </div>
              ) : days.length === 0 ? (
                <div className="rounded-[26px] bg-[#F6F3EE] p-6">
                  <p className="vt-md leading-relaxed text-[#3E494B]">{t("none")}</p>
                  {fallbackLinks}
                </div>
              ) : (
                <>
                  <ul aria-label={t("daysLabel")} className="grid grid-cols-5 gap-2">
                    {visible.map(({ day, slots: daySlots }) => {
                      const on = day === selectedDay;
                      return (
                        <li key={day} className="min-w-0">
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              setSelectedDay(day);
                              setSelectedTime(null);
                            }}
                            className={`flex w-full flex-col items-center rounded-[24px] border px-1 py-[clamp(10px,0.9vw,16px)] text-center transition-all duration-300 ${
                              on
                                ? "border-[color:var(--vt-accent,#17505F)] bg-[color:var(--vt-accent,#17505F)] text-white shadow-[0_16px_30px_-18px_rgba(23,80,95,0.9)]"
                                : "border-[#ECE8E1] bg-[#FBFAF7] text-[#1F2A2E] hover:border-[color:var(--vt-accent,#17505F)]"
                            }`}
                          >
                            <span className={`vt-xs font-semibold ${on ? "text-white/80" : "text-[#5B6566]"}`}>{weekday(day)}</span>
                            <span className="mt-0.5 font-[family-name:var(--font-vitrine-serif)] text-[clamp(22px,1.8vw,32px)] leading-none">{dayNumber(day)}</span>
                            <span className={`mt-1 vt-xs ${on ? "text-white/80" : "text-[#5B6566]"}`}>{monthShort(day)}</span>
                            <span className={`mt-1.5 hidden whitespace-nowrap vt-xs sm:block ${on ? "text-white/75" : "text-[color:var(--vt-accent,#17505F)]"}`}>
                              {t("slotCount", { count: daySlots.length })}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {selectedDay ? (
                    <div className="mt-7 space-y-5" aria-label={t("slotsLabel", { day: `${weekday(selectedDay)} ${date(selectedDay)}` })} role="group">
                      {groupSlotsByPeriod(slots).map((group) => (
                        <div key={group.period} className="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)] sm:items-start">
                          <p className="pt-2.5 vt-sm font-semibold text-[#5B6566]">{t(group.period)}</p>
                          <ul className="flex flex-wrap gap-2.5">
                            {group.times.map((time) => {
                              const on = selectedTime === time;
                              return (
                                <li key={time}>
                                  <button
                                    type="button"
                                    aria-pressed={on}
                                    aria-label={t("slotChoose", { time: timeLabel(selectedDay, time), day: `${weekday(selectedDay)} ${date(selectedDay)}` })}
                                    onClick={() => setSelectedTime((currentTime) => (currentTime === time ? null : time))}
                                    className={`min-w-[80px] rounded-full border px-4 py-2.5 vt-sm font-semibold transition-all duration-300 sm:min-w-[96px] sm:px-5 ${
                                      on
                                        ? "border-[color:var(--vt-accent,#17505F)] bg-[color:var(--vt-accent,#17505F)] text-white shadow-[0_12px_24px_-14px_rgba(23,80,95,0.9)]"
                                        : "border-[#ECE8E1] bg-white text-[#1F2A2E] hover:border-[color:var(--vt-accent,#17505F)] hover:text-[color:var(--vt-accent,#17505F)]"
                                    }`}
                                  >
                                    {timeLabel(selectedDay, time)}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-7 vt-xs text-[#5B6566]">{t("timezone")}</p>
                </>
              )}
            </div>
          </div>

          {/* 3 · The request */}
          <div className="flex flex-col rounded-[32px] bg-[color:var(--vt-accent,#17505F)] p-[clamp(20px,2.2vw,36px)] text-white lg:col-span-2 xl:col-span-1">
            {stepLabel(3, t("stepRequest"), true)}
            <dl className="mt-6 divide-y divide-white/15 border-y border-white/15">
              {[
                { label: t("summaryService"), value: t(`services.${service}`) },
                { label: t("summaryDuration"), value: current ? t("optionMinutes", { minutes: current.minutes }) : "" },
                { label: t("summaryWhen"), value: chosen && when ? when : t("summaryPending"), pending: !chosen },
                ...(current && current.price !== null ? [{ label: t("summaryPrice"), value: money.format(current.price) }] : []),
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-3.5">
                  <dt className="vt-sm text-white/65">{row.label}</dt>
                  <dd className={`text-right vt-sm font-semibold ${"pending" in row && row.pending ? "text-white/55" : "text-white"}`}>{row.value}</dd>
                </div>
              ))}
            </dl>
            {chosen ? null : <p className="mt-5 vt-sm leading-relaxed text-white/75">{t("noSlotBody", { name })}</p>}
            <div className="mt-auto pt-7">
              {chosen && selectedDay && selectedTime ? (
                <a
                  href={requestUrl(selectedDay, selectedTime)}
                  data-showcase-cta=""
                  className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-6 py-4 vt-md font-semibold text-[color:var(--vt-accent,#17505F)] shadow-[0_18px_36px_-18px_rgba(0,0,0,0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--vt-accent-soft,#E6EFEA)] hover:text-[color:var(--vt-accent-dark,#0E3A46)] motion-reduce:hover:translate-y-0"
                >
                  {t("requestCta", { name })}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : (
                <span aria-disabled="true" className="flex w-full items-center justify-center rounded-full border border-white/30 px-6 py-4 text-center vt-sm font-semibold text-white/65">
                  {t("pickFirst")}
                </span>
              )}
              <p className="mt-4 vt-xs leading-normal text-white/65">{t("howItWorks")}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
