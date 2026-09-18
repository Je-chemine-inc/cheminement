"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Loader2, MapPin, Zap } from "lucide-react";
import type { ShowcaseDirectRequestState } from "@/components/appointments/useShowcaseDirectRequest";

/**
 * On the booking funnel, the professional and the time a visitor chose on a
 * showcase page (spec 003 phase 3), or why that time cannot be requested
 * online anymore.
 *
 * It also carries the client's consent to the general list (phase 3b): if that
 * professional declines or doesn't answer in time, the request goes on to Je
 * chemine's matching instead of waiting for the client to choose. Unchecked
 * unless ticked — a pre-ticked box would not be a choice.
 */
export function DirectRequestBanner({
  state,
  fallback = false,
  onFallbackChange,
}: {
  state: ShowcaseDirectRequestState;
  fallback?: boolean;
  onFallbackChange?: (next: boolean) => void;
}) {
  const t = useTranslations("DirectRequests");
  const tTitles = useTranslations("Showcase.titles");
  const locale = useLocale();
  const tag = locale === "en" ? "en-CA" : "fr-CA";

  if (state.status === "none") return null;
  if (state.status === "loading") {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-border/40 bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("funnel.loading")}
      </div>
    );
  }
  if (state.status === "unavailable") {
    return (
      <div role="status" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        {t("funnel.unavailable")}
      </div>
    );
  }

  const { summary, intent } = state;
  const offer = summary.services[intent.service];
  const title = summary.title.key ? tTitles(summary.title.key) : summary.title.label;
  // Montréal wall-clock values, formatted in UTC so the visitor's zone never shifts them.
  const at = new Date(`${intent.date}T${intent.time}:00Z`);
  const slot = `${new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(at)}, ${new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(at)}`;

  return (
    <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex items-start gap-4">
        {summary.photoUrl ? (
          <Image
            src={summary.photoUrl}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <div className="min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("funnel.eyebrow")}</p>
          <p className="font-medium text-foreground">
            {summary.displayName}
            {title ? <span className="font-normal text-muted-foreground"> · {title}</span> : null}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
              {slot}
            </span>
            <span className="inline-flex items-center gap-1">
              {intent.service === "quick" ? <Zap className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
              {t(`services.${intent.service}`)} · {t("funnel.minutes", { minutes: offer.durationMinutes })}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {summary.city.name}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{t("funnel.holdNote")}</p>
          <a href={summary.url} className="inline-block text-xs text-primary hover:underline">
            {t("funnel.changeSlot")}
          </a>
        </div>
      </div>
      {onFallbackChange ? (
        <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-primary/15 pt-4 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
            checked={fallback}
            onChange={(event) => onFallbackChange(event.target.checked)}
            data-direct-fallback=""
          />
          <span>
            {t("funnel.fallbackLabel", { name: summary.displayName })}
            <span className="mt-1 block text-xs text-muted-foreground">{t("funnel.fallbackHint")}</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
