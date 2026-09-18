"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowDown, ArrowUp, Check, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PROFESSIONAL_ORDER_CODES,
  SHOWCASE_LIMITS,
  SHOWCASE_PHOTO,
  type ProfessionalOrderCode,
} from "@/lib/showcase-constants";
import { aboutHeadingMessage } from "@/lib/showcase-customization";
import {
  SHOWCASE_ADMIN_WORDED_KEYS,
  showcaseErrorKey,
  type ShowcaseAdminWordedKey,
  type ShowcaseContentJson,
  type ShowcaseEditorJson,
} from "@/lib/showcase-editor-types";
import {
  REQUIRED_SHOWCASE_SECTIONS,
  SHOWCASE_ACCENTS,
  SHOWCASE_ACCENT_KEYS,
  SHOWCASE_TEXT_DEFAULTS,
  SHOWCASE_TEXT_GROUPS,
  SHOWCASE_TEXT_KEYS,
  SHOWCASE_TEXT_LIMITS,
  type ShowcaseAccentKey,
  type ShowcaseSectionKey,
  type ShowcaseTextKey,
} from "@/lib/showcase-customization";

/**
 * The content of a showcase page (spec 003): photo, presentation (French,
 * optional English), expertises, order, city, and the consultations the page
 * offers. An admin prepares the draft and sets every field; the professional
 * edits their published page live and sees the order and the city read-only,
 * since those are the admin's. `apiBase` is the page's route:
 * /api/professional/showcase or /api/admin/showcases/<userId>.
 *
 * Text is plain: the server keeps paragraphs and drops everything else.
 */

type Lang = "fr" | "en";
type Localized = { fr: string; en: string };
type LocalizedField = "headline" | "intro" | "bio" | "approach" | "insuranceNote" | "quote";
type LineListField = "highlights" | "credentials";
type CardListField = "focusAreas" | "methods";
type Card = Record<string, Localized>;

interface DraftState {
  displayName: string;
  headline: Localized;
  intro: Localized;
  bio: Localized;
  approach: Localized;
  insuranceNote: Localized;
  quote: Localized;
  highlights: Localized[];
  credentials: Localized[];
  focusAreas: Card[];
  methods: Card[];
  expertiseIds: string[];
  orderCode: ProfessionalOrderCode | "";
  orderLabel: string;
  texts: Record<ShowcaseTextKey, Localized>;
  sectionOrder: ShowcaseSectionKey[];
  hiddenSections: ShowcaseSectionKey[];
  accent: ShowcaseAccentKey;
}

const FIELD_LIMITS: Record<LocalizedField, number> = {
  headline: SHOWCASE_LIMITS.headline,
  intro: SHOWCASE_LIMITS.intro,
  bio: SHOWCASE_LIMITS.bio,
  approach: SHOWCASE_LIMITS.approach,
  insuranceNote: SHOWCASE_LIMITS.insuranceNote,
  quote: SHOWCASE_LIMITS.quote,
};

const LINE_LISTS: Record<LineListField, { items: number; length: number }> = {
  highlights: { items: SHOWCASE_LIMITS.highlights, length: SHOWCASE_LIMITS.highlightLength },
  credentials: { items: SHOWCASE_LIMITS.credentials, length: SHOWCASE_LIMITS.credentialLength },
};

/** Each card's parts: key, length limit, and 1 for a single line or the textarea's rows. */
const CARD_LISTS: Record<CardListField, { items: number; parts: readonly (readonly [part: string, max: number, rows: number])[] }> = {
  focusAreas: {
    items: SHOWCASE_LIMITS.focusAreas,
    parts: [
      ["title", SHOWCASE_LIMITS.focusTitle, 1],
      ["body", SHOWCASE_LIMITS.focusBody, 3],
    ],
  },
  methods: {
    items: SHOWCASE_LIMITS.methods,
    parts: [
      ["name", SHOWCASE_LIMITS.methodName, 1],
      ["title", SHOWCASE_LIMITS.methodTitle, 1],
      ["body", SHOWCASE_LIMITS.methodBody, 3],
    ],
  },
};

const filled = (value: Localized | undefined) => Boolean(value && (value.fr.trim() || value.en.trim()));

function toDraftState(
  content: ShowcaseContentJson,
  offered: readonly { id: string }[],
): DraftState {
  const offeredIds = new Set(offered.map((option) => option.id));
  const copy = (value: Localized) => ({ fr: value.fr, en: value.en });
  return {
    displayName: content.displayName,
    headline: copy(content.headline),
    intro: copy(content.intro),
    bio: copy(content.bio),
    approach: copy(content.approach),
    insuranceNote: copy(content.insuranceNote),
    quote: copy(content.quote),
    highlights: content.highlights.map(copy),
    credentials: content.credentials.map(copy),
    focusAreas: content.focusAreas.map((card) => ({ title: copy(card.title), body: copy(card.body) })),
    methods: content.methods.map((card) => ({ name: copy(card.name), title: copy(card.title), body: copy(card.body) })),
    // An expertise no longer offered on pages would be refused on save.
    expertiseIds: content.expertiseIds.filter((id) => offeredIds.has(id)),
    orderCode: content.orderCode ?? "",
    orderLabel: content.orderLabel,
    texts: Object.fromEntries(SHOWCASE_TEXT_KEYS.map((key) => [key, copy(content.texts[key])])) as Record<ShowcaseTextKey, Localized>,
    sectionOrder: [...content.sectionOrder],
    hiddenSections: [...content.hiddenSections],
    accent: content.accent,
  };
}

export function ShowcaseEditorForm<V extends ShowcaseEditorJson>({
  apiBase,
  view,
  onView,
  reload,
  audience = "professional",
}: {
  apiBase: string;
  view: V;
  onView: (next: V) => void;
  reload: () => Promise<void>;
  /** Who is editing: the city notes speak to the professional, or about them to an admin. */
  audience?: "professional" | "admin";
}) {
  const t = useTranslations("ShowcasePro");
  const tAdmin = useTranslations("ShowcaseAdmin");
  const worded = (key: ShowcaseAdminWordedKey, values?: Record<string, string>) =>
    audience === "admin" ? tAdmin(`editor.${key}`, values) : t(key, values);
  // Headline and insurance examples are sample page text, the same for both; the others address the reader.
  const placeholderOf = (field: LocalizedField) => {
    const key = `fields.${field}Placeholder`;
    return (SHOWCASE_ADMIN_WORDED_KEYS as readonly string[]).includes(key)
      ? worded(key as ShowcaseAdminWordedKey)
      : t(key);
  };
  const tLabels = useTranslations("Showcase");
  const [draft, setDraft] = useState<DraftState>(() =>
    toDraftState(view.page.draft, view.expertiseOptions),
  );
  const [lang, setLang] = useState<Lang>("fr");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [officeBusy, setOfficeBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const officeInput = useRef<HTMLInputElement>(null);
  const officePhoto = view.page.draft.officePhotos[0] ?? null;

  const errorText = (code: unknown) => t(`errors.${showcaseErrorKey(code)}`);

  const update = (patch: Partial<DraftState>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setNotice(null);
  };

  const setLocalized = (field: LocalizedField, value: string) => {
    setDraft((current) => ({ ...current, [field]: { ...current[field], [lang]: value } }));
    setDirty(true);
    setNotice(null);
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName,
          headline: draft.headline,
          intro: draft.intro,
          bio: draft.bio,
          approach: draft.approach,
          insuranceNote: draft.insuranceNote,
          quote: draft.quote,
          highlights: draft.highlights.filter(filled),
          credentials: draft.credentials.filter(filled),
          focusAreas: draft.focusAreas.filter((card) => Object.values(card).some(filled)),
          methods: draft.methods.filter((card) => Object.values(card).some(filled)),
          expertiseIds: draft.expertiseIds,
          texts: draft.texts,
          sectionOrder: draft.sectionOrder,
          hiddenSections: draft.hiddenSections,
          accent: draft.accent,
          ...(audience === "admin"
            ? {
                orderCode: draft.orderCode || null,
                orderLabel: draft.orderCode === "other" ? draft.orderLabel : "",
              }
            : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      const next = body as V;
      onView(next);
      setDraft(toDraftState(next.page.draft, next.expertiseOptions));
      setDirty(false);
      setNotice({ kind: "ok", text: audience === "admin" ? t("editor.saved") : t("editor.savedLive") });
    } catch {
      setNotice({ kind: "error", text: t("errors.network") });
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setNotice(null);
    if (!(SHOWCASE_PHOTO.types as readonly string[]).includes(file.type)) {
      setNotice({ kind: "error", text: t("errors.PHOTO_INVALID") });
      return;
    }
    if (file.size > SHOWCASE_PHOTO.maxBytes) {
      setNotice({ kind: "error", text: t("errors.PHOTO_TOO_LARGE") });
      return;
    }
    setPhotoBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${apiBase}/photo`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      await reload();
    } catch {
      setNotice({ kind: "error", text: t("errors.network") });
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadOfficePhoto = async (file: File) => {
    setNotice(null);
    if (!(SHOWCASE_PHOTO.types as readonly string[]).includes(file.type)) {
      setNotice({ kind: "error", text: t("errors.PHOTO_INVALID") });
      return;
    }
    if (file.size > SHOWCASE_PHOTO.maxBytes) {
      setNotice({ kind: "error", text: t("errors.PHOTO_TOO_LARGE") });
      return;
    }
    setOfficeBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${apiBase}/office-photos`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      await reload();
    } catch {
      setNotice({ kind: "error", text: t("errors.network") });
    } finally {
      setOfficeBusy(false);
    }
  };

  const removeOfficePhoto = async (fileId: string) => {
    setOfficeBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/office-photos/${fileId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      await reload();
    } catch {
      setNotice({ kind: "error", text: t("errors.network") });
    } finally {
      setOfficeBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/photo`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      await reload();
    } catch {
      setNotice({ kind: "error", text: t("errors.network") });
    } finally {
      setPhotoBusy(false);
    }
  };

  const toggleExpertise = (id: string) => {
    const selected = draft.expertiseIds.includes(id);
    update({
      expertiseIds: selected
        ? draft.expertiseIds.filter((current) => current !== id)
        : [...draft.expertiseIds, id],
    });
  };

  const renderCounter = (length: number, max: number) => (
    <p className={`text-xs ${length > max ? "text-destructive" : "text-muted-foreground"}`}>
      {t("fields.characters", { count: length, max })}
    </p>
  );

  const renderLocalized = (field: LocalizedField, rows: number) => {
    const id = `showcase-${field}-${lang}`;
    const value = draft[field][lang];
    const max = FIELD_LIMITS[field];
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{t(`fields.${field}`)}</Label>
        {rows === 1 ? (
          <Input
            id={id}
            value={value}
            maxLength={max}
            placeholder={lang === "fr" ? placeholderOf(field) : ""}
            onChange={(event) => setLocalized(field, event.target.value)}
          />
        ) : (
          <Textarea
            id={id}
            value={value}
            rows={rows}
            maxLength={max}
            placeholder={lang === "fr" ? placeholderOf(field) : ""}
            onChange={(event) => setLocalized(field, event.target.value)}
          />
        )}
        {renderCounter(value.length, max)}
      </div>
    );
  };

  const setLineList = (field: LineListField, items: Localized[]) =>
    update(field === "highlights" ? { highlights: items } : { credentials: items });
  const setCardList = (field: CardListField, cards: Card[]) =>
    update(field === "focusAreas" ? { focusAreas: cards } : { methods: cards });

  /** Short lines, written in the language tab shown. */
  const renderLineList = (field: LineListField) => {
    const { items: maxItems, length } = LINE_LISTS[field];
    const items = draft[field];
    return (
      <div className="space-y-2">
        <Label>{t(`fields.${field}`)}</Label>
        <p className="text-xs text-muted-foreground">{t(`fields.${field}Hint`)}</p>
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                aria-label={`${t(`fields.${field}`)} ${index + 1}`}
                value={item[lang]}
                maxLength={length}
                onChange={(event) =>
                  setLineList(
                    field,
                    items.map((current, i) => (i === index ? { ...current, [lang]: event.target.value } : current)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("fields.removeItem")}
                onClick={() => setLineList(field, items.filter((_, i) => i !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {items.length < maxItems ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setLineList(field, [...items, { fr: "", en: "" }])}>
            <Plus className="h-4 w-4" />
            {t(`fields.${field}Add`)}
          </Button>
        ) : null}
      </div>
    );
  };

  /** Cards of several parts (focus areas, methods), written in the language tab shown. */
  const renderCardList = (field: CardListField) => {
    const { items: maxItems, parts } = CARD_LISTS[field];
    const cards = draft[field];
    return (
      <div className="space-y-3">
        <Label>{t(`fields.${field}`)}</Label>
        <p className="text-xs text-muted-foreground">{t(`fields.${field}Hint`)}</p>
        <ul className="space-y-3">
          {cards.map((card, index) => (
            <li key={index} data-card-list={field} className="space-y-3 rounded-lg border border-border/60 p-4">
              {parts.map(([part, max, rows]) => {
                const id = `showcase-${field}-${index}-${part}-${lang}`;
                const value = card[part]?.[lang] ?? "";
                const change = (text: string) =>
                  setCardList(
                    field,
                    cards.map((current, i) =>
                      i === index ? { ...current, [part]: { ...(current[part] ?? { fr: "", en: "" }), [lang]: text } } : current,
                    ),
                  );
                return (
                  <div key={part} className="space-y-1">
                    <Label htmlFor={id} className="text-xs">
                      {t(`fields.${field}Parts.${part}`)}
                    </Label>
                    {rows === 1 ? (
                      <Input id={id} value={value} maxLength={max} onChange={(event) => change(event.target.value)} />
                    ) : (
                      <Textarea id={id} rows={rows} value={value} maxLength={max} onChange={(event) => change(event.target.value)} />
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="ghost" size="sm" onClick={() => setCardList(field, cards.filter((_, i) => i !== index))}>
                <Trash2 className="h-4 w-4" />
                {t("fields.removeItem")}
              </Button>
            </li>
          ))}
        </ul>
        {cards.length < maxItems ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCardList(field, [...cards, Object.fromEntries(parts.map(([part]) => [part, { fr: "", en: "" }]))])}
          >
            <Plus className="h-4 w-4" />
            {t(`fields.${field}Add`)}
          </Button>
        ) : null}
      </div>
    );
  };

  // ---- « Personnaliser la page »: texts, sections, colour, photos
  const setText = (key: ShowcaseTextKey, value: string) =>
    update({ texts: { ...draft.texts, [key]: { ...draft.texts[key], [lang]: value } } });
  const moveSection = (index: number, step: -1 | 1) => {
    const target = index + step;
    if (target < 0 || target >= draft.sectionOrder.length) return;
    const order = [...draft.sectionOrder];
    [order[index], order[target]] = [order[target], order[index]];
    update({ sectionOrder: order });
  };
  const toggleSection = (key: ShowcaseSectionKey) =>
    update({
      hiddenSections: draft.hiddenSections.includes(key)
        ? draft.hiddenSections.filter((current) => current !== key)
        : [...draft.hiddenSections, key],
    });
  // The wording a blank text keeps, as the page would show it.
  // The « À propos » title follows the page's rule (title and years), the others take the name and city.
  const defaultText = (key: ShowcaseTextKey) => {
    if (key !== "aboutTitle") return tLabels(SHOWCASE_TEXT_DEFAULTS[key], { name: draft.displayName || "…", city: view.page.cityName });
    const { titleKey, titleLabel, yearsOfExperience } = view.profileFacts;
    const title = titleKey ? tLabels(`titles.${titleKey}`) : titleLabel;
    const about = aboutHeadingMessage({ title, years: yearsOfExperience, name: draft.displayName || "…" });
    return tLabels(about.key, about.values);
  };

  const languageTabs = (
    <div role="tablist" aria-label={t("presentation.language")} className="flex rounded-full bg-muted p-1">
      {(["fr", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          role="tab"
          aria-selected={lang === code}
          onClick={() => setLang(code)}
          className={`rounded-full px-4 py-1.5 text-sm font-light transition-colors ${
            lang === code ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {code === "fr" ? t("presentation.french") : t("presentation.english")}
        </button>
      ))}
    </div>
  );

  const expertiseCount = draft.expertiseIds.length;
  const cardClass = "rounded-xl bg-card p-6";
  const switchClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-primary" : "bg-muted"}`;
  const knobClass = (on: boolean) =>
    `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? "translate-x-5" : "translate-x-0"}`;

  return (
    <div className="space-y-6">
      <section className={cardClass} aria-labelledby="showcase-photo-title">
        <h2 id="showcase-photo-title" className="font-serif text-xl font-light text-foreground">
          {t("photo.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("photo.hint")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="relative flex h-36 w-28 items-center justify-center overflow-hidden rounded-xl bg-muted">
            {view.page.draft.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.page.draft.photoUrl} alt={t("photo.alt")} className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={SHOWCASE_PHOTO.types.join(",")}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadPhoto(file);
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={photoBusy}>
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {view.page.draft.photoUrl ? t("photo.replace") : t("photo.upload")}
            </Button>
            {/* A published page needs its photo: only an admin preparing the draft removes it. */}
            {view.page.draft.photoUrl && audience === "admin" ? (
              <Button type="button" variant="ghost" onClick={() => void removePhoto()} disabled={photoBusy}>
                <Trash2 className="h-4 w-4" />
                {t("photo.remove")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className={cardClass} aria-labelledby="showcase-office-title" data-office-photos="">
        <h2 id="showcase-office-title" className="font-serif text-xl font-light text-foreground">
          {t("officePhotos.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("officePhotos.hint")}</p>
        {/* One photo: a page that still stores older extras shows, and is edited through, the first. */}
        {officePhoto ? (
          <div data-office-photo={officePhoto.id} className="mt-4 max-w-sm space-y-2">
            <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={officePhoto.url} alt={t("officePhotos.alt")} className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={officeBusy} onClick={() => officeInput.current?.click()}>
                {officeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {t("officePhotos.replace")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={officeBusy} onClick={() => void removeOfficePhoto(officePhoto.id)}>
                <Trash2 className="h-4 w-4" />
                {t("officePhotos.remove")}
              </Button>
            </div>
          </div>
        ) : null}
        <input
          ref={officeInput}
          type="file"
          accept={SHOWCASE_PHOTO.types.join(",")}
          className="hidden"
          data-office-photo-input=""
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadOfficePhoto(file);
          }}
        />
        {officePhoto ? null : (
          <Button type="button" variant="outline" className="mt-4" onClick={() => officeInput.current?.click()} disabled={officeBusy}>
            {officeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {t("officePhotos.add")}
          </Button>
        )}
      </section>

      <section className={`${cardClass} space-y-5`} aria-labelledby="showcase-presentation-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="showcase-presentation-title" className="font-serif text-xl font-light text-foreground">
            {t("presentation.title")}
          </h2>
          {languageTabs}
        </div>
        {lang === "en" ? <p className="text-xs text-muted-foreground">{t("presentation.englishHint")}</p> : null}

        {lang === "fr" ? (
          <div className="space-y-2">
            <Label htmlFor="showcase-displayName">{t("fields.displayName")}</Label>
            <Input
              id="showcase-displayName"
              value={draft.displayName}
              maxLength={SHOWCASE_LIMITS.displayName}
              onChange={(event) => update({ displayName: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("fields.displayNameHint")}</p>
          </div>
        ) : null}

        {renderLocalized("headline", 1)}
        {renderLineList("highlights")}
        {renderLocalized("intro", 3)}
        {renderLocalized("bio", 10)}
        {renderLocalized("quote", 2)}
        {renderLineList("credentials")}
        {renderLocalized("approach", 4)}
        {renderCardList("methods")}
        {renderCardList("focusAreas")}

        {renderLocalized("insuranceNote", 3)}
      </section>

      <section className={`${cardClass} space-y-8`} aria-labelledby="showcase-customize-title" data-customize="">
        <div>
          <h2 id="showcase-customize-title" className="font-serif text-xl font-light text-foreground">
            {t("customize.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("customize.hint")}</p>
        </div>

        <div className="space-y-3">
          <Label>{t("customize.accentTitle")}</Label>
          <div role="radiogroup" aria-label={t("customize.accentTitle")} className="flex flex-wrap gap-2">
            {SHOWCASE_ACCENT_KEYS.map((key) => {
              const on = draft.accent === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-accent={key}
                  onClick={() => update({ accent: key })}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on ? "border-foreground text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span aria-hidden="true" className="h-4 w-4 rounded-full" style={{ backgroundColor: SHOWCASE_ACCENTS[key].accent }} />
                  {t(`customize.accents.${key}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <Label>{t("customize.sectionsTitle")}</Label>
          <p className="text-xs text-muted-foreground">{t("customize.sectionsHint")}</p>
          <ol className="divide-y divide-border/60 rounded-lg border border-border/60">
            {draft.sectionOrder.map((key, index, all) => {
              const required = REQUIRED_SHOWCASE_SECTIONS.has(key);
              const shown = required || !draft.hiddenSections.includes(key);
              const label = t(`customize.sections.${key}`);
              return (
                <li key={key} data-section-row={key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className={`min-w-0 flex-1 text-sm ${shown ? "text-foreground" : "text-muted-foreground line-through"}`}>{label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("customize.moveUp", { section: label })}
                    disabled={index === 0}
                    onClick={() => moveSection(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("customize.moveDown", { section: label })}
                    disabled={index === all.length - 1}
                    onClick={() => moveSection(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    aria-label={t("customize.show", { section: label })}
                    disabled={required}
                    onClick={() => toggleSection(key)}
                    className={switchClass(shown)}
                  >
                    <span className={knobClass(shown)} />
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-muted-foreground">{t("customize.required")}</p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label>{t("customize.textsTitle")}</Label>
            {languageTabs}
          </div>
          <p className="text-xs text-muted-foreground">{t("customize.textsHint")}</p>
          {/* Section by section, in the page's order: its name (also in the dock), then its headings. */}
          <div className="space-y-6">
            {SHOWCASE_TEXT_GROUPS.map(({ group, keys }) => (
              <fieldset key={group} className="space-y-3" data-text-group={group}>
                <legend className="text-sm font-medium text-foreground">{t(`customize.groups.${group}`)}</legend>
                <div className="grid gap-4 md:grid-cols-2">
                  {keys.map((key) => {
                    const id = `showcase-text-${key}-${lang}`;
                    return (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={id} className="text-xs">
                          {t(`customize.texts.${key}`)}
                        </Label>
                        <Input
                          id={id}
                          value={draft.texts[key][lang]}
                          maxLength={SHOWCASE_TEXT_LIMITS[key]}
                          placeholder={lang === "fr" ? defaultText(key) : ""}
                          onChange={(event) => setText(key, event.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>

      </section>

      <section className={cardClass} aria-labelledby="showcase-expertises-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="showcase-expertises-title" className="font-serif text-xl font-light text-foreground">
            {t("expertises.title")}
          </h2>
          <span
            className={`text-sm ${
              expertiseCount < SHOWCASE_LIMITS.expertisesMin ? "text-amber-700" : "text-muted-foreground"
            }`}
          >
            {t("expertises.count", { count: expertiseCount })}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{worded("expertises.hint")}</p>
        {view.expertiseOptions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("expertises.none")}</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {view.expertiseOptions.map((option) => {
              const selected = draft.expertiseIds.includes(option.id);
              const full = !selected && expertiseCount >= SHOWCASE_LIMITS.expertisesMax;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={full}
                    onClick={() => toggleExpertise(option.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {selected ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : null}
                    {option.labelFr}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {audience === "professional" ? (
        <section className={`${cardClass} space-y-3`} aria-labelledby="showcase-identity-title">
          <h2 id="showcase-identity-title" className="font-serif text-xl font-light text-foreground">
            {t("identity.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("identity.hint")}</p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("order.title")}</dt>
              <dd className="text-sm text-foreground">
                {!draft.orderCode
                  ? t("facts.none")
                  : draft.orderCode === "other"
                    ? draft.orderLabel || t("order.other")
                    : tLabels(`orders.${draft.orderCode}`)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("city.title")}</dt>
              <dd className="text-sm text-foreground">{view.page.cityName}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {audience === "admin" ? (
      <section className={`${cardClass} space-y-3`} aria-labelledby="showcase-order-title">
        <h2 id="showcase-order-title" className="font-serif text-xl font-light text-foreground">
          {t("order.title")}
        </h2>
        <select
          aria-label={t("order.title")}
          value={draft.orderCode}
          onChange={(event) => update({ orderCode: event.target.value as ProfessionalOrderCode | "" })}
          className="h-10 w-full max-w-xl rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("order.select")}</option>
          {PROFESSIONAL_ORDER_CODES.map((code) => (
            <option key={code} value={code}>
              {code === "other" ? t("order.other") : tLabels(`orders.${code}`)}
            </option>
          ))}
        </select>
        {draft.orderCode === "other" ? (
          <div className="max-w-xl space-y-2">
            <Label htmlFor="showcase-orderLabel">{t("order.otherLabel")}</Label>
            <Input
              id="showcase-orderLabel"
              value={draft.orderLabel}
              maxLength={SHOWCASE_LIMITS.orderLabel}
              onChange={(event) => update({ orderLabel: event.target.value })}
            />
          </div>
        ) : null}
      </section>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {notice ? (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={`mr-auto flex items-center gap-2 text-sm ${notice.kind === "error" ? "text-destructive" : "text-emerald-700"}`}
          >
            {notice.kind === "error" ? <AlertCircle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {notice.text}
          </p>
        ) : dirty ? (
          <p className="mr-auto text-sm text-muted-foreground">{t("editor.unsaved")}</p>
        ) : null}
        <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
