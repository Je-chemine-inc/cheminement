"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, ImagePlus, Loader2, Lock, Save, Send, Trash2, Undo2, X } from "lucide-react";
import ContentEntryEditor from "@/components/admin/ContentEntryEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { ArticleEditorView } from "@/lib/articles";
import { ARTICLE_SUMMARY_MAX, ARTICLE_TITLE_MAX, type ArticleRequirement } from "@/lib/article-rules";
import type { ProductModerationStatus } from "@/lib/product-rules";

/**
 * One of the professional's articles: its text (French, optional English), cover and the moves
 * through the team's review. An article under review is read-only.
 */

interface Draft {
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  contentHtmlFr: string;
  contentHtmlEn: string;
  iconUrl: string;
}

const KNOWN_ERRORS = new Set([
  "INVALID_TITLE",
  "INVALID_SUMMARY",
  "INVALID_HTML",
  "HTML_TOO_LARGE",
  "INVALID_IMAGE",
  "UNDER_REVIEW",
  "TRANSITION_NOT_ALLOWED",
  "INCOMPLETE",
  "NOT_FOUND",
  "ACCOUNT_NOT_ACTIVE",
  "FILE_TOO_LARGE",
  "FILE_REJECTED",
]);

const STATUS_STYLES: Record<ProductModerationStatus, string> = {
  draft: "border-border/60 bg-muted/40 text-foreground",
  submitted: "border-amber-200 bg-amber-50 text-amber-900",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-900",
  rejected: "border-red-200 bg-red-50 text-red-900",
  unpublished: "border-slate-300 bg-slate-100 text-slate-900",
};

function toDraft(view: ArticleEditorView): Draft {
  return { ...view.fields, iconUrl: view.fields.iconUrl ?? "" };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function codeOf(res: Response, body: Record<string, unknown>): string {
  if (res.status === 401 || res.status === 403) return "ACCOUNT_NOT_ACTIVE";
  if (res.status === 413) return "FILE_TOO_LARGE";
  const code = typeof body.error === "string" ? body.error : "";
  if (KNOWN_ERRORS.has(code)) return code;
  if (res.status === 415 || res.status === 422) return "FILE_REJECTED";
  return "generic";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <h2 className="font-serif text-lg font-light text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function ProfessionalArticleEditorPage() {
  const t = useTranslations("ArticlesPro");
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const api = `/api/professional/articles/${encodeURIComponent(slug)}`;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ArticleEditorView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [englishOpen, setEnglishOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [dialog, setDialog] = useState<"submit" | "unpublish" | "delete" | null>(null);
  const [attest, setAttest] = useState(false);
  const [acting, setActing] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogMissing, setDialogMissing] = useState<ArticleRequirement[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);

  const errorText = (code: string) => t(`errors.${KNOWN_ERRORS.has(code) ? code : "generic"}`);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(api, { cache: "no-store" });
        const body = await readJson(res);
        if (!active) return;
        if (!res.ok) {
          setLoadError(codeOf(res, body));
          return;
        }
        const next = body as unknown as ArticleEditorView;
        setView(next);
        setDraft(toDraft(next));
      } catch {
        if (active) setLoadError("generic");
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  const refreshView = async () => {
    const res = await fetch(api, { cache: "no-store" });
    if (res.ok) setView((await res.json()) as ArticleEditorView);
  };

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    setNotice(null);
  };

  const save = async (): Promise<boolean> => {
    if (!draft) return false;
    if (!draft.titleFr.trim()) {
      setNotice({ kind: "error", text: errorText("INVALID_TITLE") });
      return false;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, iconUrl: draft.iconUrl || null }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        const code = codeOf(res, body);
        setNotice({ kind: "error", text: errorText(code) });
        if (code === "UNDER_REVIEW") await refreshView();
        return false;
      }
      const next = body as unknown as ArticleEditorView;
      setView(next);
      setDraft(toDraft(next));
      setDirty(false);
      setNotice({ kind: "ok", text: t("editor.saved") });
      return true;
    } catch {
      setNotice({ kind: "error", text: t("errors.generic") });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadCover = async (file: File) => {
    setCoverBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/professional/products/uploads", { method: "POST", body: form });
      const body = await readJson(res);
      if (!res.ok || typeof body.url !== "string") {
        setNotice({ kind: "error", text: errorText(res.ok ? "generic" : codeOf(res, body)) });
        return;
      }
      update({ iconUrl: body.url });
    } catch {
      setNotice({ kind: "error", text: t("errors.generic") });
    } finally {
      setCoverBusy(false);
    }
  };

  const openDialog = (kind: "submit" | "unpublish" | "delete") => {
    setDialog(kind);
    setAttest(false);
    setDialogError(null);
    setDialogMissing([]);
  };

  const runAction = async (action: "submit" | "withdraw" | "unpublish"): Promise<boolean> => {
    const res = await fetch(`${api}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "submit" ? { action, attest: true } : { action }),
    });
    const body = await readJson(res);
    if (res.ok) return true;
    const code = codeOf(res, body);
    if (code === "INCOMPLETE" && Array.isArray(body.missing)) {
      setDialogMissing(body.missing.filter((item): item is ArticleRequirement => typeof item === "string"));
    }
    setDialogError(errorText(code));
    return false;
  };

  const confirmSubmit = async () => {
    if (!attest) return;
    setActing(true);
    setDialogError(null);
    setDialogMissing([]);
    try {
      if (dirty && !(await save())) {
        setDialogError(t("submit.saveFirst"));
        return;
      }
      if (await runAction("submit")) {
        setDialog(null);
        setNotice({ kind: "ok", text: t("submit.done") });
        await refreshView();
      }
    } finally {
      setActing(false);
    }
  };

  const withdraw = async () => {
    setActing(true);
    try {
      const ok = await runAction("withdraw");
      setNotice(ok ? { kind: "ok", text: t("withdraw.done") } : { kind: "error", text: t("errors.generic") });
      await refreshView();
    } finally {
      setActing(false);
    }
  };

  const confirmUnpublish = async () => {
    setActing(true);
    try {
      if (await runAction("unpublish")) {
        setDialog(null);
        setNotice({ kind: "ok", text: t("unpublish.done") });
        await refreshView();
      }
    } finally {
      setActing(false);
    }
  };

  const confirmDelete = async () => {
    setActing(true);
    try {
      const res = await fetch(api, { method: "DELETE" });
      if (res.ok) {
        router.push("/professional/dashboard/articles");
        return;
      }
      setDialogError(errorText(codeOf(res, await readJson(res))));
    } finally {
      setActing(false);
    }
  };

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
      <Link href="/professional/dashboard/articles">
        <ArrowLeft className="h-4 w-4" />
        {t("editor.back")}
      </Link>
    </Button>
  );

  if (loadError) {
    return (
      <div className="min-w-0 space-y-4">
        {backLink}
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError === "NOT_FOUND" || loadError === "ACCOUNT_NOT_ACTIVE" ? errorText(loadError) : t("editor.loadError")}
        </p>
      </div>
    );
  }
  if (!view || !draft) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const status = view.moderation.status;
  const locked = status === "submitted";
  const canSubmit = status === "draft" || status === "rejected" || status === "unpublished";
  const busy = saving || acting || coverBusy;

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 space-y-2">
        {backLink}
        <h1 className="break-words font-serif text-3xl font-light text-foreground">{view.fields.titleFr}</h1>
      </div>

      <div className={`min-w-0 space-y-2 rounded-xl border p-4 text-sm ${STATUS_STYLES[status]}`} data-article-status={status}>
        <p className="font-medium">
          {t(`statuses.${status}`)}
          {view.live ? ` · ${t("badges.live")}` : ""}
          {view.inNews ? ` · ${t("badges.inNews")}` : ""}
        </p>
        <p>
          {status === "unpublished"
            ? t(view.moderation.unpublishedBy === "admin" ? "banner.unpublishedByAdmin" : "banner.unpublishedByProfessional")
            : t(`banner.${status}`)}
        </p>
        {view.moderation.notes && (status === "rejected" || status === "unpublished") ? (
          <div className="rounded-lg bg-background/70 p-3 text-foreground">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("banner.notes")}</p>
            <p className="mt-1 whitespace-pre-line break-words">{view.moderation.notes}</p>
          </div>
        ) : null}
        {view.moderation.changesPending ? <p className="font-medium">{t("banner.changesPending")}</p> : null}
        {view.live ? (
          <a href={view.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 break-all font-medium underline underline-offset-2">
            <ExternalLink className="h-4 w-4 shrink-0" />
            {view.url}
          </a>
        ) : null}
      </div>

      {locked ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("editor.lockedNotice")}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <fieldset disabled={locked} className="min-w-0 space-y-6">
          <Section title={t("fields.sectionFrench")}>
            <div className="grid gap-2">
              <Label htmlFor="titleFr">{t("fields.titleFr")}</Label>
              <Input id="titleFr" value={draft.titleFr} maxLength={ARTICLE_TITLE_MAX} onChange={(event) => update({ titleFr: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="summaryFr">{t("fields.summaryFr")}</Label>
              <Textarea id="summaryFr" rows={3} value={draft.summaryFr} maxLength={ARTICLE_SUMMARY_MAX} onChange={(event) => update({ summaryFr: event.target.value })} />
              <p className="text-xs text-muted-foreground">{t("fields.summaryHint", { count: draft.summaryFr.length, max: ARTICLE_SUMMARY_MAX })}</p>
            </div>
          </Section>

          <Section title={t("fields.sectionCover")}>
            <p className="text-sm text-muted-foreground">{t("fields.coverHint")}</p>
            {draft.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by /api/files
              <img src={draft.iconUrl} alt={t("fields.coverAlt")} className="aspect-video w-full max-w-sm rounded-lg border border-border/60 object-cover" />
            ) : null}
            <input
              ref={coverInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              data-article-cover-input=""
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadCover(file);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => coverInput.current?.click()}>
                {coverBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {draft.iconUrl ? t("fields.replaceCover") : t("fields.uploadCover")}
              </Button>
              {draft.iconUrl ? (
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => update({ iconUrl: "" })}>
                  <X className="h-4 w-4" />
                  {t("fields.removeCover")}
                </Button>
              ) : null}
            </div>
          </Section>

          <Section title={t("fields.contentFr")}>
            <p className="text-xs text-muted-foreground">{t("fields.contentHint")}</p>
            <div inert={locked} className={locked ? "opacity-60" : undefined}>
              <ContentEntryEditor
                value={draft.contentHtmlFr}
                onChange={(html) => update({ contentHtmlFr: html })}
                uploadEndpoint="/api/professional/products/uploads"
                accept="image/png,image/jpeg,image/webp"
              />
            </div>
          </Section>

          <details
            open={englishOpen}
            onToggle={(event) => setEnglishOpen(event.currentTarget.open)}
            className="min-w-0 rounded-xl border border-border/60 bg-card p-4 sm:p-5"
          >
            <summary className="cursor-pointer font-serif text-lg font-light text-foreground">{t("fields.sectionEnglish")}</summary>
            {englishOpen ? (
              <div className="mt-4 min-w-0 space-y-4">
                <p className="text-sm text-muted-foreground">{t("fields.englishHint")}</p>
                <div className="grid gap-2">
                  <Label htmlFor="titleEn">{t("fields.titleEn")}</Label>
                  <Input id="titleEn" value={draft.titleEn} maxLength={ARTICLE_TITLE_MAX} onChange={(event) => update({ titleEn: event.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="summaryEn">{t("fields.summaryEn")}</Label>
                  <Textarea id="summaryEn" rows={3} value={draft.summaryEn} maxLength={ARTICLE_SUMMARY_MAX} onChange={(event) => update({ summaryEn: event.target.value })} />
                </div>
                <div className="grid min-w-0 gap-2">
                  <p className="text-sm font-medium text-foreground">{t("fields.contentEn")}</p>
                  <div inert={locked} className={locked ? "opacity-60" : undefined}>
                    <ContentEntryEditor
                      value={draft.contentHtmlEn}
                      onChange={(html) => update({ contentHtmlEn: html })}
                      uploadEndpoint="/api/professional/products/uploads"
                      accept="image/png,image/jpeg,image/webp"
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </details>
        </fieldset>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
            {notice ? (
              <p
                role={notice.kind === "error" ? "alert" : "status"}
                className={`flex items-start gap-2 text-sm ${notice.kind === "error" ? "text-destructive" : "text-emerald-700"}`}
              >
                {notice.kind === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="min-w-0">{notice.text}</span>
              </p>
            ) : dirty ? (
              <p className="text-sm text-muted-foreground">{t("editor.unsaved")}</p>
            ) : null}
            <Button className="w-full gap-2" onClick={() => void save()} disabled={locked || busy}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? t("editor.saving") : t("editor.save")}
            </Button>
            {canSubmit ? (
              <Button variant="secondary" className="w-full gap-2" onClick={() => openDialog("submit")} disabled={busy}>
                <Send className="h-4 w-4" />
                {t("actions.submit")}
              </Button>
            ) : null}
            {status === "submitted" ? (
              <Button variant="outline" className="w-full gap-2" onClick={() => void withdraw()} disabled={busy}>
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                {t("actions.withdraw")}
              </Button>
            ) : null}
            {status === "approved" ? (
              <Button variant="outline" className="w-full gap-2" onClick={() => openDialog("unpublish")} disabled={busy}>
                <X className="h-4 w-4" />
                {t("actions.unpublish")}
              </Button>
            ) : null}
            <Button asChild variant="outline" className="w-full gap-2">
              <a href={`/nouveautes/${view.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t("actions.view")}
              </a>
            </Button>
            <Button variant="outline" className="w-full gap-2 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => openDialog("delete")} disabled={busy}>
              <Trash2 className="h-4 w-4" />
              {t("actions.delete")}
            </Button>
          </div>

          <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4">
            <h2 className="text-sm font-medium text-foreground">{t("missing.title")}</h2>
            {view.missing.length === 0 ? (
              <p className="flex items-start gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                {t("missing.none")}
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {view.missing.map((item) => (
                  <li key={item}>{t(`requirements.${item}`)}</li>
                ))}
              </ul>
            )}
            {dirty ? <p className="text-xs text-muted-foreground">{t("missing.afterSave")}</p> : null}
          </div>
        </aside>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(isOpen) => !isOpen && !acting && setDialog(null)}>
        <DialogContent>
          {dialog === "submit" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("submit.title")}</DialogTitle>
                <DialogDescription>{t("submit.body")}</DialogDescription>
              </DialogHeader>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={attest} onCheckedChange={(checked) => setAttest(checked === true)} className="mt-0.5" />
                <span className="min-w-0 text-foreground">{t("submit.attest")}</span>
              </label>
              {dialogError ? (
                <div role="alert" className="text-sm text-destructive">
                  <p>{dialogError}</p>
                  {dialogMissing.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5">
                      {dialogMissing.map((item) => (
                        <li key={item}>{t(`requirements.${item}`)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={acting}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={() => void confirmSubmit()} disabled={acting || !attest} className="gap-2">
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("submit.confirm")}
                </Button>
              </DialogFooter>
            </>
          ) : dialog === "unpublish" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("unpublish.title")}</DialogTitle>
                <DialogDescription>{t("unpublish.body")}</DialogDescription>
              </DialogHeader>
              {dialogError ? <p role="alert" className="text-sm text-destructive">{dialogError}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={acting}>
                  {t("common.cancel")}
                </Button>
                <Button variant="destructive" onClick={() => void confirmUnpublish()} disabled={acting}>
                  {t("unpublish.confirm")}
                </Button>
              </DialogFooter>
            </>
          ) : dialog === "delete" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("delete.title")}</DialogTitle>
                <DialogDescription>{t("delete.body")}</DialogDescription>
              </DialogHeader>
              {dialogError ? <p role="alert" className="text-sm text-destructive">{dialogError}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={acting}>
                  {t("common.cancel")}
                </Button>
                <Button variant="destructive" onClick={() => void confirmDelete()} disabled={acting}>
                  {t("delete.confirm")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
