"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showcaseErrorKey, type ShowcaseCityOption } from "@/lib/showcase-editor-types";

/**
 * A page's city (owner, 2026-09-18: the office address is not needed — the admin chooses the city,
 * and the professional can change it). The list is Je chemine's cities, by region.
 */

/** The cities of the list, grouped by region. */
export function ShowcaseCitySelect({
  id,
  value,
  onChange,
  options,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (cityKey: string) => void;
  options: readonly ShowcaseCityOption[];
  disabled?: boolean;
}) {
  const t = useTranslations("ShowcasePro.city");
  const regions = new Map<string, ShowcaseCityOption[]>();
  for (const option of options) regions.set(option.region, [...(regions.get(option.region) ?? []), option]);
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      data-city-select=""
    >
      <option value="">{t("choose")}</option>
      {[...regions].map(([region, cities]) => (
        <optgroup key={region} label={region}>
          {cities.map((city) => (
            <option key={city.key} value={city.key}>
              {city.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * The page's city, and a dialog to change it: live at once (PUT `<apiBase>/city`), then the view is
 * read again.
 */
export function ShowcaseCityChange({
  apiBase,
  cityKey,
  cityName,
  options,
  onChanged,
  audience = "professional",
}: {
  apiBase: string;
  cityKey: string;
  cityName: string;
  options: readonly ShowcaseCityOption[];
  onChanged: () => Promise<void> | void;
  audience?: "professional" | "admin";
}) {
  const t = useTranslations("ShowcasePro");
  const tAdmin = useTranslations("ShowcaseAdmin");
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(cityKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/city`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityKey: choice }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(`errors.${showcaseErrorKey(body?.error)}`));
        return;
      }
      setOpen(false);
      await onChanged();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-page-city={cityKey}>
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {cityName}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-primary"
        onClick={() => {
          setChoice(cityKey);
          setError(null);
          setOpen(true);
        }}
        data-city-change=""
      >
        {t("city.change")}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("city.title")}</DialogTitle>
            <DialogDescription>{audience === "admin" ? tAdmin("city.hint") : t("city.hint")}</DialogDescription>
          </DialogHeader>
          <ShowcaseCitySelect id="page-city-select" value={choice} onChange={setChoice} options={options} disabled={busy} />
          {error ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy || !choice || choice === cityKey}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("city.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
