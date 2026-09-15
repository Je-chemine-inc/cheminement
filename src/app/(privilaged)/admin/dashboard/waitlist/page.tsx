"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminPermissions } from "@/components/admin/AdminPermissionsProvider";
import { AdminAccessRequired } from "@/components/admin/AdminAccessRequired";
import type { AdminWaitlistRow } from "@/lib/waitlist-entries";
import type { WaitlistStatus } from "@/lib/waitlist-rules";

type Scope = "open" | "closed" | "all";
const SCOPES: Scope[] = ["open", "closed", "all"];

interface ListJson {
  entries: AdminWaitlistRow[];
  showContact: boolean;
}

const STATUS_STYLES: Record<WaitlistStatus, string> = {
  active: "bg-emerald-100 text-emerald-800",
  offered: "bg-amber-100 text-amber-800",
  converted: "bg-sky-100 text-sky-800",
  expired: "bg-muted text-muted-foreground",
  left: "bg-muted text-muted-foreground",
  removed: "bg-rose-100 text-rose-800",
};

const isOpen = (row: AdminWaitlistRow) => row.status === "active" || row.status === "offered";

/** « Listes d'attente » — every professional's waitlist, for the team (spec 003 phase 4). */
export default function AdminWaitlistPage() {
  const t = useTranslations("WaitlistAdmin");
  const locale = useLocale();
  const localeTag = locale === "en" ? "en-CA" : "fr-CA";
  const { manageProfessionals } = useAdminPermissions();

  const [data, setData] = useState<ListJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("open");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminWaitlistRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/waitlist?scope=${scope}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setError(t("errors.generic"));
        return;
      }
      setData(body as ListJson);
      setError(null);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [scope, t]);

  useEffect(() => {
    if (manageProfessionals) void load();
  }, [load, manageProfessionals]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.entries ?? []).filter(
      (row) =>
        !query ||
        row.professionalName.toLowerCase().includes(query) ||
        `${row.firstName} ${row.lastName}`.toLowerCase().includes(query),
    );
  }, [data, search]);

  if (!manageProfessionals || denied) {
    return <AdminAccessRequired title={t("access.title")} body={t("access.body")} />;
  }

  // Day keys and times are Montréal wall-clock values: format them in UTC so the
  // viewer's own time zone never shifts a day or an hour.
  const slotLabel = (day: string, time: string) =>
    new Intl.DateTimeFormat(localeTag, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`${day}T${time}:00Z`));
  const dateLabel = (iso: string) =>
    new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(iso));
  const instantLabel = (iso: string) =>
    new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(
      new Date(iso),
    );

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/admin/waitlist/${encodeURIComponent(removing.id)}`, { method: "DELETE" });
      if (res.status === 404) {
        setRemoving(null);
        setDone(null);
        setError(t("remove.gone"));
        await load();
        return;
      }
      if (!res.ok) {
        setDialogError(t("errors.generic"));
        return;
      }
      setRemoving(null);
      setError(null);
      setDone(t("remove.done"));
      await load();
    } catch {
      setDialogError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
          <p className="mt-1 max-w-3xl text-sm font-light text-muted-foreground">{t("contactNote")}</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label={t("refresh")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">
          <Check className="h-4 w-4" />
          {done}
        </p>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1 rounded-full bg-muted p-1 md:w-fit">
            {SCOPES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setScope(value);
                  setExpanded(null);
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-light transition-colors ${
                  scope === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`scopes.${value}`)}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="pl-9"
            />
          </div>
        </div>

        {loading || !data ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("count", { count: rows.length })}</p>
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3 font-normal">
                        <span className="sr-only">{t("columns.offers")}</span>
                      </th>
                      <th className="px-3 py-3 font-normal">{t("columns.professional")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.person")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.contact")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.consultation")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.status")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.position")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.missed")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.joined")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.ends")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.consent")}</th>
                      <th className="px-3 py-3 text-right font-normal">{t("columns.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((row) => {
                      const open = expanded === row.id;
                      return (
                        <Fragment key={row.id}>
                          <tr>
                            <td className="px-3 py-3 align-top">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-expanded={open}
                                aria-label={t("offers.toggle", { count: row.offers.length })}
                                onClick={() => setExpanded(open ? null : row.id)}
                              >
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <a
                                href={row.pageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-foreground hover:underline"
                              >
                                {row.professionalName}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <p className="text-foreground">
                                {row.firstName} {row.lastName}
                              </p>
                              <p className="text-xs text-muted-foreground">{t(`locales.${row.locale}`)}</p>
                            </td>
                            <td className="px-3 py-3 align-top">
                              {data.showContact ? (
                                <>
                                  <p className="break-all text-foreground">{row.email ?? "—"}</p>
                                  {row.phone ? <p className="text-xs text-muted-foreground">{row.phone}</p> : null}
                                </>
                              ) : (
                                <p className="text-xs text-muted-foreground">{t("contactHidden")}</p>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <p className="text-foreground">{t(`services.${row.service}`)}</p>
                              <p className="text-xs text-muted-foreground">{t(`modalities.${row.modality}`)}</p>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                              >
                                {t(`statuses.${row.status}`)}
                              </span>
                              {(row.status === "removed" || row.status === "expired") && row.removedReason ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t(`reasons.${row.removedReason}`)}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 align-top text-foreground">{row.position ?? "—"}</td>
                            <td className="px-3 py-3 align-top text-foreground">{row.missedOffers}</td>
                            <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">
                              {dateLabel(row.joinedAt)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">
                              {row.closedAt
                                ? t("closedOn", { date: dateLabel(row.closedAt) })
                                : t("endsOn", { date: dateLabel(row.expiresAt) })}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">
                              <p>{t("consent", { date: dateLabel(row.consent.at), version: row.consent.version })}</p>
                              <p className="text-xs">{row.smsConsent ? t("smsYes") : t("smsNo")}</p>
                            </td>
                            <td className="px-3 py-3 text-right align-top">
                              {isOpen(row) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setDialogError(null);
                                    setRemoving(row);
                                  }}
                                >
                                  {t("remove.action")}
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                          {open ? (
                            <tr className="bg-muted/30">
                              <td colSpan={12} className="px-4 py-3">
                                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                                  {t("offers.title")}
                                </p>
                                {row.offers.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">{t("offers.none")}</p>
                                ) : (
                                  <table className="text-sm">
                                    <thead className="text-left text-xs text-muted-foreground">
                                      <tr>
                                        <th className="py-1 pr-6 font-normal">{t("offers.time")}</th>
                                        <th className="py-1 pr-6 font-normal">{t("offers.sent")}</th>
                                        <th className="py-1 pr-6 font-normal">{t("offers.heldUntil")}</th>
                                        <th className="py-1 pr-6 font-normal">{t("offers.outcome")}</th>
                                        <th className="py-1 pr-6 font-normal">{t("offers.channels")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.offers.map((offer) => (
                                        <tr key={`${offer.dayKey}-${offer.time}-${offer.sentAt}`}>
                                          <td className="py-1 pr-6 text-foreground">
                                            {slotLabel(offer.dayKey, offer.time)}
                                          </td>
                                          <td className="py-1 pr-6 text-muted-foreground">
                                            {instantLabel(offer.sentAt)}
                                          </td>
                                          <td className="py-1 pr-6 text-muted-foreground">
                                            {instantLabel(offer.expiresAt)}
                                          </td>
                                          <td className="py-1 pr-6 text-foreground">
                                            {t(`outcomes.${offer.outcome}`)}
                                            {offer.appointmentId ? (
                                              <span className="ml-2 text-xs text-emerald-700">
                                                {t("offers.requestCreated")}
                                              </span>
                                            ) : null}
                                          </td>
                                          <td className="py-1 pr-6 text-muted-foreground">
                                            {offer.channels.length > 0
                                              ? offer.channels.map((channel) => t(`channels.${channel}`)).join(", ")
                                              : "—"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <Dialog open={Boolean(removing)} onOpenChange={(value) => !value && !busy && setRemoving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("remove.title", {
                name: removing ? `${removing.firstName} ${removing.lastName}` : "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("remove.body", { professional: removing?.professionalName ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {dialogError ? <p className="text-sm text-destructive">{dialogError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmRemove()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("remove.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
