"use client";

import React, { useMemo, useRef, useEffect, useState } from "react";
import {
  buildMotifSearchRecords,
  useDebouncedSmartMotifSearch,
} from "@/hooks/useMotifSearch";
import { MOTIF_SEARCH_EXTRAS } from "@/config/motifSearch";
import { useMotifs, pickMotifLabel } from "@/hooks/useMotifs";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations, useLocale } from "next-intl";

interface MotifSearchProps {
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  /** @deprecated Plus de bouton recherche — conservé pour compatibilité */
  searchButtonLabel?: string;
  disabled?: boolean;
  className?: string;
  maxSelections?: number;
  multiSelect?: boolean;
  /** Liste personnalisée (ex. objectifs thérapie). Pas d’extras MOTIF_SEARCH par défaut. */
  items?: string[];
}

/**
 * Smart-Suggest : suggestions dès le 1er caractère, debounce 300 ms,
 * synonymes / acronymes (config/motifSearch), multi-sélection avec tags × supprimables.
 */
export const MotifSearch = React.forwardRef<HTMLDivElement, MotifSearchProps>(
  (
    {
      value = "",
      onChange,
      placeholder = "Rechercher un motif (ex. anxiété, TCC, EMDR…)",
      disabled = false,
      className,
      maxSelections: maxSelectionsProp,
      multiSelect = false,
      items: customItems,
    },
    ref,
  ) => {
    const t = useTranslations("MotifSearch");
    const locale = useLocale();
    const { motifs: fetchedMotifs } = useMotifs();
    const maxSelections =
      maxSelectionsProp ?? (multiSelect ? 10 : 1);

    const { searchItems, dynamicExtras } = useMemo(() => {
      if (customItems) {
        // Apply the static synonym/acronym map (keyed by exact label) so that
        // typing "TOC", "TDAH", "autisme", "EMDR"… finds the right problématique
        // even in a custom list. Only matching labels get extras, so unrelated
        // custom lists (e.g. therapy objectives) are unaffected. Previously this
        // was `{}` → acronym/synonym search silently returned nothing.
        return {
          searchItems: customItems,
          dynamicExtras: MOTIF_SEARCH_EXTRAS,
        };
      }
      const items: string[] = [];
      const extras: Record<string, string> = {};
      for (const m of fetchedMotifs) {
        const label = pickMotifLabel(m, locale);
        items.push(label);
        const extraParts = [
          ...(m.aliases ?? []),
          m.labelFr,
          m.labelEn,
        ].filter((s): s is string => Boolean(s) && s !== label);
        if (extraParts.length > 0) {
          extras[label] = extraParts.join(" ");
        }
      }
      return { searchItems: items, dynamicExtras: extras };
    }, [customItems, fetchedMotifs, locale]);

    const records = useMemo(
      () => buildMotifSearchRecords(searchItems, dynamicExtras),
      [searchItems, dynamicExtras],
    );

    const { inputQuery, setInputQuery, debouncedQuery, results } =
      useDebouncedSmartMotifSearch(records, { debounceMs: 300 });

    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isTypingPending =
      inputQuery.trim().length > 0 &&
      (inputQuery !== debouncedQuery || debouncedQuery.trim().length === 0);

    const selectedMotifs = multiSelect
      ? (Array.isArray(value) ? value : value ? [value] : [])
      : [];

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(event.target as Node)
        ) {
          setIsOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelectMotif = (motif: string) => {
      if (multiSelect) {
        if (selectedMotifs.includes(motif)) {
          onChange(selectedMotifs.filter((m) => m !== motif));
        } else if (selectedMotifs.length < maxSelections) {
          onChange([...selectedMotifs, motif]);
        }
        setInputQuery("");
      } else {
        onChange(motif);
        setInputQuery("");
        setIsOpen(false);
      }
    };

    const handleRemoveMotif = (motifToRemove?: string) => {
      if (multiSelect) {
        onChange(
          motifToRemove
            ? selectedMotifs.filter((m) => m !== motifToRemove)
            : [],
        );
      } else {
        onChange("");
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setInputQuery("");
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results.length > 0) {
          const first = results[0];
          if (!multiSelect || !selectedMotifs.includes(first)) {
            const atCap =
              multiSelect && selectedMotifs.length >= maxSelections;
            if (!atCap) handleSelectMotif(first);
          }
        }
      }
    };

    const isAtMax = multiSelect && selectedMotifs.length >= maxSelections;

    const showSuggestions =
      isOpen && !disabled && !isAtMax && inputQuery.trim().length >= 1;

    return (
      <div ref={ref} className={cn("relative", className)}>
        <div
          ref={containerRef}
          className={cn(
            "rounded-xl transition-all duration-200",
            "border",
            isOpen && !disabled && !isAtMax
              ? "border-primary/50 bg-primary/[0.04] dark:bg-primary/10 shadow-md ring-2 ring-primary/20"
              : "border-input bg-background",
            disabled || isAtMax ? "opacity-90" : "",
          )}
        >
          {(multiSelect ? selectedMotifs.length > 0 : value) && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {multiSelect ? (
                selectedMotifs.map((motif) => (
                  <div
                    key={motif}
                    className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-2.5 py-1 rounded-md text-sm max-w-full"
                  >
                    <span className="truncate">{motif}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMotif(motif)}
                      disabled={disabled}
                      className="hover:text-primary/80 transition-colors shrink-0"
                      aria-label={t("removeAria", { label: motif })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-2.5 py-1 rounded-md text-sm max-w-full">
                  <span className="truncate">{value}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveMotif()}
                    disabled={disabled}
                    className="hover:text-primary/80 transition-colors shrink-0"
                    aria-label={t("removeAria", { label: String(value) })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              "mx-3 mb-0 rounded-lg border bg-background transition-colors",
              isOpen && !disabled && !isAtMax
                ? "border-primary/40 shadow-sm"
                : "border-input",
              disabled || isAtMax
                ? "bg-muted cursor-not-allowed border-muted-foreground/20 my-3"
                : "my-3",
            )}
          >
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={inputQuery}
              onChange={(e) => {
                setInputQuery(e.target.value);
                setIsOpen(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsOpen(true)}
              placeholder={
                isAtMax
                  ? t("maxReached", { max: maxSelections })
                  : placeholder
              }
              disabled={disabled || isAtMax}
              className={cn(
                "w-full min-w-0 py-2.5 px-3 bg-transparent outline-none text-sm rounded-lg",
                "placeholder:text-muted-foreground",
                (disabled || isAtMax) &&
                  "text-muted-foreground cursor-not-allowed",
              )}
              aria-label={t("searchAria")}
              aria-expanded={isOpen}
              aria-controls="motif-search-results"
              aria-autocomplete="list"
            />
          </div>

          {showSuggestions && (
            <section
              id="motif-search-results"
              className="mx-3 mb-3 rounded-lg border border-border/70 bg-muted/20 p-3"
              aria-label={t("suggestions")}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("suggestions")}
                </p>
                {isTypingPending && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    …
                  </span>
                )}
              </div>
              {results.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {results.map((motif) => {
                    const selected = multiSelect
                      ? selectedMotifs.includes(motif)
                      : value === motif;
                    const isDisabled =
                      multiSelect &&
                      !selected &&
                      selectedMotifs.length >= maxSelections;

                    return (
                      <button
                        key={motif}
                        type="button"
                        onClick={() => !isDisabled && handleSelectMotif(motif)}
                        onMouseDown={(e) => e.preventDefault()}
                        disabled={isDisabled}
                        className={cn(
                          "rounded-md border px-3 py-2 text-left text-sm transition-all",
                          "hover:-translate-y-[1px] hover:shadow-sm",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                          selected
                            ? "border-primary/40 bg-primary/10 text-primary font-medium"
                            : "border-border bg-background hover:border-primary/30",
                          isDisabled &&
                            "opacity-50 cursor-not-allowed hover:translate-y-0 hover:shadow-none",
                        )}
                        aria-pressed={selected}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{motif}</span>
                          {selected && (
                            <span className="text-primary text-xs shrink-0">
                              {t("selected")}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : isTypingPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  …
                </p>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground leading-relaxed">
                  {t("noResults")}
                </p>
              )}
            </section>
          )}

          {isAtMax && (
            <p className="px-3 pb-3 text-xs text-muted-foreground">
              {t("maxReached", { max: maxSelections })}
            </p>
          )}
        </div>
      </div>
    );
  },
);

MotifSearch.displayName = "MotifSearch";
