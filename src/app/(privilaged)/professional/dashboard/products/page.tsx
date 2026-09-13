"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ExternalLink, GraduationCap, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProfessionalProductRow } from "@/lib/products";
import { PRODUCT_TITLE_MAX, PRODUCT_TYPES, type ProductModerationStatus, type ProductType } from "@/lib/product-rules";

type State =
  | { kind: "loading" }
  | { kind: "error"; code: string }
  | { kind: "ready"; products: ProfessionalProductRow[] };

const KNOWN_ERRORS = new Set([
  "INVALID_TITLE",
  "INVALID_TYPE",
  "ACCOUNT_NOT_ACTIVE",
  "NOT_FOUND",
]);

async function fetchProducts(): Promise<Exclude<State, { kind: "loading" }>> {
  try {
    const res = await fetch("/api/professional/products", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { products?: ProfessionalProductRow[]; error?: string } | null;
    if (res.status === 401 || res.status === 403) return { kind: "error", code: "ACCOUNT_NOT_ACTIVE" };
    if (!res.ok || !Array.isArray(body?.products)) return { kind: "error", code: "generic" };
    return { kind: "ready", products: body.products };
  } catch {
    return { kind: "error", code: "generic" };
  }
}

const STATUS_STYLES: Record<ProductModerationStatus, string> = {
  draft: "bg-muted text-foreground",
  submitted: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200",
  unpublished: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-200",
};

/**
 * « Formations et produits » — the trainings and digital products the
 * professional publishes and sells (spec 003 phase 5): the list, and a new
 * draft. Each product is edited on its own page.
 */
export default function ProfessionalProductsPage() {
  const t = useTranslations("ProductsPro");
  const locale = useLocale();
  const tag = locale === "en" ? "en-CA" : "fr-CA";
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<ProductType>("pdf");
  const [titleFr, setTitleFr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchProducts().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const retry = useCallback(async () => {
    setState({ kind: "loading" });
    setState(await fetchProducts());
  }, []);

  const price = (cents: number) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: "CAD" }).format(cents / 100);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "America/Toronto" }).format(
      new Date(iso),
    );

  const openCreate = () => {
    setType("pdf");
    setTitleFr("");
    setCreateError(null);
    setCreating(true);
  };

  const create = async () => {
    if (!titleFr.trim()) {
      setCreateError(t("errors.INVALID_TITLE"));
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/professional/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, titleFr: titleFr.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { slug?: string; error?: string } | null;
      if (!res.ok || !body?.slug) {
        const code = res.status === 401 || res.status === 403 ? "ACCOUNT_NOT_ACTIVE" : body?.error;
        setCreateError(t(`errors.${code && KNOWN_ERRORS.has(code) ? code : "generic"}`));
        return;
      }
      router.push(`/professional/dashboard/products/${body.slug}`);
    } catch {
      setCreateError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-serif font-light text-foreground">{t("title")}</h1>
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
          <li>{t("howItWorks.commission")}</li>
          <li>{t("howItWorks.access")}</li>
        </ul>
      </section>

      {state.kind === "loading" ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : state.kind === "error" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {state.code === "ACCOUNT_NOT_ACTIVE" ? t("errors.ACCOUNT_NOT_ACTIVE") : t("list.loadError")}
          </p>
          {state.code !== "ACCOUNT_NOT_ACTIVE" ? (
            <Button variant="outline" size="sm" onClick={() => void retry()} className="gap-1">
              <RefreshCw className="h-4 w-4" />
              {t("list.retry")}
            </Button>
          ) : null}
        </div>
      ) : state.products.length === 0 ? (
        <div className="max-w-2xl rounded-xl bg-card p-8">
          <GraduationCap className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-4 font-serif text-xl font-light text-foreground">{t("list.emptyTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("list.emptyBody")}</p>
          <Button onClick={openCreate} className="mt-4 gap-2">
            <Plus className="h-4 w-4" />
            {t("list.new")}
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3">
          {state.products.map((row) => (
            <li key={row.slug} className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">{row.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{t(`types.${row.type}`)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                    {t(`statuses.${row.status}`)}
                  </span>
                  {row.live ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t("badges.live")}
                    </span>
                  ) : null}
                  {row.changesPending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {t("badges.changesPending")}
                    </span>
                  ) : null}
                </div>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t("list.price")}</dt>
                  <dd className="text-foreground">{row.type === "external" ? t("list.free") : row.priceCents > 0 ? price(row.priceCents) : t("list.noPrice")}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t("list.sales")}</dt>
                  <dd className="text-foreground">{row.sales}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t("list.updated")}</dt>
                  <dd className="text-foreground">{day(row.updatedAt)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {row.live ? (
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <a href={`/book/${row.slug}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      {t("list.viewPublic")}
                    </a>
                  </Button>
                ) : null}
                <Button asChild size="sm" className="gap-1">
                  <Link href={`/professional/dashboard/products/${row.slug}`}>
                    <Pencil className="h-4 w-4" />
                    {t("list.edit")}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={creating}
        onOpenChange={(isOpen) => {
          if (!isOpen && !submitting) setCreating(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid min-w-0 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="product-type">{t("create.type")}</Label>
              <Select value={type} onValueChange={(value) => setType(value as ProductType)}>
                <SelectTrigger id="product-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`types.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t(`typeHints.${type}`)}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="product-title">{t("create.titleFr")}</Label>
              <Input
                id="product-title"
                value={titleFr}
                maxLength={PRODUCT_TITLE_MAX}
                onChange={(event) => setTitleFr(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submitting) void create();
                }}
              />
              <p className="text-xs text-muted-foreground">{t("create.titleHint")}</p>
            </div>
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
