"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
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
import type { ProductEditorView } from "@/lib/products";
import {
  PRODUCT_MAX_PRICE_CENTS,
  PRODUCT_MIN_PRICE_CENTS,
  PRODUCT_SUMMARY_MAX,
  PRODUCT_TITLE_MAX,
  PRODUCT_WEBINAR_MAX_MINUTES,
  type ProductModerationStatus,
  type ProductRequirement,
} from "@/lib/product-rules";

/**
 * One of the professional's trainings or digital products (spec 003 phase 5):
 * its text (French, optional English), price, cover, what the buyer gets, and
 * the moves through review. A product under review is read-only.
 */

type LoadState = { kind: "loading" } | { kind: "error"; code: string } | { kind: "ready" };

interface Draft {
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  contentHtmlFr: string;
  contentHtmlEn: string;
  previewHtmlFr: string;
  previewHtmlEn: string;
  iconUrl: string;
  priceText: string;
  mediaUrlFr: string;
  mediaUrlEn: string;
  externalUrl: string;
  webinarLocal: string;
  webinarDuration: string;
  webinarJoinUrl: string;
  webinarReplayUrl: string;
  listInLibrary: boolean;
}

type Payload = Record<string, string | number | boolean | null>;

const KNOWN_ERRORS = new Set([
  "INVALID_TITLE",
  "INVALID_SUMMARY",
  "INVALID_HTML",
  "HTML_TOO_LARGE",
  "INVALID_PRICE",
  "INVALID_MEDIA_URL",
  "INVALID_LINK",
  "INVALID_WEBINAR",
  "INVALID_IMAGE",
  "INVALID_TYPE",
  "UNDER_REVIEW",
  "TRANSITION_NOT_ALLOWED",
  "INCOMPLETE",
  "HAS_SALES",
  "NOT_FOUND",
  "SCAN_UNAVAILABLE",
  "ACCOUNT_NOT_ACTIVE",
  "FILE_TOO_LARGE",
  "FILE_REJECTED",
]);

const ENGLISH_FIELDS = new Set(["titleEn", "summaryEn", "contentHtmlEn", "previewHtmlEn", "mediaUrlEn"]);

const TORONTO = "America/Toronto";

/** An instant as the wall-clock value of a datetime-local input, in Montréal time. */
function isoToTorontoLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = torontoParts(date.getTime());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function torontoParts(ms: number): Record<"year" | "month" | "day" | "hour" | "minute", string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** A datetime-local value read as Montréal time, to an ISO instant (null when unreadable). */
function torontoLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = torontoParts(guess);
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    if (wall === target) break;
    guess += target - wall;
  }
  return new Date(guess).toISOString();
}

function toDraft(view: ProductEditorView): Draft {
  const f = view.fields;
  return {
    titleFr: f.titleFr,
    titleEn: f.titleEn,
    summaryFr: f.summaryFr,
    summaryEn: f.summaryEn,
    contentHtmlFr: f.contentHtmlFr,
    contentHtmlEn: f.contentHtmlEn,
    previewHtmlFr: f.previewHtmlFr,
    previewHtmlEn: f.previewHtmlEn,
    iconUrl: f.iconUrl ?? "",
    priceText: f.priceCents > 0 ? (f.priceCents / 100).toFixed(2) : "",
    mediaUrlFr: f.mediaUrlFr ?? "",
    mediaUrlEn: f.mediaUrlEn ?? "",
    externalUrl: f.externalUrl ?? "",
    webinarLocal: isoToTorontoLocal(f.webinarStartsAt),
    webinarDuration: f.webinarDurationMinutes ? String(f.webinarDurationMinutes) : "",
    webinarJoinUrl: f.webinarJoinUrl ?? "",
    webinarReplayUrl: f.webinarReplayUrl ?? "",
    listInLibrary: f.listInLibrary,
  };
}

/** The edit to send, checked for what the browser can check; the server checks the rest. */
function buildPayload(
  view: ProductEditorView,
  draft: Draft,
): { ok: true; body: Payload } | { ok: false; code: string; field: string } {
  const orNull = (value: string) => (value.trim() ? value.trim() : null);
  const body: Payload = {
    titleFr: draft.titleFr,
    titleEn: draft.titleEn,
    summaryFr: draft.summaryFr,
    summaryEn: draft.summaryEn,
    contentHtmlFr: draft.contentHtmlFr,
    contentHtmlEn: draft.contentHtmlEn,
    previewHtmlFr: draft.previewHtmlFr,
    previewHtmlEn: draft.previewHtmlEn,
    iconUrl: orNull(draft.iconUrl),
    listInLibrary: draft.listInLibrary,
  };
  if (!draft.titleFr.trim()) return { ok: false, code: "INVALID_TITLE", field: "titleFr" };

  if (view.type !== "external") {
    const text = draft.priceText.trim().replace(/\s/g, "").replace(",", ".");
    if (text) {
      const dollars = Number(text);
      const cents = Math.round(dollars * 100);
      if (!Number.isFinite(dollars) || cents < PRODUCT_MIN_PRICE_CENTS || cents > PRODUCT_MAX_PRICE_CENTS) {
        return { ok: false, code: "INVALID_PRICE", field: "priceCents" };
      }
      body.priceCents = cents;
    } else if (view.fields.priceCents > 0) {
      return { ok: false, code: "INVALID_PRICE", field: "priceCents" };
    }
  }
  if (view.type === "video" || view.type === "audio") {
    body.mediaUrlFr = orNull(draft.mediaUrlFr);
    body.mediaUrlEn = orNull(draft.mediaUrlEn);
  }
  if (view.type === "external") body.externalUrl = orNull(draft.externalUrl);
  if (view.type === "webinar") {
    if (draft.webinarLocal) {
      const iso = torontoLocalToIso(draft.webinarLocal);
      if (!iso) return { ok: false, code: "INVALID_WEBINAR", field: "webinarStartsAt" };
      body.webinarStartsAt = iso;
    } else body.webinarStartsAt = null;
    if (draft.webinarDuration.trim()) {
      const minutes = Number(draft.webinarDuration);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > PRODUCT_WEBINAR_MAX_MINUTES) {
        return { ok: false, code: "INVALID_WEBINAR", field: "webinarDurationMinutes" };
      }
      body.webinarDurationMinutes = minutes;
    } else body.webinarDurationMinutes = null;
    body.webinarJoinUrl = orNull(draft.webinarJoinUrl);
    body.webinarReplayUrl = orNull(draft.webinarReplayUrl);
  }
  return { ok: true, body };
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

const STATUS_STYLES: Record<ProductModerationStatus, string> = {
  draft: "border-border/60 bg-muted/40 text-foreground",
  submitted: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  approved:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
  rejected: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
  unpublished: "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
};

export default function ProfessionalProductEditorPage() {
  const t = useTranslations("ProductsPro");
  const locale = useLocale();
  const tag = locale === "en" ? "en-CA" : "fr-CA";
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const api = `/api/professional/products/${encodeURIComponent(slug)}`;

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [view, setView] = useState<ProductEditorView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; code: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [englishOpen, setEnglishOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState<"fr" | "en" | null>(null);
  const [dialog, setDialog] = useState<"submit" | "unpublish" | "delete" | null>(null);
  const [attest, setAttest] = useState(false);
  const [acting, setActing] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogMissing, setDialogMissing] = useState<ProductRequirement[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);
  const fileInputFr = useRef<HTMLInputElement>(null);
  const fileInputEn = useRef<HTMLInputElement>(null);

  const errorText = (code: string) => t(`errors.${KNOWN_ERRORS.has(code) ? code : "generic"}`);

  const fetchView = async (): Promise<{ ok: true; view: ProductEditorView } | { ok: false; code: string }> => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      const body = await readJson(res);
      if (!res.ok) return { ok: false, code: codeOf(res, body) };
      return { ok: true, view: body as unknown as ProductEditorView };
    } catch {
      return { ok: false, code: "generic" };
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(api, { cache: "no-store" });
        const body = await readJson(res);
        if (!active) return;
        if (!res.ok) {
          setLoad({ kind: "error", code: codeOf(res, body) });
          return;
        }
        const next = body as unknown as ProductEditorView;
        setView(next);
        setDraft(toDraft(next));
        setLoad({ kind: "ready" });
      } catch {
        if (active) setLoad({ kind: "error", code: "generic" });
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  const retry = async () => {
    setLoad({ kind: "loading" });
    const next = await fetchView();
    if (!next.ok) {
      setLoad({ kind: "error", code: next.code });
      return;
    }
    setView(next.view);
    setDraft(toDraft(next.view));
    setDirty(false);
    setLoad({ kind: "ready" });
  };

  /** After a file or a move: the new state, without losing unsaved text. */
  const refreshView = async () => {
    const next = await fetchView();
    if (next.ok) setView(next.view);
  };

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    setNotice(null);
  };

  const save = async (): Promise<boolean> => {
    if (!view || !draft) return false;
    const built = buildPayload(view, draft);
    if (!built.ok) {
      setFieldError({ field: built.field, code: built.code });
      if (ENGLISH_FIELDS.has(built.field)) setEnglishOpen(true);
      setNotice({ kind: "error", text: errorText(built.code) });
      return false;
    }
    setSaving(true);
    setNotice(null);
    setFieldError(null);
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const body = await readJson(res);
      if (!res.ok) {
        const code = codeOf(res, body);
        const field = typeof body.field === "string" ? body.field : null;
        if (field) {
          setFieldError({ field, code });
          if (ENGLISH_FIELDS.has(field)) setEnglishOpen(true);
        }
        setNotice({ kind: "error", text: errorText(code) });
        if (code === "UNDER_REVIEW") await refreshView();
        return false;
      }
      const next = body as unknown as ProductEditorView;
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

  const uploadFile = async (file: File, fileLocale: "fr" | "en") => {
    setFileBusy(fileLocale);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("locale", fileLocale);
      const res = await fetch(`${api}/file`, { method: "POST", body: form });
      const body = await readJson(res);
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(codeOf(res, body)) });
        return;
      }
      setNotice({ kind: "ok", text: t("fields.fileUploaded") });
      await refreshView();
    } catch {
      setNotice({ kind: "error", text: t("errors.generic") });
    } finally {
      setFileBusy(null);
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
      setDialogMissing(body.missing.filter((item): item is ProductRequirement => typeof item === "string"));
    }
    setDialogError(errorText(code));
    if (code === "TRANSITION_NOT_ALLOWED") await refreshView();
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
    } catch {
      setDialogError(t("errors.generic"));
    } finally {
      setActing(false);
    }
  };

  const withdraw = async () => {
    setActing(true);
    setNotice(null);
    try {
      const res = await fetch(`${api}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      const body = await readJson(res);
      setNotice(res.ok ? { kind: "ok", text: t("withdraw.done") } : { kind: "error", text: errorText(codeOf(res, body)) });
      await refreshView();
    } catch {
      setNotice({ kind: "error", text: t("errors.generic") });
    } finally {
      setActing(false);
    }
  };

  const confirmUnpublish = async () => {
    setActing(true);
    setDialogError(null);
    try {
      if (await runAction("unpublish")) {
        setDialog(null);
        setNotice({ kind: "ok", text: t("unpublish.done") });
        await refreshView();
      }
    } catch {
      setDialogError(t("errors.generic"));
    } finally {
      setActing(false);
    }
  };

  const confirmDelete = async () => {
    setActing(true);
    setDialogError(null);
    try {
      const res = await fetch(api, { method: "DELETE" });
      const body = await readJson(res);
      if (res.ok) {
        router.push("/professional/dashboard/products");
        return;
      }
      const code = codeOf(res, body);
      setDialogError(code === "HAS_SALES" ? t("delete.hasSales") : errorText(code));
    } catch {
      setDialogError(t("errors.generic"));
    } finally {
      setActing(false);
    }
  };

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
      <Link href="/professional/dashboard/products">
        <ArrowLeft className="h-4 w-4" />
        {t("editor.back")}
      </Link>
    </Button>
  );

  if (load.kind === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (load.kind === "error" || !view || !draft) {
    const code = load.kind === "error" ? load.code : "generic";
    return (
      <div className="min-w-0 space-y-4">
        {backLink}
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {code === "NOT_FOUND" || code === "ACCOUNT_NOT_ACTIVE" ? errorText(code) : t("editor.loadError")}
          </p>
          {code !== "NOT_FOUND" && code !== "ACCOUNT_NOT_ACTIVE" ? (
            <Button variant="outline" size="sm" onClick={() => void retry()} className="gap-1">
              <RefreshCw className="h-4 w-4" />
              {t("editor.retry")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const status = view.moderation.status;
  const locked = status === "submitted";
  const canSubmit = status === "draft" || status === "rejected" || status === "unpublished";
  const busy = saving || acting || coverBusy || fileBusy !== null;
  const publicUrl = view.url || `/book/${view.slug}`;
  const fileSize = (bytes: number) =>
    bytes >= 1024 * 1024
      ? new Intl.NumberFormat(tag, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))
      : new Intl.NumberFormat(tag, { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024));

  const errorFor = (field: string) =>
    fieldError?.field === field ? (
      <p role="alert" className="text-sm text-destructive">
        {errorText(fieldError.code)}
      </p>
    ) : null;

  const invalid = (field: string) => (fieldError?.field === field ? true : undefined);

  const statusBanner = (
    <div className={`min-w-0 space-y-2 rounded-xl border p-4 text-sm ${STATUS_STYLES[status]}`}>
      <p className="font-medium">
        {t(`statuses.${status}`)}
        {view.live ? ` · ${t("badges.live")}` : ""}
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
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 break-all font-medium underline underline-offset-2"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          {publicUrl}
        </a>
      ) : null}
    </div>
  );

  const englishSummaryField = (
    <div className="grid gap-2">
      <Label htmlFor="summaryEn">{t("fields.summaryEn")}</Label>
      <Textarea
        id="summaryEn"
        value={draft.summaryEn}
        maxLength={PRODUCT_SUMMARY_MAX}
        rows={3}
        aria-invalid={invalid("summaryEn")}
        onChange={(event) => update({ summaryEn: event.target.value })}
      />
      {errorFor("summaryEn")}
    </div>
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 space-y-2">
        {backLink}
        <h1 className="break-words text-3xl font-serif font-light text-foreground">{view.fields.titleFr}</h1>
        <p className="text-sm text-muted-foreground">
          {t(`types.${view.type}`)} · {t("editor.sales", { count: view.sales })}
        </p>
      </div>

      {statusBanner}

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
              <Input
                id="titleFr"
                value={draft.titleFr}
                maxLength={PRODUCT_TITLE_MAX}
                aria-invalid={invalid("titleFr")}
                onChange={(event) => update({ titleFr: event.target.value })}
              />
              {errorFor("titleFr")}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="summaryFr">{t("fields.summaryFr")}</Label>
              <Textarea
                id="summaryFr"
                value={draft.summaryFr}
                maxLength={PRODUCT_SUMMARY_MAX}
                rows={3}
                aria-invalid={invalid("summaryFr")}
                onChange={(event) => update({ summaryFr: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t("fields.summaryHint", { count: draft.summaryFr.length, max: PRODUCT_SUMMARY_MAX })}
              </p>
              {errorFor("summaryFr")}
            </div>
          </Section>

          <Section title={t("fields.sectionPrice")}>
            {view.type === "external" ? (
              <p className="text-sm text-muted-foreground">{t("fields.externalFree")}</p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="price">{t("fields.price")}</Label>
                <div className="flex max-w-xs items-center gap-2">
                  <Input
                    id="price"
                    inputMode="decimal"
                    value={draft.priceText}
                    aria-invalid={invalid("priceCents")}
                    onChange={(event) => update({ priceText: event.target.value })}
                  />
                  <span className="text-sm text-muted-foreground">$</span>
                </div>
                <p className="text-xs text-muted-foreground">{t("fields.priceHint")}</p>
                {errorFor("priceCents")}
              </div>
            )}
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={draft.listInLibrary}
                onCheckedChange={(checked) => update({ listInLibrary: checked === true })}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="font-medium text-foreground">{t("fields.listInLibrary")}</span>
                <span className="block text-muted-foreground">{t("fields.listInLibraryHint")}</span>
              </span>
            </label>
          </Section>

          <Section title={t("fields.sectionCover")}>
            <p className="text-sm text-muted-foreground">{t("fields.coverHint")}</p>
            {draft.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by /api/files
              <img
                src={draft.iconUrl}
                alt={t("fields.coverAlt")}
                className="aspect-video w-full max-w-sm rounded-lg border border-border/60 object-cover"
              />
            ) : null}
            <input
              ref={coverInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
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
            {errorFor("iconUrl")}
          </Section>

          <Section title={t("fields.sectionDelivery")}>
            {view.type === "video" || view.type === "audio" ? (
              <div className="grid gap-2">
                <Label htmlFor="mediaUrlFr">{t("fields.mediaUrlFr")}</Label>
                <Input
                  id="mediaUrlFr"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={draft.mediaUrlFr}
                  aria-invalid={invalid("mediaUrlFr")}
                  onChange={(event) => update({ mediaUrlFr: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t(view.type === "video" ? "fields.mediaHintVideo" : "fields.mediaHintAudio")}
                </p>
                {errorFor("mediaUrlFr")}
              </div>
            ) : null}

            {view.type === "pdf" ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium text-foreground">{t("fields.fileFr")}</p>
                <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-all">
                    {view.file.fr ? `${view.file.fr.name} (${fileSize(view.file.fr.size)})` : t("fields.noFile")}
                  </span>
                </p>
                <input
                  ref={fileInputFr}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadFile(file, "fr");
                  }}
                />
                <div>
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => fileInputFr.current?.click()}>
                    {fileBusy === "fr" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {view.file.fr ? t("fields.replaceFile") : t("fields.uploadFile")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("fields.fileHint")}</p>
              </div>
            ) : null}

            {view.type === "webinar" ? (
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="webinarStartsAt">{t("fields.webinarStartsAt")}</Label>
                    <Input
                      id="webinarStartsAt"
                      type="datetime-local"
                      value={draft.webinarLocal}
                      aria-invalid={invalid("webinarStartsAt")}
                      onChange={(event) => update({ webinarLocal: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">{t("fields.webinarTimezone")}</p>
                    {errorFor("webinarStartsAt")}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="webinarDuration">{t("fields.webinarDuration")}</Label>
                    <Input
                      id="webinarDuration"
                      type="number"
                      inputMode="numeric"
                      min={15}
                      max={PRODUCT_WEBINAR_MAX_MINUTES}
                      step={5}
                      value={draft.webinarDuration}
                      aria-invalid={invalid("webinarDurationMinutes")}
                      onChange={(event) => update({ webinarDuration: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("fields.webinarDurationHint", { max: PRODUCT_WEBINAR_MAX_MINUTES })}
                    </p>
                    {errorFor("webinarDurationMinutes")}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t("fields.webinarRemindersHint")}</p>
                <div className="grid gap-2">
                  <Label htmlFor="webinarJoinUrl">{t("fields.webinarJoinUrl")}</Label>
                  <Input
                    id="webinarJoinUrl"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.webinarJoinUrl}
                    aria-invalid={invalid("webinarJoinUrl")}
                    onChange={(event) => update({ webinarJoinUrl: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t("fields.webinarJoinHint")}</p>
                  {errorFor("webinarJoinUrl")}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="webinarReplayUrl">{t("fields.webinarReplayUrl")}</Label>
                  <Input
                    id="webinarReplayUrl"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.webinarReplayUrl}
                    aria-invalid={invalid("webinarReplayUrl")}
                    onChange={(event) => update({ webinarReplayUrl: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t("fields.webinarReplayHint")}</p>
                  {errorFor("webinarReplayUrl")}
                </div>
              </div>
            ) : null}

            {view.type === "external" ? (
              <div className="grid gap-2">
                <Label htmlFor="externalUrl">{t("fields.externalUrl")}</Label>
                <Input
                  id="externalUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={draft.externalUrl}
                  aria-invalid={invalid("externalUrl")}
                  onChange={(event) => update({ externalUrl: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t("fields.externalHint")}</p>
                {errorFor("externalUrl")}
              </div>
            ) : null}
          </Section>

          <Section title={t("fields.sectionBody")}>
            <div className="grid min-w-0 gap-2">
              <p className="text-sm font-medium text-foreground">{t("fields.previewFr")}</p>
              <p className="text-xs text-muted-foreground">{t("fields.previewHint")}</p>
              <div inert={locked} className={locked ? "opacity-60" : undefined}>
                <ContentEntryEditor
                  value={draft.previewHtmlFr}
                  onChange={(html) => update({ previewHtmlFr: html })}
                  uploadEndpoint="/api/professional/products/uploads"
                  accept="image/png,image/jpeg,image/webp"
                />
              </div>
              {errorFor("previewHtmlFr")}
            </div>
            <div className="grid min-w-0 gap-2">
              <p className="text-sm font-medium text-foreground">{t("fields.contentFr")}</p>
              <p className="text-xs text-muted-foreground">
                {t(view.type === "external" ? "fields.contentHintExternal" : "fields.contentHint")}
              </p>
              <div inert={locked} className={locked ? "opacity-60" : undefined}>
                <ContentEntryEditor
                  value={draft.contentHtmlFr}
                  onChange={(html) => update({ contentHtmlFr: html })}
                  uploadEndpoint="/api/professional/products/uploads"
                  accept="image/png,image/jpeg,image/webp"
                />
              </div>
              {errorFor("contentHtmlFr")}
            </div>
          </Section>

          <details
            open={englishOpen}
            onToggle={(event) => setEnglishOpen(event.currentTarget.open)}
            className="min-w-0 rounded-xl border border-border/60 bg-card p-4 sm:p-5"
          >
            <summary className="cursor-pointer font-serif text-lg font-light text-foreground">
              {t("fields.sectionEnglish")}
            </summary>
            {englishOpen ? (
              <div className="mt-4 min-w-0 space-y-4">
                <p className="text-sm text-muted-foreground">{t("fields.englishHint")}</p>
                <div className="grid gap-2">
                  <Label htmlFor="titleEn">{t("fields.titleEn")}</Label>
                  <Input
                    id="titleEn"
                    value={draft.titleEn}
                    maxLength={PRODUCT_TITLE_MAX}
                    aria-invalid={invalid("titleEn")}
                    onChange={(event) => update({ titleEn: event.target.value })}
                  />
                  {errorFor("titleEn")}
                </div>
                {englishSummaryField}
                {view.type === "video" || view.type === "audio" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="mediaUrlEn">{t("fields.mediaUrlEn")}</Label>
                    <Input
                      id="mediaUrlEn"
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      value={draft.mediaUrlEn}
                      aria-invalid={invalid("mediaUrlEn")}
                      onChange={(event) => update({ mediaUrlEn: event.target.value })}
                    />
                    {errorFor("mediaUrlEn")}
                  </div>
                ) : null}
                {view.type === "pdf" ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-foreground">{t("fields.fileEn")}</p>
                    <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-all">
                        {view.file.en ? `${view.file.en.name} (${fileSize(view.file.en.size)})` : t("fields.noFile")}
                      </span>
                    </p>
                    <input
                      ref={fileInputEn}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadFile(file, "en");
                      }}
                    />
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => fileInputEn.current?.click()}
                      >
                        {fileBusy === "en" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {view.file.en ? t("fields.replaceFile") : t("fields.uploadFile")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("fields.fileEnHint")}</p>
                  </div>
                ) : null}
                <div className="grid min-w-0 gap-2">
                  <p className="text-sm font-medium text-foreground">{t("fields.previewEn")}</p>
                  <div inert={locked} className={locked ? "opacity-60" : undefined}>
                    <ContentEntryEditor
                      value={draft.previewHtmlEn}
                      onChange={(html) => update({ previewHtmlEn: html })}
                      uploadEndpoint="/api/professional/products/uploads"
                      accept="image/png,image/jpeg,image/webp"
                    />
                  </div>
                  {errorFor("previewHtmlEn")}
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
                  {errorFor("contentHtmlEn")}
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
                className={`flex items-start gap-2 text-sm ${notice.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}
              >
                {notice.kind === "error" ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                )}
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
              <a href={`/book/${view.slug}`} target="_blank" rel="noopener noreferrer">
                <Eye className="h-4 w-4" />
                {t("actions.preview")}
              </a>
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => openDialog("delete")}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" />
              {t("actions.delete")}
            </Button>
          </div>

          <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4">
            <h2 className="text-sm font-medium text-foreground">{t("missing.title")}</h2>
            {view.missing.length === 0 ? (
              <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
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

      <Dialog
        open={dialog !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !acting) setDialog(null);
        }}
      >
        <DialogContent>
          {dialog === "submit" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("submit.title")}</DialogTitle>
                <DialogDescription>{t("submit.body")}</DialogDescription>
              </DialogHeader>
              {view.missing.length > 0 && dialogMissing.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  <p>{t("submit.stillMissing")}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {view.missing.map((item) => (
                      <li key={item}>{t(`requirements.${item}`)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
              {dialogError ? (
                <p role="alert" className="text-sm text-destructive">
                  {dialogError}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={acting}>
                  {t("common.cancel")}
                </Button>
                <Button variant="destructive" onClick={() => void confirmUnpublish()} disabled={acting} className="gap-2">
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("unpublish.confirm")}
                </Button>
              </DialogFooter>
            </>
          ) : dialog === "delete" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("delete.title")}</DialogTitle>
                <DialogDescription>{view.sales > 0 ? t("delete.hasSales") : t("delete.body")}</DialogDescription>
              </DialogHeader>
              {dialogError ? (
                <p role="alert" className="text-sm text-destructive">
                  {dialogError}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={acting}>
                  {t("common.cancel")}
                </Button>
                <Button variant="destructive" onClick={() => void confirmDelete()} disabled={acting} className="gap-2">
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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
