"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, ExternalLink, Loader2, Lock, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminProductRow } from "@/lib/products";
import type { ProductModerationStatus } from "@/lib/product-rules";

type Scope = "review" | "all";
const SCOPES: Scope[] = ["review", "all"];

type AdminAction = "approve" | "reject" | "unpublish";

const ERROR_CODES = ["NOTES_REQUIRED", "TRANSITION_NOT_ALLOWED", "NOT_FOUND", "INVALID_ACTION"] as const;
type ErrorCode = (typeof ERROR_CODES)[number];
const errorKey = (code: unknown): ErrorCode | "generic" =>
  typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : "generic";

const STATUS_STYLES: Record<ProductModerationStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  unpublished: "bg-muted text-muted-foreground",
};

const canApprove = (row: AdminProductRow) =>
  row.status === "submitted" || (row.status === "approved" && row.changesPending);

/** « Produits » — professionals' trainings and digital products, for the team to review (spec 003 phase 5). */
export default function AdminProductsPage() {
  const t = useTranslations("ProductsAdmin");
  const locale = useLocale();
  const localeTag = locale === "en" ? "en-CA" : "fr-CA";

  const [products, setProducts] = useState<AdminProductRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("review");
  const [search, setSearch] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminProductRow | null>(null);
  const [unpublishing, setUnpublishing] = useState<AdminProductRow | null>(null);
  const [notes, setNotes] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/products?scope=${scope}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { products?: AdminProductRow[] } | null;
      if (!res.ok || !body || !Array.isArray(body.products)) {
        setError(t("errors.generic"));
        return;
      }
      setProducts(body.products);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [scope, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (products ?? []).filter(
      (row) =>
        !query || row.title.toLowerCase().includes(query) || row.professionalName.toLowerCase().includes(query),
    );
  }, [products, search]);

  if (denied) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4 sm:p-6">
        <div className="max-w-md rounded-xl border border-border/60 bg-card p-6 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-3 font-serif text-2xl font-light text-foreground">{t("access.title")}</h1>
          <p className="mt-2 text-sm font-light text-muted-foreground">{t("access.body")}</p>
        </div>
      </div>
    );
  }

  const priceLabel = (cents: number) =>
    cents === 0
      ? t("free")
      : new Intl.NumberFormat(localeTag, { style: "currency", currency: "CAD" }).format(cents / 100);
  const dateLabel = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(iso))
      : "—";

  /** Sends the decision. Returns true when the dialog (if any) can close. */
  const act = async (row: AdminProductRow, action: AdminAction, actionNotes?: string): Promise<boolean> => {
    const approvingChanges = action === "approve" && row.status === "approved";
    setBusySlug(row.slug);
    setDialogError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/admin/products/${encodeURIComponent(row.slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(actionNotes !== undefined ? { notes: actionNotes } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return true;
      }
      if (res.status === 409 || res.status === 404) {
        setError(t(`errors.${errorKey(body?.error)}`));
        await load();
        return true;
      }
      if (!res.ok) {
        const message = t(`errors.${errorKey(body?.error)}`);
        if (action === "approve") setError(message);
        else setDialogError(message);
        return action === "approve";
      }
      setError(null);
      setDone(t(`done.${approvingChanges ? "approveChanges" : action}`, { title: row.title }));
      await load();
      return true;
    } catch {
      const message = t("errors.network");
      if (action === "approve") setError(message);
      else setDialogError(message);
      return action === "approve";
    } finally {
      setBusySlug(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    if (!notes.trim()) {
      setDialogError(t("errors.NOTES_REQUIRED"));
      return;
    }
    if (await act(rejecting, "reject", notes.trim())) setRejecting(null);
  };

  const confirmUnpublish = async () => {
    if (!unpublishing) return;
    if (await act(unpublishing, "unpublish")) setUnpublishing(null);
  };

  const busy = busySlug !== null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
          <p className="mt-1 max-w-3xl text-sm font-light text-muted-foreground">{t("previewNote")}</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label={t("refresh")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">
          <Check className="h-4 w-4 shrink-0" />
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
                onClick={() => setScope(value)}
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

        {loading && !products ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : products ? (
          <>
            <p className="text-sm text-muted-foreground">{t("count", { count: rows.length })}</p>
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {scope === "review" && !search.trim() ? t("emptyReview") : t("empty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3 font-normal">{t("columns.title")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.professional")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.type")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.price")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.status")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.submitted")}</th>
                      <th className="px-3 py-3 font-normal">{t("columns.sales")}</th>
                      <th className="px-3 py-3 text-right font-normal">{t("columns.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((row) => {
                      const rowBusy = busySlug === row.slug;
                      return (
                        <tr key={row.slug}>
                          <td className="max-w-xs px-3 py-3 align-top">
                            <p className="text-foreground">{row.title}</p>
                            <a
                              href={`/book/${encodeURIComponent(row.slug)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              {t("preview")}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                          <td className="px-3 py-3 align-top text-foreground">{row.professionalName || "—"}</td>
                          <td className="px-3 py-3 align-top text-foreground">{t(`types.${row.type}`)}</td>
                          <td className="whitespace-nowrap px-3 py-3 align-top text-foreground">
                            {priceLabel(row.priceCents)}
                          </td>
                          <td className="max-w-xs px-3 py-3 align-top">
                            <div className="flex flex-wrap items-start gap-1">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                              >
                                {t(`statuses.${row.status}`)}
                              </span>
                              {row.changesPending ? (
                                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                  {t("changesPending")}
                                </span>
                              ) : null}
                              {row.live ? (
                                <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                                  {t("live")}
                                </span>
                              ) : null}
                            </div>
                            {row.notes ? (
                              <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">
                                {t("lastNotes", { notes: row.notes })}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">
                            {dateLabel(row.submittedAt)}
                          </td>
                          <td className="px-3 py-3 align-top text-foreground">{row.sales}</td>
                          <td className="px-3 py-3 text-right align-top">
                            <div className="flex flex-wrap justify-end gap-2">
                              {canApprove(row) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void act(row, "approve")}
                                >
                                  {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                  {row.status === "approved" ? t("actions.approveChanges") : t("actions.approve")}
                                </Button>
                              ) : null}
                              {row.status === "submitted" ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setNotes("");
                                    setDialogError(null);
                                    setRejecting(row);
                                  }}
                                >
                                  {t("actions.reject")}
                                </Button>
                              ) : null}
                              {row.status === "approved" ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setDialogError(null);
                                    setUnpublishing(row);
                                  }}
                                >
                                  {t("actions.unpublish")}
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>

      <Dialog open={Boolean(rejecting)} onOpenChange={(value) => !value && !busy && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectDialog.title", { title: rejecting?.title ?? "" })}</DialogTitle>
            <DialogDescription>{t("rejectDialog.body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="product-reject-notes">{t("rejectDialog.notesLabel")}</Label>
            <Textarea
              id="product-reject-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("rejectDialog.notesPlaceholder")}
              maxLength={2000}
              rows={5}
              required
            />
          </div>
          {dialogError ? <p className="text-sm text-destructive">{dialogError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejecting(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmReject()}
              disabled={busy || !notes.trim()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("rejectDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(unpublishing)} onOpenChange={(value) => !value && !busy && setUnpublishing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("unpublishDialog.title", { title: unpublishing?.title ?? "" })}</DialogTitle>
            <DialogDescription>{t("unpublishDialog.body")}</DialogDescription>
          </DialogHeader>
          {dialogError ? <p className="text-sm text-destructive">{dialogError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnpublishing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmUnpublish()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("unpublishDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
