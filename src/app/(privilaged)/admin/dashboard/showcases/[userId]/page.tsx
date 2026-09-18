"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ArrowLeft, Check, ExternalLink, Eye, Loader2 } from "lucide-react";
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
import { useAdminPermissions } from "@/components/admin/AdminPermissionsProvider";
import { AdminAccessRequired } from "@/components/admin/AdminAccessRequired";
import { ShowcaseAvailabilityCard } from "@/components/showcase/ShowcaseAvailabilityCard";
import { ShowcaseEditorForm } from "@/components/showcase/ShowcaseEditorForm";
import { ShowcaseTeamResourcesAdminCard } from "@/components/showcase/ShowcaseTeamResourcesCard";
import { ShowcaseFactsCard } from "@/components/showcase/ShowcaseFactsCard";
import { ShowcaseStatusBadge } from "@/components/showcase/ShowcaseStatusBadge";
import { showcaseBadge } from "@/lib/showcase-badges";
import { showcasePageUrl } from "@/lib/showcase-hosts";
import { SHOWCASE_HISTORY_ACTIONS, SHOWCASE_LIMITS } from "@/lib/showcase-constants";
import { showcaseErrorKey, type ShowcaseAdminJson } from "@/lib/showcase-editor-types";

type DialogKind = "publish" | "unpublish" | "move" | null;

const HISTORY_ACTIONS = new Set<string>(SHOWCASE_HISTORY_ACTIONS);
const ACTORS = new Set(["professional", "admin", "system"]);

/** One professional's showcase page: the admin prepares it, publishes it and follows it (spec 003). */
export default function AdminShowcaseDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const t = useTranslations("ShowcaseAdmin");
  const tErrors = useTranslations("ShowcasePro");
  const locale = useLocale();
  const { manageProfessionals } = useAdminPermissions();

  const [view, setView] = useState<ShowcaseAdminJson | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "missing" | "error">("loading");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [moveSlug, setMoveSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/showcases/${userId}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setState("denied");
        return;
      }
      if (res.status === 404) {
        setState("missing");
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setState("error");
        return;
      }
      setView(body as ShowcaseAdminJson);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [userId]);

  useEffect(() => {
    if (manageProfessionals) void load();
  }, [load, manageProfessionals]);

  if (!manageProfessionals || state === "denied") {
    return <AdminAccessRequired title={t("access.title")} body={t("access.body")} />;
  }

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", { dateStyle: "long", timeStyle: "short" }).format(
          new Date(iso),
        )
      : "";

  const act = async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/admin/showcases/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(tErrors(`errors.${showcaseErrorKey(body?.error)}`));
        return false;
      }
      setView(body as ShowcaseAdminJson);
      setDone(t("detail.done"));
      return true;
    } catch {
      setError(tErrors("errors.network"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openDialog = (kind: Exclude<DialogKind, null>) => {
    setError(null);
    setReason("");
    setAttested(false);
    if (kind === "move" && view) setMoveSlug(view.page.slug);
    setDialog(kind);
  };

  const back = (
    <Link
      href="/admin/dashboard/showcases"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t("detail.back")}
    </Link>
  );

  if (state === "loading" || (state === "ready" && !view)) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (state !== "ready" || !view) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        {back}
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {state === "missing" ? t("detail.notFound") : t("detail.loadError")}
        </p>
      </div>
    );
  }

  const { page, missing, admin } = view;
  const withdrawn = page.status === "unpublished" && page.unpublishedBy === "professional";
  const canPublish = (page.status !== "published" || page.hasUnpublishedChanges) && !withdrawn;
  const needsAttestation = !page.consent.current;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {back}

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{admin.user?.name ?? page.slug}</h1>
          <p className="text-sm text-muted-foreground">{admin.user?.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/dashboard/professionals/${userId}`}>{t("detail.profileLink")}</Link>
          </Button>
          {page.status === "published" && view.showcaseEnabled ? (
            <Button asChild variant="outline" size="sm">
              <a href={page.publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t("detail.publicLink")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-6" aria-labelledby="publication-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="publication-title" className="font-serif text-xl font-light text-foreground">
            {t("detail.reviewTitle")}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("detail.revision", { revision: page.draftRevision })}</span>
            <ShowcaseStatusBadge badge={showcaseBadge(page, view.showcaseEnabled)} />
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <p className="break-all text-foreground">{page.publicUrl}</p>
          <p className={page.consent.current ? "text-muted-foreground" : "text-amber-700"}>
            {!page.consent.current
              ? t("detail.consentMissing")
              : page.consent.source === "admin"
                ? t("detail.consentAttested", { date: formatDate(page.consent.acceptedAt) })
                : t("detail.consentCurrent", { date: formatDate(page.consent.acceptedAt) })}
          </p>
          {page.draftUpdatedBy === "professional" && page.draftUpdatedAt ? (
            <p className="text-muted-foreground">
              {t("detail.lastProfessionalEdit", { date: formatDate(page.draftUpdatedAt) })}
            </p>
          ) : null}
          {page.published && page.hasUnpublishedChanges ? (
            <p className="text-amber-700">{t("detail.unpublishedCorrections")}</p>
          ) : null}
          {withdrawn ? <p className="text-amber-700">{tErrors("errors.WITHDRAWN_BY_PROFESSIONAL")}</p> : null}
        </div>

        {missing.length > 0 ? (
          <div className="rounded-lg bg-muted/60 p-4 text-sm">
            <p className="font-medium text-foreground">{tErrors("missingTitle")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {missing.map((item) => (
                <li key={item}>{tErrors(`missing.${item}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error && dialog === null ? (
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

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/dashboard/showcases/${userId}/preview`} target="_blank">
              <Eye className="h-4 w-4" />
              {t("detail.previewDraft")}
            </Link>
          </Button>
          {page.published ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/dashboard/showcases/${userId}/preview?source=published`} target="_blank">
                <Eye className="h-4 w-4" />
                {t("detail.previewPublished")}
              </Link>
            </Button>
          ) : null}
          {canPublish && missing.length === 0 ? (
            <Button type="button" size="sm" onClick={() => openDialog("publish")} disabled={busy}>
              {page.published ? t("detail.publishChanges") : t("detail.publish")}
            </Button>
          ) : null}
          {page.status === "published" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => openDialog("unpublish")} disabled={busy}>
              {t("detail.unpublish")}
            </Button>
          ) : null}
          {page.status === "unpublished" && page.unpublishedBy === "admin" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void act("republish")} disabled={busy}>
              {t("detail.republish")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => openDialog("move")} disabled={busy}>
            {t("detail.move")}
          </Button>
        </div>
      </section>

      <ShowcaseAvailabilityCard<ShowcaseAdminJson>
        apiBase={`/api/admin/showcases/${userId}`}
        view={view}
        onView={setView}
        reload={load}
        audience="admin"
      />

      <ShowcaseTeamResourcesAdminCard apiBase={`/api/admin/showcases/${userId}`} view={view} reload={load} />

      <ShowcaseFactsCard
        view={view}
        profileHref={`/admin/dashboard/professionals/${userId}`}
        profileLabel={t("detail.profileLink")}
      />

      <div className="space-y-2">
        <h2 className="font-serif text-xl font-light text-foreground">{t("detail.editorTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("detail.editorHint")}</p>
      </div>
      <ShowcaseEditorForm<ShowcaseAdminJson>
        key={userId}
        apiBase={`/api/admin/showcases/${userId}`}
        view={view}
        onView={setView}
        reload={load}
        audience="admin"
      />

      <section className="rounded-xl border border-border/60 bg-card p-6" aria-labelledby="history-title">
        <h2 id="history-title" className="font-serif text-xl font-light text-foreground">
          {t("detail.historyTitle")}
        </h2>
        {admin.history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("detail.historyEmpty")}</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {admin.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-col gap-0.5 border-b border-border/40 pb-2 last:border-0">
                <span className="text-foreground">
                  {HISTORY_ACTIONS.has(entry.action) ? t(`detail.history.${entry.action}`) : entry.action}
                  {" · "}
                  <span className="text-muted-foreground">
                    {ACTORS.has(entry.actor) ? t(`detail.actors.${entry.actor}`) : entry.actor}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{formatDate(entry.at)}</span>
                {entry.note ? <span className="whitespace-pre-line text-xs text-muted-foreground">{entry.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <Dialog open={dialog === "publish"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("detail.publishTitle", { revision: page.draftRevision })}</DialogTitle>
            <DialogDescription>{t("detail.publishBody")}</DialogDescription>
          </DialogHeader>
          {needsAttestation ? (
            <label className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm leading-relaxed text-foreground">
              <input
                type="checkbox"
                className="mt-1"
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
              />
              <span>{t("detail.consentAttest")}</span>
            </label>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy || (needsAttestation && !attested)}
              onClick={async () => {
                const extra = needsAttestation ? { consentAttested: true } : {};
                if (await act("publish", { revision: page.draftRevision, ...extra })) setDialog(null);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {page.published ? t("detail.publishChanges") : t("detail.publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "unpublish"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("detail.unpublishTitle")}</DialogTitle>
            <DialogDescription>{t("detail.unpublishBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="unpublish-reason">{t("detail.reason")}</Label>
            <Textarea
              id="unpublish-reason"
              rows={5}
              value={reason}
              maxLength={SHOWCASE_LIMITS.reviewNotes}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await act("unpublish", { note: reason })) setDialog(null);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("detail.unpublish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "move"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("detail.moveTitle")}</DialogTitle>
            <DialogDescription>{t("detail.moveBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="move-slug">{t("detail.slug")}</Label>
              <Input id="move-slug" value={moveSlug} onChange={(event) => setMoveSlug(event.target.value.toLowerCase())} />
              <p className="break-all text-xs text-muted-foreground">
                {showcasePageUrl(moveSlug.trim())}
              </p>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy || !moveSlug.trim()}
              onClick={async () => {
                if (await act("move", { slug: moveSlug })) setDialog(null);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("detail.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
