"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, MapPin, Search, Video } from "lucide-react";
import { ShowcaseDirectoryCard } from "@/components/showcase/ShowcaseDirectoryCard";
import {
  NO_DIRECTORY_FILTERS,
  matchesDirectoryFilters,
  type DirectoryFilters,
  type DirectoryItem,
} from "@/lib/showcase-directory";

type Chip = "inPerson" | "video" | "quick";

/**
 * The city page's directory (spec 003, the « Ville » design): a search field
 * and filter chips over the professionals listed, filtered in the browser.
 * The cards arrive with their strings ready (buildDirectoryItems); only the
 * directory's own words come from the ShowcaseDirectory messages.
 */
export function ShowcaseCityDirectory({ items, cityName }: { items: DirectoryItem[]; cityName: string }) {
  const t = useTranslations("ShowcaseDirectory");
  const [filters, setFilters] = useState<DirectoryFilters>(NO_DIRECTORY_FILTERS);
  const shown = items.filter((item) => matchesDirectoryFilters(item.filter, filters));
  const active = filters.query.trim() !== "" || filters.inPerson || filters.video || filters.quick;

  const toggle = (chip: Chip) =>
    setFilters((current) =>
      chip === "inPerson"
        ? { ...current, inPerson: !current.inPerson }
        : chip === "video"
          ? { ...current, video: !current.video }
          : { ...current, quick: !current.quick },
    );
  const chips: { key: Chip; icon: typeof MapPin; label: string }[] = [
    { key: "inPerson", icon: MapPin, label: t("inPerson") },
    { key: "video", icon: Video, label: t("video") },
    { key: "quick", icon: Clock, label: t("quick") },
  ];

  return (
    <div data-city-directory="">
      <div className="rounded-[20px] border border-[#EDE6DA] bg-white p-[clamp(14px,2vw,20px)] shadow-[0_26px_50px_-34px_rgba(16,51,61,0.4)]">
        <label className="mb-3 flex items-center gap-2.5 rounded-[14px] border border-[#EAE2D5] bg-[#FBF9F5] px-4 py-3 text-[#8E948C] focus-within:border-[#17505F]">
          <Search className="h-[18px] w-[18px] shrink-0 text-[#17505F]" aria-hidden="true" />
          <span className="sr-only">{t("searchLabel")}</span>
          <input
            type="search"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder={t("searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#414E4B] outline-none placeholder:text-[#9DA29B]"
          />
        </label>
        <div role="group" aria-label={t("filtersLabel")} className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const on = filters[chip.key];
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(chip.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] transition-colors ${
                  on
                    ? "border-[#17505F] bg-[#E7EEE2] font-semibold text-[#12414F]"
                    : "border-[#EAE2D5] bg-[#FBF9F5] text-[#3D4B47] hover:border-[#C6D4C2]"
                }`}
              >
                <chip.icon className="h-[15px] w-[15px]" aria-hidden="true" />
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-[clamp(26px,3.4vw,38px)] flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-[#2B403C]" aria-live="polite">
          {t("count", { count: shown.length, city: cityName })}
        </h2>
        {active ? (
          <button
            type="button"
            onClick={() => setFilters(NO_DIRECTORY_FILTERS)}
            className="ml-auto text-sm font-medium text-[#17505F] hover:underline"
          >
            {t("reset")}
          </button>
        ) : null}
      </div>

      {shown.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3.5">
          {shown.map((item) => (
            <li key={item.key}>
              <ShowcaseDirectoryCard {...item.card} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-[20px] border border-dashed border-[#E2DACB] bg-white/60 p-8 text-center text-sm text-[#5E6863]">
          {t("empty")}
        </p>
      )}
    </div>
  );
}
