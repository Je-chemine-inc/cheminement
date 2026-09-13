"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, CalendarClock, ListOrdered, Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient, ApiClientError } from "@/lib/api-client";
import type { ProfessionalWaitlistRow } from "@/lib/waitlist-entries";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: ProfessionalWaitlistRow[] };

const REFRESH_MS = 60_000;

async function fetchWaitlist(): Promise<Exclude<State, { kind: "loading" }>> {
  try {
    const body = await apiClient.get<{ entries?: ProfessionalWaitlistRow[] }>("/professional/waitlist", {
      cache: "no-store",
    });
    return Array.isArray(body?.entries) ? { kind: "ready", entries: body.entries } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/**
 * « Liste d'attente » — the people waiting for a time on the professional's
 * showcase page (spec 003 phase 4), in queue order. Offers are made by the
 * platform; the professional can only take someone off the list.
 */
export default function ProfessionalWaitlistPage() {
  const t = useTranslations("WaitlistPro");
  const locale = useLocale();
  const tag = locale === "en" ? "en-CA" : "fr-CA";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [removing, setRemoving] = useState<ProfessionalWaitlistRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A failed background refresh keeps the list already on screen.
  const reload = useCallback(async () => {
    const next = await fetchWaitlist();
    setState((current) => (next.kind === "error" && current.kind === "ready" ? current : next));
  }, []);

  useEffect(() => {
    let active = true;
    const load = () =>
      void fetchWaitlist().then((next) => {
        if (active) setState((current) => (next.kind === "error" && current.kind === "ready" ? current : next));
      });
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const retry = () => {
    setState({ kind: "loading" });
    void reload();
  };

  // Offered days and times are Montréal wall-clock values: formatted in UTC so
  // the viewer's own time zone never shifts them. Other dates are instants.
  const slotDay = (dayKey: string) =>
    new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(`${dayKey}T12:00:00Z`),
    );
  const slotTime = (dayKey: string, time: string) =>
    new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
      new Date(`${dayKey}T${time}:00Z`),
    );
  const clockAt = (iso: string) =>
    new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }).format(
      new Date(iso),
    );
  const dateAt = (iso: string) =>
    new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "America/Toronto" }).format(
      new Date(iso),
    );

  const moments = (row: ProfessionalWaitlistRow) => {
    const periods = row.periods.map((period) => t(`periods.${period}`)).join(", ");
    const days = row.days.map((day) => t(`days.${day}`)).join(", ");
    if (!periods && !days) return t("card.anyTime");
    return [periods || t("card.anyMoment"), days || t("card.anyDay")].join(" · ");
  };

  const openRemove = (row: ProfessionalWaitlistRow) => {
    setRemoving(row);
    setError(null);
    setNotice(null);
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.delete(`/professional/waitlist/${removing.id}`);
      setNotice(t("remove.done", { name: removing.name }));
      setRemoving(null);
      await reload();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setNotice(t("remove.gone", { name: removing.name }));
        setRemoving(null);
        await reload();
      } else {
        setError(t("remove.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0">
        <h1 className="text-3xl font-serif font-light text-foreground">{t("title")}</h1>
        <p className="mt-2 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
      </div>

      {notice ? (
        <p role="status" className="max-w-3xl rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
          {notice}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : state.kind === "error" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {t("loadError")}
          </p>
          <Button variant="outline" size="sm" onClick={retry} className="gap-1">
            <RefreshCw className="h-4 w-4" />
            {t("retry")}
          </Button>
        </div>
      ) : state.entries.length === 0 ? (
        <div className="max-w-2xl rounded-xl bg-card p-8">
          <ListOrdered className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-4 font-serif text-xl font-light text-foreground">{t("empty.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("empty.body")}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("count", { count: state.entries.length })}</p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {state.entries.map((row) => (
              <li key={row.id} className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 px-2 text-sm font-medium text-primary"
                      aria-label={t("card.position", { position: row.position })}
                    >
                      #{row.position}
                    </span>
                    <p className="min-w-0 break-words font-medium text-foreground">{row.name}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                    {row.service === "quick" ? <Zap className="h-3 w-3" aria-hidden="true" /> : null}
                    {t(`services.${row.service}`)}
                  </span>
                </div>

                {row.offer ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      {t("card.offer", {
                        day: slotDay(row.offer.dayKey),
                        time: slotTime(row.offer.dayKey, row.offer.time),
                        until: clockAt(row.offer.expiresAt),
                      })}
                    </span>
                  </p>
                ) : null}

                <dl className="mt-3 grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{t("card.modality")}</dt>
                    <dd className="text-foreground">{t(`modalities.${row.modality}`)}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{t("card.moments")}</dt>
                    <dd className="min-w-0 text-foreground">{moments(row)}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{t("card.joined")}</dt>
                    <dd className="text-foreground">{dateAt(row.joinedAt)}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{t("card.ends")}</dt>
                    <dd className="text-foreground">{dateAt(row.expiresAt)}</dd>
                  </div>
                </dl>

                {row.motifs.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("card.motifs")}>
                    {row.motifs.map((motif) => (
                      <li
                        key={motif}
                        className="max-w-full break-words rounded-full border border-border/60 px-2 py-0.5 text-xs text-foreground"
                      >
                        {motif}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openRemove(row)}
                    className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("card.remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog
        open={removing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !submitting) setRemoving(null);
        }}
      >
        <DialogContent>
          {removing ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("remove.title")}</DialogTitle>
                <DialogDescription>{t("remove.body", { name: removing.name })}</DialogDescription>
              </DialogHeader>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoving(null)} disabled={submitting}>
                  {t("remove.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void confirmRemove()}
                  disabled={submitting}
                  className="gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("remove.confirm")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
