"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ExternalLink, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHOWCASE_BADGE_CLASSES, showcaseBadge } from "@/lib/showcase-badges";
import { showcaseErrorKey, type ShowcaseEditorJson } from "@/lib/showcase-editor-types";

/**
 * Where the professional's page stands, what is still missing, and their
 * actions: preview, send for review (with the publication consent), take the
 * page down, put it back.
 */
export function ShowcaseProStatus({
  view,
  onView,
}: {
  view: ShowcaseEditorJson;
  onView: (next: ShowcaseEditorJson) => void;
}) {
  const t = useTranslations("ShowcasePro");
  const locale = useLocale();
  const [dialog, setDialog] = useState<"consent" | "unpublish" | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { page, missing } = view;
  const review = page.review.state;
  const badge = showcaseBadge({ status: page.status, reviewState: review }, view.showcaseEnabled);
  // While a new version is reviewed, the one the public sees stays up.
  const stillLive = page.status === "published" && view.showcaseEnabled;
  const canSubmit =
    review !== "pending" && missing.length === 0 && (page.status !== "published" || page.hasUnpublishedChanges);
  const formatDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", { dateStyle: "long" }).format(new Date(iso)) : "";

  const post = async (path: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/professional/showcase/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(`errors.${showcaseErrorKey(data?.error)}`));
        return false;
      }
      onView(data as ShowcaseEditorJson);
      return true;
    } catch {
      setError(t("errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl bg-card p-6" aria-labelledby="showcase-status-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="showcase-status-title" className="font-serif text-xl font-light text-foreground">
          {t("status.label")}
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm ${SHOWCASE_BADGE_CLASSES[badge]}`}>{t(`status.${badge}`)}</span>
      </div>

      {review === "pending" ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            {t("statusText.pending")} {page.review.submittedAt ? `(${formatDate(page.review.submittedAt)})` : ""}
          </p>
          {stillLive ? <p>{t("statusText.stillLive")}</p> : null}
        </div>
      ) : review === "changes_requested" ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{t("statusText.changes_requested")}</p>
          <p className="mt-2 whitespace-pre-line">{page.review.notes}</p>
          {stillLive ? <p className="mt-2">{t("statusText.stillLive")}</p> : null}
        </div>
      ) : page.status === "published" ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          {view.showcaseEnabled ? (
            <p>
              {t("statusText.published")}{" "}
              <a href={page.publicUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                {page.publicUrl}
              </a>
            </p>
          ) : (
            <p>{t("statusText.approvedClosed")}</p>
          )}
          {page.hasUnpublishedChanges ? <p className="text-amber-700">{t("statusText.pendingChanges")}</p> : null}
        </div>
      ) : page.status === "unpublished" ? (
        <p className="text-sm text-muted-foreground">
          {page.unpublishedBy === "professional"
            ? t("statusText.unpublishedByProfessional")
            : t("statusText.unpublishedByAdmin")}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("statusText.draft")}</p>
      )}

      {missing.length > 0 ? (
        <div className="rounded-lg bg-muted/60 p-4 text-sm">
          <p className="font-medium text-foreground">{t("missingTitle")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {missing.map((item) => (
              <li key={item}>{t(`missing.${item}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href="/professional/dashboard/showcase/preview" target="_blank">
            <Eye className="h-4 w-4" />
            {t("actions.preview")}
          </Link>
        </Button>
        {canSubmit ? (
          <Button
            type="button"
            onClick={() => {
              setAccepted(false);
              setDialog("consent");
            }}
            disabled={busy}
          >
            {t("actions.submit")}
          </Button>
        ) : null}
        {page.status === "published" && view.showcaseEnabled ? (
          <Button asChild variant="ghost">
            <a href={page.publicUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t("actions.viewPublic")}
            </a>
          </Button>
        ) : null}
        {page.status === "published" ? (
          <Button type="button" variant="ghost" onClick={() => setDialog("unpublish")} disabled={busy}>
            {t("actions.unpublish")}
          </Button>
        ) : null}
        {page.status === "unpublished" && page.unpublishedBy === "professional" ? (
          <Button type="button" variant="outline" onClick={() => void post("republish")} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("actions.republish")}
          </Button>
        ) : null}
      </div>

      <Dialog open={dialog === "consent"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("consent.title")}</DialogTitle>
            <DialogDescription>{t("consent.intro")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground">
            <p className="whitespace-pre-line rounded-lg bg-muted/60 p-4 leading-relaxed">{t("consent.text")}</p>
            <p className="text-xs text-muted-foreground">{t("consent.version", { version: view.consentVersion })}</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              {t("consent.checkbox")}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!accepted || busy}
              onClick={async () => {
                if (await post("submit", { consent: true, consentVersion: view.consentVersion })) setDialog(null);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("consent.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "unpublish"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("unpublishDialog.title")}</DialogTitle>
            <DialogDescription>{t("unpublishDialog.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await post("unpublish")) setDialog(null);
              }}
            >
              {t("unpublishDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
