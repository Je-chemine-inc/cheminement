"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
 * Where the professional's published page stands, and their actions:
 * preview, view it, take it down, put it back. The editor below it saves
 * straight to the live page.
 */
export function ShowcaseProStatus({
  view,
  onView,
}: {
  view: ShowcaseEditorJson;
  onView: (next: ShowcaseEditorJson) => void;
}) {
  const t = useTranslations("ShowcasePro");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { page, missing } = view;
  const badge = showcaseBadge(page, view.showcaseEnabled);
  const live = page.status === "published" && view.showcaseEnabled;

  const post = async (path: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/professional/showcase/${path}`, { method: "POST" });
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

      {page.status === "published" ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          {live ? (
            <p>
              {t("statusText.published")}{" "}
              <a href={page.publicUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                {page.publicUrl}
              </a>
            </p>
          ) : (
            <p>{t("statusText.approvedClosed")}</p>
          )}
          <p>{t("statusText.liveEdits")}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {page.unpublishedBy === "professional"
            ? t("statusText.unpublishedByProfessional")
            : t("statusText.unpublishedByAdmin")}
        </p>
      )}

      {live ? (
        <p className="text-sm text-muted-foreground">
          {t("stats.line", { days: view.stats.days, views: view.stats.views, clicks: view.stats.ctaClicks })}
        </p>
      ) : null}

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
        {live ? (
          <Button asChild variant="ghost">
            <a href={page.publicUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t("actions.viewPublic")}
            </a>
          </Button>
        ) : null}
        {page.status === "published" ? (
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
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

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("unpublishDialog.title")}</DialogTitle>
            <DialogDescription>{t("unpublishDialog.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await post("unpublish")) setConfirming(false);
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
