"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
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
import { SHOWCASE_REGIONS, findShowcaseCity, matchShowcaseCity } from "@/lib/showcase-cities";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import {
  showcaseErrorKey,
  type ShowcaseContentJson,
  type ShowcaseEditorJson,
} from "@/lib/showcase-editor-types";

/**
 * The content of a showcase page, edited by the professional or by an admin
 * (spec 003): photo, presentation (French, optional English), expertises,
 * order, and the consultations the page offers. `apiBase` is the page's
 * route: /api/professional/showcase or /api/admin/showcases/<userId>.
 *
 * Text is plain: the server keeps paragraphs and drops everything else.
 */

type Lang = "fr" | "en";
type Localized = { fr: string; en: string };
type LocalizedField = "headline" | "intro" | "bio" | "approach" | "insuranceNote";

interface DraftState {
  displayName: string;
  headline: Localized;
  intro: Localized;
  bio: Localized;
  approach: Localized;
  insuranceNote: Localized;
  values: Localized[];
  expertiseIds: string[];
  orderCode: ProfessionalOrderCode | "";
  orderLabel: string;
  cityKey: string;
}

const FIELD_LIMITS: Record<LocalizedField, number> = {
  headline: SHOWCASE_LIMITS.headline,
  intro: SHOWCASE_LIMITS.intro,
  bio: SHOWCASE_LIMITS.bio,
  approach: SHOWCASE_LIMITS.approach,
  insuranceNote: SHOWCASE_LIMITS.insuranceNote,
};

function toDraftState(
  content: ShowcaseContentJson,
  offered: readonly { id: string }[],
  pageCityKey: string,
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
    values: content.values.map(copy),
    // An expertise no longer offered on pages would be refused on save.
    expertiseIds: content.expertiseIds.filter((id) => offeredIds.has(id)),
    orderCode: content.orderCode ?? "",
    orderLabel: content.orderLabel,
    cityKey: content.cityKey ?? pageCityKey,
  };
}

export function ShowcaseEditorForm<V extends ShowcaseEditorJson>({
  apiBase,
  view,
  onView,
  reload,
  profileHint,
}: {
  apiBase: string;
  view: V;
  onView: (next: V) => void;
  reload: () => Promise<void>;
  /** Where the facts that come from the profile are changed (shown under services). */
  profileHint?: string;
}) {
  const t = useTranslations("ShowcasePro");
  const tLabels = useTranslations("Showcase");
  const [draft, setDraft] = useState<DraftState>(() =>
    toDraftState(view.page.draft, view.expertiseOptions, view.page.cityKey),
  );
  const [lang, setLang] = useState<Lang>("fr");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [servicesBusy, setServicesBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
          values: draft.values.filter((value) => value.fr.trim() || value.en.trim()),
          expertiseIds: draft.expertiseIds,
          orderCode: draft.orderCode || null,
          orderLabel: draft.orderCode === "other" ? draft.orderLabel : "",
          cityKey: draft.cityKey,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      const next = body as V;
      onView(next);
      setDraft(toDraftState(next.page.draft, next.expertiseOptions, next.page.cityKey));
      setDirty(false);
      setNotice({ kind: "ok", text: t("editor.saved") });
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

  const toggleService = async (key: "standard" | "quick") => {
    setServicesBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/services`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: !view.page.services[key] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "error", text: errorText(body?.error) });
        return;
      }
      onView({ ...view, page: { ...view.page, services: body.services } });
    } catch {
      setNotice({ kind: "error", text: t("errors.network") });
    } finally {
      setServicesBusy(false);
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
            placeholder={lang === "fr" ? t(`fields.${field}Placeholder`) : ""}
            onChange={(event) => setLocalized(field, event.target.value)}
          />
        ) : (
          <Textarea
            id={id}
            value={value}
            rows={rows}
            maxLength={max}
            placeholder={lang === "fr" ? t(`fields.${field}Placeholder`) : ""}
            onChange={(event) => setLocalized(field, event.target.value)}
          />
        )}
        {renderCounter(value.length, max)}
      </div>
    );
  };

  const expertiseCount = draft.expertiseIds.length;
  // The listed city the profile's office address names, offered as a one-click choice.
  const officeCity = matchShowcaseCity(view.profileFacts.officeCity);
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
            {view.page.draft.photoUrl ? (
              <Button type="button" variant="ghost" onClick={() => void removePhoto()} disabled={photoBusy}>
                <Trash2 className="h-4 w-4" />
                {t("photo.remove")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className={`${cardClass} space-y-5`} aria-labelledby="showcase-presentation-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="showcase-presentation-title" className="font-serif text-xl font-light text-foreground">
            {t("presentation.title")}
          </h2>
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
        {renderLocalized("intro", 3)}
        {renderLocalized("bio", 10)}
        {renderLocalized("approach", 4)}

        <div className="space-y-2">
          <Label>{t("fields.values")}</Label>
          <p className="text-xs text-muted-foreground">{t("fields.valuesHint")}</p>
          <ul className="space-y-2">
            {draft.values.map((value, index) => (
              <li key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`${t("fields.values")} ${index + 1}`}
                  value={value[lang]}
                  maxLength={SHOWCASE_LIMITS.valueLength}
                  onChange={(event) =>
                    update({
                      values: draft.values.map((current, i) =>
                        i === index ? { ...current, [lang]: event.target.value } : current,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("fields.removeValue")}
                  onClick={() => update({ values: draft.values.filter((_, i) => i !== index) })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          {draft.values.length < SHOWCASE_LIMITS.values ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update({ values: [...draft.values, { fr: "", en: "" }] })}
            >
              <Plus className="h-4 w-4" />
              {t("fields.addValue")}
            </Button>
          ) : null}
        </div>

        {renderLocalized("insuranceNote", 3)}
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
        <p className="mt-1 text-sm text-muted-foreground">{t("expertises.hint")}</p>
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

      <section className={`${cardClass} space-y-3`} aria-labelledby="showcase-city-title">
        <h2 id="showcase-city-title" className="font-serif text-xl font-light text-foreground">
          {t("city.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("city.hint")}</p>
        <select
          aria-label={t("city.title")}
          value={draft.cityKey}
          onChange={(event) => update({ cityKey: event.target.value })}
          className="h-10 w-full max-w-xl rounded-md border border-input bg-background px-3 text-sm"
        >
          {findShowcaseCity(draft.cityKey) ? null : <option value="">{t("city.select")}</option>}
          {SHOWCASE_REGIONS.map((region) => (
            <optgroup key={region.key} label={region.name}>
              {region.cities.map((city) => (
                <option key={city.key} value={city.key}>
                  {city.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {officeCity ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t("city.officeCity", { city: view.profileFacts.officeCity ?? officeCity.name })}
            {officeCity.key !== draft.cityKey ? (
              <Button type="button" variant="outline" size="sm" onClick={() => update({ cityKey: officeCity.key })}>
                {t("city.useOfficeCity", { city: officeCity.name })}
              </Button>
            ) : null}
          </p>
        ) : null}
        {findShowcaseCity(draft.cityKey) ? (
          <p className="break-all text-xs text-muted-foreground">
            {t("city.address", { url: absoluteShowcaseUrl(draft.cityKey, `/${view.page.slug}`) })}
          </p>
        ) : null}
        {view.page.published && draft.cityKey !== view.page.cityKey ? (
          <p className="text-xs text-amber-700">{t("city.afterApproval")}</p>
        ) : null}
      </section>

      <section className={`${cardClass} space-y-4`} aria-labelledby="showcase-services-title">
        <div>
          <h2 id="showcase-services-title" className="font-serif text-xl font-light text-foreground">
            {t("services.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("services.hint")}</p>
        </div>
        {(["standard", "quick"] as const).map((key) => {
          const on = view.page.services[key];
          const blocked =
            key === "standard"
              ? !view.profileFacts.acceptingNewClients
              : !view.profileFacts.acceptingEmergencyConsultations;
          return (
            <div key={key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{t(`services.${key}`)}</p>
                <p className="text-sm text-muted-foreground">{t(`services.${key}Hint`)}</p>
                {on && blocked ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {key === "standard" ? t("services.notAcceptingClients") : t("services.notAcceptingQuick")}
                    {profileHint ? ` ${profileHint}` : ""}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={t(`services.${key}`)}
                disabled={servicesBusy}
                onClick={() => void toggleService(key)}
                className={switchClass(on)}
              >
                <span className={knobClass(on)} />
              </button>
            </div>
          );
        })}
      </section>

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
