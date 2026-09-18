"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ArrowDown, ArrowUp, ExternalLink, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHOWCASE_LIMITS } from "@/lib/showcase-constants";
import { showcaseErrorKey, type ShowcaseAdminJson, type ShowcaseEditorJson } from "@/lib/showcase-editor-types";
import { formatShowcasePrice } from "@/lib/showcase-vitrine";

/**
 * Je chemine's own resources on a professional's page (spec 003, owner 2026-09-18: « sometimes we
 * force our resources into their pages »). They show in « Ressources » after the professional's own,
 * always — even when the professional hid the section.
 */

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function usePrice() {
  const localeTag = useLocale() === "en" ? "en-CA" : "fr-CA";
  return (priceCents: number, free: string) => (priceCents > 0 ? formatShowcasePrice(priceCents / 100, localeTag) : free);
}

/**
 * The admin's card: the resources on the page, in order, and every published Je chemine resource to
 * add. Each change saves the whole list at once, live, then reads the page again.
 */
export function ShowcaseTeamResourcesAdminCard({
  apiBase,
  view,
  reload,
}: {
  apiBase: string;
  view: ShowcaseAdminJson;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("ShowcaseAdmin.teamResources");
  const tErrors = useTranslations("ShowcasePro");
  const price = usePrice();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = view.teamResources;
  const chosenSlugs = chosen.map((resource) => resource.slug);
  const full = chosenSlugs.length >= SHOWCASE_LIMITS.teamResources;
  const options = view.admin.teamResourceOptions.filter(
    (option) => !chosenSlugs.includes(option.slug) && (!filter.trim() || fold(option.title).includes(fold(filter.trim()))),
  );

  const save = async (slugs: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/resources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(tErrors(`errors.${showcaseErrorKey(body?.error)}`));
        return;
      }
      await reload();
    } catch {
      setError(tErrors("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, step: -1 | 1) => {
    const target = index + step;
    if (target < 0 || target >= chosenSlugs.length) return;
    const next = [...chosenSlugs];
    [next[index], next[target]] = [next[target], next[index]];
    void save(next);
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-6" aria-labelledby="team-resources-title" data-team-resources-card="">
      <h2 id="team-resources-title" className="font-serif text-xl font-light text-foreground">
        {t("title")}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("hint")}</p>

      <h3 className="mt-5 text-sm font-medium text-foreground">{t("chosen")}</h3>
      {chosen.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="mt-2 divide-y divide-border/60 rounded-lg border border-border/60" data-team-resources-chosen="">
          {chosen.map((resource, index) => (
            <li key={resource.slug} className="flex flex-wrap items-center gap-3 px-3 py-2" data-team-resource={resource.slug}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{resource.title}</p>
                <p className={`text-xs ${resource.available ? "text-muted-foreground" : "text-amber-700"}`}>
                  {resource.available ? price(resource.priceCents, t("free")) : t("withdrawn")}
                </p>
              </div>
              {resource.available ? (
                <a
                  href={`/book/${resource.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("open")}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("moveUp", { title: resource.title })}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("moveDown", { title: resource.title })}
                  disabled={busy || index === chosen.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save(chosenSlugs.filter((slug) => slug !== resource.slug))}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("remove")}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5 space-y-2">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("filter")}
            aria-label={t("filter")}
            className="pl-9"
            data-team-resources-filter=""
          />
        </div>
        {full ? <p className="text-xs text-amber-700">{t("max", { max: SHOWCASE_LIMITS.teamResources })}</p> : null}
        {view.admin.teamResourceOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noneAtAll")}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="flex max-h-64 flex-wrap gap-2 overflow-y-auto" data-team-resources-options="">
            {options.map((option) => (
              <li key={option.slug}>
                <button
                  type="button"
                  disabled={busy || full}
                  onClick={() => void save([...chosenSlugs, option.slug])}
                  aria-label={t("add", { title: option.title })}
                  data-team-resource-option={option.slug}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-sm text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {option.title}
                  <span className="text-xs text-muted-foreground">· {price(option.priceCents, t("free"))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {busy ? <Loader2 className="mt-3 h-4 w-4 animate-spin text-primary" aria-hidden="true" /> : null}
      {error ? (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * On « Ma page vitrine »: what the team placed on the professional's page. Read-only — they always
 * show, and only the team changes them. Nothing when there are none.
 */
export function ShowcaseTeamResourcesNotice({ view }: { view: ShowcaseEditorJson }) {
  const t = useTranslations("ShowcasePro.teamResources");
  const price = usePrice();
  const shown = view.teamResources.filter((resource) => resource.available);
  if (shown.length === 0) return null;
  return (
    <section className="rounded-xl bg-card p-6" aria-labelledby="team-resources-notice-title" data-team-resources-notice="">
      <h2 id="team-resources-notice-title" className="font-serif text-xl font-light text-foreground">
        {t("title")}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("body")}</p>
      <ul className="mt-4 divide-y divide-border/60 rounded-lg border border-border/60">
        {shown.map((resource) => (
          <li key={resource.slug} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{resource.title}</p>
              <p className="text-xs text-muted-foreground">{price(resource.priceCents, t("free"))}</p>
            </div>
            <a
              href={`/book/${resource.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("open")}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
