"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ExternalLink, Loader2, Newspaper, Pencil, Plus } from "lucide-react";
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
import type { ProfessionalArticleRow } from "@/lib/articles";
import { ARTICLE_TITLE_MAX } from "@/lib/article-rules";
import type { ProductModerationStatus } from "@/lib/product-rules";

type State = { kind: "loading" } | { kind: "error"; code: string } | { kind: "ready"; articles: ProfessionalArticleRow[] };

const STATUS_STYLES: Record<ProductModerationStatus, string> = {
  draft: "bg-muted text-foreground",
  submitted: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-red-100 text-red-900",
  unpublished: "bg-slate-200 text-slate-900",
};

async function fetchArticles(): Promise<Exclude<State, { kind: "loading" }>> {
  try {
    const res = await fetch("/api/professional/articles", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { articles?: ProfessionalArticleRow[] } | null;
    if (res.status === 401 || res.status === 403) return { kind: "error", code: "ACCOUNT_NOT_ACTIVE" };
    if (!res.ok || !Array.isArray(body?.articles)) return { kind: "error", code: "generic" };
    return { kind: "ready", articles: body.articles };
  } catch {
    return { kind: "error", code: "generic" };
  }
}

/** « Mes articles » — the articles a professional writes for their page, reviewed by the team. */
export default function ProfessionalArticlesPage() {
  const t = useTranslations("ArticlesPro");
  const locale = useLocale();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [titleFr, setTitleFr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchArticles().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", { dateStyle: "long", timeZone: "America/Toronto" }).format(new Date(iso));

  const create = async () => {
    if (!titleFr.trim()) {
      setCreateError(t("errors.INVALID_TITLE"));
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/professional/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titleFr: titleFr.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { slug?: string; error?: string } | null;
      if (!res.ok || !body?.slug) {
        setCreateError(t(res.status === 401 || res.status === 403 ? "errors.ACCOUNT_NOT_ACTIVE" : body?.error === "INVALID_TITLE" ? "errors.INVALID_TITLE" : "errors.generic"));
        return;
      }
      router.push(`/professional/dashboard/articles/${body.slug}`);
    } catch {
      setCreateError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const openCreate = () => {
    setTitleFr("");
    setCreateError(null);
    setCreating(true);
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-2 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
        </div>
        {state.kind === "ready" ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("list.new")}
          </Button>
        ) : null}
      </div>

      <section className="max-w-3xl rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
        <h2 className="font-medium text-foreground">{t("howItWorks.title")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t("howItWorks.review")}</li>
          <li>{t("howItWorks.rules")}</li>
          <li>{t("howItWorks.news")}</li>
        </ul>
      </section>

      {state.kind === "loading" ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : state.kind === "error" ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.code === "ACCOUNT_NOT_ACTIVE" ? t("errors.ACCOUNT_NOT_ACTIVE") : t("list.loadError")}
        </p>
      ) : state.articles.length === 0 ? (
        <div className="max-w-2xl rounded-xl bg-card p-8">
          <Newspaper className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-4 font-serif text-xl font-light text-foreground">{t("list.emptyTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("list.emptyBody")}</p>
          <Button onClick={openCreate} className="mt-4 gap-2">
            <Plus className="h-4 w-4" />
            {t("list.new")}
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3">
          {state.articles.map((row) => (
            <li key={row.slug} data-article-row={row.slug} className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium text-foreground">{row.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>{t(`statuses.${row.status}`)}</span>
                  {row.live ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{t("badges.live")}</span> : null}
                  {row.inNews ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">{t("badges.inNews")}</span> : null}
                  {row.changesPending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{t("badges.changesPending")}</span>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("list.updated")} {day(row.updatedAt)}
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {row.live ? (
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <a href={`/nouveautes/${row.slug}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      {t("list.viewPublic")}
                    </a>
                  </Button>
                ) : null}
                <Button asChild size="sm" className="gap-1">
                  <Link href={`/professional/dashboard/articles/${row.slug}`}>
                    <Pencil className="h-4 w-4" />
                    {t("list.edit")}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={(isOpen) => !isOpen && !submitting && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="article-title">{t("create.titleFr")}</Label>
            <Input
              id="article-title"
              value={titleFr}
              maxLength={ARTICLE_TITLE_MAX}
              onChange={(event) => setTitleFr(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !submitting) void create();
              }}
            />
            <p className="text-xs text-muted-foreground">{t("create.titleHint")}</p>
            {createError ? (
              <p role="alert" className="text-sm text-destructive">
                {createError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void create()} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("create.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
