"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ShowcaseStatusBadge } from "@/components/showcase/ShowcaseStatusBadge";
import { showcaseBadge } from "@/lib/showcase-badges";
import type { ShowcaseActor, ShowcaseStatus } from "@/lib/showcase-constants";
import { showcaseErrorKey } from "@/lib/showcase-editor-types";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { isValidShowcaseSlug } from "@/lib/showcase-workflow";

interface PageSummary {
  slug: string;
  cityKey: string;
  cityName: string;
  publicUrl: string;
  status: ShowcaseStatus;
  hasUnpublishedChanges: boolean;
  unpublishedBy: ShowcaseActor | null;
  invitedAt: string | null;
  publishedAt: string | null;
  /** When the professional last saved their live page, if they were the last to edit it. */
  professionalEditedAt: string | null;
  stats: { views: number; ctaClicks: number };
}

interface Row {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  title: string | null;
  officeCity: string | null;
  suggestedCityKey: string | null;
  page: PageSummary | null;
}

interface ListJson {
  rows: Row[];
  cities: { key: string; name: string; host: string; region: string; published: number }[];
  cityOptions: { key: string; name: string; region: string }[];
  showcaseEnabled: boolean;
  statsDays: number;
}

type Filter = "all" | "inProgress" | "published" | "unpublished" | "notInvited";
const FILTERS: Filter[] = ["all", "inProgress", "published", "unpublished", "notInvited"];

function matchesFilter(row: Row, filter: Filter): boolean {
  const page = row.page;
  switch (filter) {
    case "all":
      return true;
    case "notInvited":
      return !page;
    case "inProgress":
      return Boolean(page && (page.status === "invited" || page.status === "draft"));
    case "published":
      return page?.status === "published";
    case "unpublished":
      return page?.status === "unpublished";
  }
}

/** « Pages vitrines » — who the public sees, activating a page, and the switch (spec 003). */
export default function AdminShowcasesPage() {
  const t = useTranslations("ShowcaseAdmin");
  const tErrors = useTranslations("ShowcasePro");
  const locale = useLocale();
  const router = useRouter();
  const { manageProfessionals } = useAdminPermissions();

  const [data, setData] = useState<ListJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [activating, setActivating] = useState<Row | null>(null);
  const [activateCity, setActivateCity] = useState("");
  const [activateSlug, setActivateSlug] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/showcases", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setError(tErrors("errors.generic"));
        return;
      }
      setData(body as ListJson);
      setError(null);
    } catch {
      setError(tErrors("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [tErrors]);

  useEffect(() => {
    if (manageProfessionals) void load();
  }, [load, manageProfessionals]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (row) =>
        matchesFilter(row, filter) &&
        (!query || row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query)),
    );
  }, [data, filter, search]);

  const regions = useMemo(() => {
    const groups = new Map<string, { key: string; name: string }[]>();
    for (const city of data?.cityOptions ?? []) {
      const list = groups.get(city.region) ?? [];
      list.push({ key: city.key, name: city.name });
      groups.set(city.region, list);
    }
    return [...groups.entries()];
  }, [data]);

  if (!manageProfessionals || denied) {
    return <AdminAccessRequired title={t("access.title")} body={t("access.body")} />;
  }

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium" }).format(new Date(iso));

  const openActivate = (row: Row) => {
    setActivating(row);
    setActivateCity(row.suggestedCityKey ?? "");
    setActivateSlug("");
    setDialogError(null);
  };

  // The page is created empty of review: the admin goes straight to preparing it.
  const activate = async () => {
    if (!activating) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch("/api/admin/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: activating.userId,
          cityKey: activateCity,
          slug: activateSlug.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(tErrors(`errors.${showcaseErrorKey(body?.error)}`));
        return;
      }
      router.push(`/admin/dashboard/showcases/${activating.userId}`);
    } catch {
      setDialogError(tErrors("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const toggleSwitch = async () => {
    if (!data) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch("/api/admin/showcase-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !data.showcaseEnabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(typeof body?.error === "string" ? body.error : tErrors("errors.generic"));
        return;
      }
      setSwitchOpen(false);
      await load();
    } catch {
      setDialogError(tErrors("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const suggestedCityName = data?.cityOptions.find((city) => city.key === activating?.suggestedCityKey)?.name;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label={t("list.refresh")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}

      {loading || !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border/60 bg-card p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-serif text-xl font-light text-foreground">{t("switch.title")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {data.showcaseEnabled ? t("switch.on") : t("switch.off")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={data.showcaseEnabled ? "outline" : "default"}
                  onClick={() => {
                    setDialogError(null);
                    setSwitchOpen(true);
                  }}
                >
                  {data.showcaseEnabled ? t("switch.turnOff") : t("switch.turnOn")}
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-6">
              <h2 className="font-serif text-xl font-light text-foreground">{t("cities.title")}</h2>
              {data.cities.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{t("cities.none")}</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {data.cities.map((city) => (
                    <li key={city.key} className="flex items-center justify-between gap-3">
                      <span className="break-all text-foreground">{city.host}</span>
                      <span className="text-muted-foreground">{t("cities.count", { count: city.published })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h2 className="font-serif text-xl font-light text-foreground">{t("list.title")}</h2>
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("list.search")}
                  aria-label={t("list.search")}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1 rounded-full bg-muted p-1 md:w-fit">
              {FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-light transition-colors ${
                    filter === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`list.filters.${value}`)}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("list.empty")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-normal">{t("list.columns.professional")}</th>
                      <th className="px-4 py-3 font-normal">{t("list.columns.city")}</th>
                      <th className="px-4 py-3 font-normal">{t("list.columns.page")}</th>
                      <th className="px-4 py-3 font-normal">{t("list.columns.stats", { days: data.statsDays })}</th>
                      <th className="px-4 py-3 text-right font-normal">{t("list.columns.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((row) => (
                      <tr key={row.userId}>
                        <td className="px-4 py-3">
                          <p className="text-foreground">{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.email}</p>
                          {row.accountStatus !== "active" ? (
                            <p className="text-xs text-amber-700">{t("list.accountInactive")}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-foreground">{row.page?.cityName ?? row.officeCity ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <ShowcaseStatusBadge badge={showcaseBadge(row.page, data.showcaseEnabled)} />
                            {row.page?.hasUnpublishedChanges ? (
                              <span className="text-xs text-muted-foreground">{t("list.changes")}</span>
                            ) : null}
                            {row.page?.professionalEditedAt ? (
                              <span className="text-xs text-muted-foreground">
                                {t("list.professionalEdit", { date: formatDate(row.page.professionalEditedAt) })}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.page?.publishedAt
                            ? t("list.stats", { views: row.page.stats.views, clicks: row.page.stats.ctaClicks })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {row.page?.status === "published" && data.showcaseEnabled ? (
                              <Button asChild variant="ghost" size="icon" aria-label={row.page.publicUrl}>
                                <a href={row.page.publicUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : null}
                            {row.page ? (
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/admin/dashboard/showcases/${row.userId}`}>{t("list.open")}</Link>
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                disabled={row.accountStatus !== "active"}
                                onClick={() => openActivate(row)}
                              >
                                {t("list.activate")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <Dialog open={Boolean(activating)} onOpenChange={(open) => !open && setActivating(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("activate.title", { name: activating?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("activate.body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activate-city">{t("activate.city")}</Label>
              <select
                id="activate-city"
                value={activateCity}
                onChange={(event) => setActivateCity(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t("activate.chooseCity")}</option>
                {regions.map(([region, cities]) => (
                  <optgroup key={region} label={region}>
                    {cities.map((city) => (
                      <option key={city.key} value={city.key}>
                        {city.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {suggestedCityName ? (
                <p className="text-xs text-muted-foreground">{t("activate.citySuggested", { city: suggestedCityName })}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="activate-slug">{t("activate.slug")}</Label>
              <Input
                id="activate-slug"
                value={activateSlug}
                onChange={(event) => setActivateSlug(event.target.value.toLowerCase())}
                placeholder="sassi"
              />
              <p className="text-xs text-muted-foreground">{t("activate.slugHint")}</p>
              {activateCity && isValidShowcaseSlug(activateSlug.trim()) ? (
                <p className="break-all text-xs text-muted-foreground">
                  {t("activate.preview", { url: absoluteShowcaseUrl(activateCity, `/${activateSlug.trim()}`) })}
                </p>
              ) : null}
            </div>
            {dialogError ? <p className="text-sm text-destructive">{dialogError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setActivating(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void activate()} disabled={busy || !activateCity}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("activate.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={switchOpen} onOpenChange={setSwitchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {data?.showcaseEnabled ? t("switch.confirmOffTitle") : t("switch.confirmOnTitle")}
            </DialogTitle>
            <DialogDescription>
              {data?.showcaseEnabled ? t("switch.confirmOffBody") : t("switch.confirmOnBody")}
            </DialogDescription>
          </DialogHeader>
          {dialogError ? <p className="text-sm text-destructive">{dialogError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSwitchOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void toggleSwitch()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("switch.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
