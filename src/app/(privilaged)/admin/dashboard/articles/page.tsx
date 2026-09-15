"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, ExternalLink, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { AdminArticleAction, AdminArticleRow } from "@/lib/articles";
import type { ProductModerationStatus } from "@/lib/product-rules";

type Scope = "review" | "all";
const SCOPES: Scope[] = ["review", "all"];

const ERROR_CODES = ["NOTES_REQUIRED", "TRANSITION_NOT_ALLOWED", "NOT_FOUND", "INVALID_ACTION"] as const;
const errorKey = (code: unknown) =>
  typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code) ? code : "generic";

const STATUS_STYLES: Record<ProductModerationStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  unpublished: "bg-muted text-muted-foreground",
};

/** « Articles à vérifier » — professionals' articles, for the team to review and feature in « Nouveautés ». */
export default function AdminArticlesPage() {
  const t = useTranslations("ArticlesAdmin");
  const locale = useLocale();
  const [articles, setArticles] = useState<AdminArticleRow[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("review");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminArticleRow | null>(null);
  const [unpublishing, setUnpublishing] = useState<AdminArticleRow | null>(null);
  const [notes, setNotes] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/articles?scope=${scope}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { articles?: AdminArticleRow[] } | null;
      if (!res.ok || !Array.isArray(body?.articles)) {
        setError(t("errors.generic"));
        return;
      }
      setArticles(body.articles);
    } catch {
      setError(t("errors.network"));
    }
  }, [scope, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const dateLabel = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(iso)) : "—";

  const act = async (row: AdminArticleRow, action: AdminArticleAction, actionNotes?: string): Promise<boolean> => {
    const approvingChanges = action === "approve" && row.status === "approved";
    setBusySlug(row.slug);
    setDialogError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/admin/articles/${encodeURIComponent(row.slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(actionNotes !== undefined ? { notes: actionNotes } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return true;
      }
      if (!res.ok) {
        const message = t(`errors.${errorKey(body?.error)}`);
        if (action === "reject") setDialogError(message);
        else setError(message);
        await load();
        return action !== "reject";
      }
      setError(null);
      setDone(t(`done.${approvingChanges ? "approveChanges" : action}`, { title: row.title }));
      await load();
      return true;
    } catch {
      setError(t("errors.network"));
      return false;
    } finally {
      setBusySlug(null);
    }
  };

  const busy = busySlug !== null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
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

      {!articles ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : articles.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{scope === "review" ? t("emptyReview") : t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-normal">{t("columns.title")}</th>
                <th className="px-3 py-3 font-normal">{t("columns.professional")}</th>
                <th className="px-3 py-3 font-normal">{t("columns.status")}</th>
                <th className="px-3 py-3 font-normal">{t("columns.submitted")}</th>
                <th className="px-3 py-3 font-normal">{t("columns.news")}</th>
                <th className="px-3 py-3 text-right font-normal">{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {articles.map((row) => (
                <tr key={row.slug} data-article-row={row.slug}>
                  <td className="max-w-xs px-3 py-3 align-top">
                    <p className="text-foreground">{row.title}</p>
                    <a
                      href={`/nouveautes/${encodeURIComponent(row.slug)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {t("preview")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-3 py-3 align-top text-foreground">{row.professionalName || "—"}</td>
                  <td className="max-w-xs px-3 py-3 align-top">
                    <div className="flex flex-wrap items-start gap-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>{t(`statuses.${row.status}`)}</span>
                      {row.changesPending ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{t("changesPending")}</span>
                      ) : null}
                      {row.live ? <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{t("live")}</span> : null}
                    </div>
                    {row.notes ? <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">{t("lastNotes", { notes: row.notes })}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-muted-foreground">{dateLabel(row.submittedAt)}</td>
                  <td className="px-3 py-3 align-top">
                    {row.status === "approved" ? (
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(row, row.inNews ? "unfeature" : "feature")}>
                        {row.inNews ? t("actions.unfeature") : t("actions.feature")}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right align-top">
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.status === "submitted" || (row.status === "approved" && row.changesPending) ? (
                        <Button type="button" size="sm" disabled={busy} onClick={() => void act(row, "approve")}>
                          {busySlug === row.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setUnpublishing(row)}>
                          {t("actions.unpublish")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(rejecting)} onOpenChange={(value) => !value && !busy && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectDialog.title", { title: rejecting?.title ?? "" })}</DialogTitle>
            <DialogDescription>{t("rejectDialog.body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="article-reject-notes">{t("rejectDialog.notesLabel")}</Label>
            <Textarea
              id="article-reject-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("rejectDialog.notesPlaceholder")}
              maxLength={2000}
              rows={5}
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
              disabled={busy || !notes.trim()}
              onClick={async () => {
                if (rejecting && (await act(rejecting, "reject", notes.trim()))) setRejecting(null);
              }}
            >
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnpublishing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (unpublishing && (await act(unpublishing, "unpublish"))) setUnpublishing(null);
              }}
            >
              {t("unpublishDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
