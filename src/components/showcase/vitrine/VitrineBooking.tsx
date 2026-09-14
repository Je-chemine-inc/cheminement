"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import type { ShowcaseSlotsResponse } from "@/lib/showcase-booking-types";
import { VITRINE_DAYS_PER_VIEW, canShowNextDays, daysInView } from "@/lib/showcase-vitrine";

/**
 * The booking panel of a professional's page (spec 003, « vitrine » design):
 * the consultation, five days at a time, their free times, and « Votre demande »
 * with the chosen time. The request itself is made in the booking funnel on
 * www, which holds the time until the professional answers; nothing is booked
 * on the city host. `aside` goes under the request card (the waitlist).
 */
export function VitrineBooking({
  slug,
  name,
  services,
  modes,
  bookingBaseUrl,
  waitlistAnchor,
  aside,
}: {
  slug: string;
  name: string;
  /** The consultations this page offers, the default first. */
  services: DirectRequestService[];
  /** How the professional consults, as a phrase: « en personne ou en vidéo ». */
  modes: string;
  /** The funnel's URL on www, without the service and time parameters. */
  bookingBaseUrl: string;
  waitlistAnchor?: string;
  aside?: ReactNode;
}) {
  const t = useTranslations("ShowcaseBooking");
  const locale = useLocale();
  const localeTag = locale === "en" ? "en-CA" : "fr-CA";
  const [service, setService] = useState<DirectRequestService>(services[0] ?? "standard");
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
  const weekday = (day: string) => {
    const label = new Intl.DateTimeFormat(localeTag, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
    return label.charAt(0).toLocaleUpperCase(localeTag) + label.slice(1);
  };
  const date = (day: string) =>
    new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const timeLabel = (day: string, time: string) =>
    new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T${time}:00Z`));
  const money = new Intl.NumberFormat(localeTag, { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const requestUrl = (day: string, time: string) => {
    const url = new URL(bookingBaseUrl);
    url.searchParams.set("service", service);
    url.searchParams.set("date", day);
    url.searchParams.set("time", time);
    return url.toString();
  };

  const price = first?.price ?? null;
  const minutes = first?.durationMinutes ?? 0;
  const links = (
    <span className="mt-3 flex flex-col items-start gap-2 text-sm">
      {waitlistAnchor ? (
        <a href={`#${waitlistAnchor}`} className="font-medium text-[#17505F] hover:text-[#0E3A46]">
          {t("joinWaitlist")}
        </a>
      ) : null}
      <a href={bookingBaseUrl} data-showcase-cta="" className="font-medium text-[#17505F] hover:text-[#0E3A46]">
        {t("matchInstead")}
      </a>
    </span>
  );

  const dayButton = (on: boolean) =>
    `rounded-xl border px-[3px] py-2.5 text-center leading-tight transition-colors ${
      on
        ? "border-[#17505F] bg-[#17505F] text-[#F6F2EA] shadow-[0_10px_20px_-14px_rgba(23,80,95,0.9)]"
        : "border-[#E7DFD1] bg-white text-[#2B403C] hover:border-[#17505F]"
    }`;
  const timeButton = (on: boolean) =>
    `rounded-xl border px-1 py-3 text-center text-[14.5px] transition-colors ${
      on
        ? "border-[#17505F] bg-[#17505F] font-semibold text-[#F6F2EA] shadow-[0_10px_20px_-14px_rgba(23,80,95,0.9)]"
        : "border-[#E7DFD1] bg-white text-[#2B403C] hover:border-[#17505F]"
    }`;
  const navButton =
    "flex rounded-[9px] p-[7px] text-[#17505F] transition-colors hover:bg-[#F1F4EE] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_460px] rounded-[22px] border border-[#E2EADC] bg-white p-[clamp(18px,2.6vw,28px)]">
        {services.length > 1 ? (
          <div role="tablist" aria-label={t("servicesLabel")} className="mb-3 flex gap-1 rounded-xl border border-[#EAE2D5] bg-[#F3EFE7] p-1">
            {services.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={service === option}
                onClick={() => chooseService(option)}
                className={`min-w-0 flex-1 truncate rounded-[9px] px-2 py-2.5 text-sm transition ${
                  service === option
                    ? "bg-white font-semibold text-[#12414F] shadow-[0_3px_8px_-4px_rgba(16,51,61,0.4)]"
                    : "font-medium text-[#5C6762] hover:text-[#12414F]"
                }`}
              >
                {t(`services.${option}`)}
              </button>
            ))}
          </div>
        ) : null}

        {state === "ready" && first?.available ? (
          <p className="mb-5 flex items-center gap-2 text-[13.5px] text-[#5E6863]">
            <Clock className="h-[15px] w-[15px] shrink-0 text-[#17505F]" aria-hidden="true" />
            {price === null
              ? t("modeNoteNoPrice", { minutes, modes })
              : t("modeNote", { minutes, modes, price: money.format(price) })}
          </p>
        ) : null}

        <div aria-live="polite">
          {state === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-[#5E6863]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("loading")}
            </p>
          ) : state === "error" ? (
            <p className="text-sm text-[#B42318]">{t("error")}</p>
          ) : !first?.available ? (
            <div>
              <p className="text-sm leading-relaxed text-[#4C5853]">{t("unavailable")}</p>
              {links}
            </div>
          ) : days.length === 0 ? (
            <div>
              <p className="text-sm leading-relaxed text-[#4C5853]">{t("none")}</p>
              {links}
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[#EDE6DA] px-2 py-1.5">
                <button type="button" onClick={() => showDays(Math.max(0, start - VITRINE_DAYS_PER_VIEW))} disabled={start === 0} aria-label={t("prevDays")} className={navButton}>
                  <ChevronLeft className="h-[19px] w-[19px]" aria-hidden="true" />
                </button>
                <span className="text-center text-[14.5px] font-medium text-[#2E403C]">
                  {visible.length > 0
                    ? `${weekday(visible[0].day)} ${date(visible[0].day)} – ${weekday(visible.at(-1)!.day)} ${date(visible.at(-1)!.day)}`
                    : null}
                </span>
                <button
                  type="button"
                  onClick={() => void goForward()}
                  disabled={loadingMore || !canShowNextDays(start, days.length, Boolean(nextFrom))}
                  aria-label={t("nextDays")}
                  className={navButton}
                >
                  {loadingMore ? <Loader2 className="h-[19px] w-[19px] animate-spin" aria-hidden="true" /> : <ChevronRight className="h-[19px] w-[19px]" aria-hidden="true" />}
                </button>
              </div>

              <ul aria-label={t("daysLabel")} className="mb-3.5 grid grid-cols-5 gap-[7px]">
                {visible.map(({ day }) => (
                  <li key={day} className="min-w-0">
                    <button
                      type="button"
                      aria-pressed={day === selectedDay}
                      onClick={() => {
                        setSelectedDay(day);
                        setSelectedTime(null);
                      }}
                      className={`w-full ${dayButton(day === selectedDay)}`}
                    >
                      <span className="block text-[13px] font-semibold">{weekday(day)}</span>
                      <span className="mt-[3px] block whitespace-nowrap text-xs opacity-80">{date(day)}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {selectedDay ? (
                <ul
                  aria-label={t("slotsLabel", { day: `${weekday(selectedDay)} ${date(selectedDay)}` })}
                  className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))]"
                >
                  {slots.map((time) => (
                    <li key={time}>
                      <button
                        type="button"
                        aria-pressed={selectedTime === time}
                        aria-label={t("slotChoose", { time: timeLabel(selectedDay, time), day: `${weekday(selectedDay)} ${date(selectedDay)}` })}
                        onClick={() => setSelectedTime((current) => (current === time ? null : time))}
                        className={`w-full ${timeButton(selectedTime === time)}`}
                      >
                        {timeLabel(selectedDay, time)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-4 text-[13px] leading-normal text-[#6A736C]">{t("timezone")}</p>
              {waitlistAnchor ? (
                <a href={`#${waitlistAnchor}`} className="mt-1 inline-flex text-[13px] font-medium text-[#17505F] hover:text-[#0E3A46]">
                  {t("noTimeSuits")}
                </a>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex min-w-0 max-w-[420px] flex-[1_1_300px] flex-col gap-4">
        <div className="rounded-[22px] border border-[#E2EADC] bg-white p-[clamp(18px,2.6vw,26px)]">
          <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[#666E62]">{t("requestTitle")}</p>
          {selectedDay && selectedTime && first?.available ? (
            <div>
              <p className="mb-1.5 font-[family-name:var(--font-vitrine-serif)] text-[23px] font-medium leading-tight text-[#0F3540]">
                {`${weekday(selectedDay)} ${date(selectedDay)}, ${timeLabel(selectedDay, selectedTime)}`}
              </p>
              <p className="mb-[18px] text-sm text-[#4C5853]">
                {price === null
                  ? t("chosenMetaNoPrice", { service: t(`services.${service}`), minutes })
                  : t("chosenMeta", { service: t(`services.${service}`), minutes, price: money.format(price) })}
              </p>
              <a
                href={requestUrl(selectedDay, selectedTime)}
                data-showcase-cta=""
                className="flex items-center justify-center gap-2 rounded-[13px] bg-[#17505F] px-[18px] py-[15px] text-[15.5px] font-semibold text-[#F8F5EE] transition hover:-translate-y-0.5 hover:bg-[#0E3A46] hover:text-[#F8F5EE]"
              >
                {t("requestCta")}
                <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
              </a>
              <p className="mt-3 text-[13px] leading-normal text-[#6A736C]">{t("howItWorks")}</p>
            </div>
          ) : (
            <div>
              <p className="mb-2 font-[family-name:var(--font-vitrine-serif)] text-[21px] font-medium leading-snug text-[#0F3540]">{t("noSlotTitle")}</p>
              <p className="text-sm leading-relaxed text-[#4C5853]">{t("noSlotBody", { name })}</p>
            </div>
          )}
        </div>
        {aside}
      </div>
    </div>
  );
}
