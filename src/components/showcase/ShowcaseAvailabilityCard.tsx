"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, CalendarCheck, CalendarClock, ExternalLink, Loader2 } from "lucide-react";
import { firstFreeTime, showcaseAvailabilityState, type ShowcaseAvailabilityState } from "@/lib/showcase-availability";
import { SHOWCASE_SLOTS_ANCHOR } from "@/lib/showcase-booking-types";
import { showcaseErrorKey, type ShowcaseEditorJson } from "@/lib/showcase-editor-types";

type Services = ShowcaseEditorJson["page"]["services"];

/** Sentences that speak to the professional; on the admin's screen they read about them (ShowcaseAdmin.availability). */
type WordedKey =
  | "title"
  | "intro"
  | "switchLabel"
  | "standardHint"
  | "quickHint"
  | "viewOnPage"
  | `state.${ShowcaseAvailabilityState}`;

const switchClass = (on: boolean) =>
  `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-primary" : "bg-muted"}`;
const knobClass = (on: boolean) =>
  `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? "translate-x-5" : "translate-x-0"}`;

const STATE_TONE: Record<ShowcaseAvailabilityState, string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-900",
  needsHours: "border-amber-200 bg-amber-50 text-amber-900",
  noFreeTime: "border-amber-200 bg-amber-50 text-amber-900",
  pageHidden: "border-border/60 bg-muted/40 text-muted-foreground",
  off: "border-border/60 bg-muted/40 text-muted-foreground",
};

/**
 * « Disponibilités sur ma page » (spec 003 phase 3b): the one switch that shows a professional's
 * free times on their page, the consultations offered there, their weekly hours, and what the page
 * shows right now.
 *
 * Only hours the professional saves from their own account make times appear, so the hours editor
 * (`hours`) is given on their screen alone; an admin sees the switch, the hours and the state.
 */
export function ShowcaseAvailabilityCard<V extends ShowcaseEditorJson>({
  apiBase,
  view,
  onView,
  reload,
  audience = "professional",
  hours,
}: {
  apiBase: string;
  view: V;
  onView: (next: V) => void;
  /** Reads the view again, so the state line follows a switch or a new schedule. */
  reload: () => Promise<void>;
  audience?: "professional" | "admin";
  /** The professional's own hours editor; the admin's screen shows the hours without it. */
  hours?: ReactNode;
}) {
  const t = useTranslations("ShowcasePro");
  const tAdmin = useTranslations("ShowcaseAdmin");
  const tDays = useTranslations("Dashboard.schedule");
  const localeTag = useLocale() === "en" ? "en-CA" : "fr-CA";
  const say = (key: WordedKey, values?: Record<string, string>) =>
    audience === "admin" ? tAdmin(`availability.${key}`, values) : t(`availability.${key}`, values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { services } = view.page;
  const { availability } = view;
  const on = services.standard || services.quick;
  const state = showcaseAvailabilityState({
    services,
    pageLive: view.page.status === "published" && view.showcaseEnabled,
    hoursConfirmed: availability.hoursConfirmedAt !== null,
    options: availability.options,
  });

  // Montréal wall-clock values: formatted in UTC so the reader's own time zone never shifts them.
  const first = firstFreeTime(availability.options);
  const when = first
    ? `${new Intl.DateTimeFormat(localeTag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
        new Date(`${first.day}T12:00:00Z`),
      )}, ${new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
        new Date(`${first.day}T${first.time}:00Z`),
      )}`
    : "";

  const put = async (next: Partial<Services>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/services`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(`errors.${showcaseErrorKey(body?.error)}`));
        return;
      }
      onView({ ...view, page: { ...view.page, services: body.services } });
      // What the page shows now is read again, so the state line never tells the old story.
      await reload();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const minutes = { standard: availability.sessionMinutes, quick: availability.quickMinutes };
  const week = availability.week
    .map((day) => `${tDays(`days.${day.day.toLowerCase()}`)} ${day.start}–${day.end}`)
    .join(" · ");

  return (
    <section className="rounded-xl bg-card p-6" aria-labelledby="showcase-availability-title" data-availability-card="">
      <h2 id="showcase-availability-title" className="font-serif text-xl font-light text-foreground">
        {say("title")}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{say("intro")}</p>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
        <p className="text-sm font-medium text-foreground">{say("switchLabel")}</p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={say("switchLabel")}
          disabled={busy}
          onClick={() => void put(on ? { standard: false, quick: false } : { standard: true })}
          className={switchClass(on)}
          data-availability-switch=""
        >
          <span className={knobClass(on)} />
        </button>
      </div>

      <div
        role="status"
        className={`mt-3 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm ${STATE_TONE[state]}`}
        data-availability-state={busy ? "busy" : state}
      >
        {busy ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : state === "live" ? (
          <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">{say(`state.${state}`, { when })}</span>
        {state === "live" ? (
          <a
            href={`${view.page.publicUrl}#${SHOWCASE_SLOTS_ANCHOR}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
          >
            {say("viewOnPage")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {on ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm font-medium text-foreground">{t("availability.consultations")}</p>
          {(["standard", "quick"] as const).map((key) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-foreground">{t(`availability.${key}`, { minutes: String(minutes[key]) })}</p>
                <p className="text-sm text-muted-foreground">{say(`${key}Hint`)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={services[key]}
                aria-label={t(`availability.${key}`, { minutes: String(minutes[key]) })}
                disabled={busy}
                onClick={() => void put({ [key]: !services[key] })}
                className={switchClass(services[key])}
                data-availability-service={key}
              >
                <span className={knobClass(services[key])} />
              </button>
            </div>
          ))}
          {audience === "professional" ? (
            <p className="text-sm text-muted-foreground">{t("availability.requests")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 border-t border-border/40 pt-5">
        {hours ?? (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{tAdmin("availability.hoursTitle")}</p>
            <p className="text-foreground">{week || tAdmin("availability.hoursNone")}</p>
            <p className="text-muted-foreground">
              {tAdmin("availability.sessions", { minutes: String(availability.sessionMinutes) })}
            </p>
            <p className={availability.hoursConfirmedAt ? "text-muted-foreground" : "text-amber-700"}>
              {availability.hoursConfirmedAt
                ? tAdmin("availability.hoursConfirmed", {
                    date: new Intl.DateTimeFormat(localeTag, { dateStyle: "long" }).format(new Date(availability.hoursConfirmedAt)),
                  })
                : tAdmin("availability.hoursNever")}
            </p>
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
