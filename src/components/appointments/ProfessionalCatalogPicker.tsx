"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Category = "mandat" | "approche" | "expertise";
type Item = { labelFr: string; labelEn: string };
type Grouped = Record<Category, Item[]>;

/**
 * Renders the ADMIN-managed catalogs (mandats / approches / expertises) as extra
 * checkbox groups so pros tick them on their signup / profile form, ON TOP of
 * the built-in lists. Selections flow into the same Profile arrays as the
 * built-ins so the matcher + public profile keep working unchanged:
 *   - "approche"            → approaches[]
 *   - "mandat" + "expertise" → problematics[] (the field the matcher scores)
 *
 * The stored value is the viewer's LOCALIZED label — identical to how MotifSearch
 * and the built-in checkbox lists store their values (pickMotifLabel), and to
 * what the client booking picker stores. Storing the canonical FR label instead
 * would silently break EN-client ↔ EN-pro matching. Renders nothing until loaded,
 * and skips any empty category, so a form with no admin catalog looks unchanged.
 */
export function ProfessionalCatalogPicker({
  approaches,
  problematics,
  onToggleApproach,
  onToggleProblematic,
  categories,
}: {
  approaches: string[];
  problematics: string[];
  onToggleApproach: (label: string) => void;
  onToggleProblematic: (label: string) => void;
  /** Restrict to these categories (e.g. a stepped form splits them by step). */
  categories?: Category[];
}) {
  const t = useTranslations("ProCatalogPicker");
  const locale = useLocale();
  const [groups, setGroups] = useState<Grouped | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pro-catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d: { items: Grouped }) => {
        if (!cancelled) setGroups(d.items);
      })
      .catch(() => {
        /* catalog is optional — fail silently, the form is still usable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!groups) return null;

  const allSections: {
    cat: Category;
    selected: string[];
    toggle: (label: string) => void;
  }[] = [
    { cat: "mandat", selected: problematics, toggle: onToggleProblematic },
    { cat: "approche", selected: approaches, toggle: onToggleApproach },
    { cat: "expertise", selected: problematics, toggle: onToggleProblematic },
  ];
  const sections = categories
    ? allSections.filter((s) => categories.includes(s.cat))
    : allSections;

  if (!sections.some((s) => groups[s.cat]?.length > 0)) return null;

  return (
    <div className="space-y-5 rounded-lg border border-border/60 bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {sections.map(({ cat, selected, toggle }) => {
        const items = groups[cat] ?? [];
        if (!items.length) return null;
        return (
          <div key={cat} className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t(cat)}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {items.map((it) => {
                // Localized label — same value MotifSearch/built-ins store, so
                // the matcher sees identical strings on the client + pro sides.
                const value =
                  locale === "en" ? it.labelEn || it.labelFr : it.labelFr;
                const checked = selected.includes(value);
                return (
                  <label
                    key={value}
                    className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-border/60 bg-background p-2 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(value)}
                    />
                    <span>{value}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
