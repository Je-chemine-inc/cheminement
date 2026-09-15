import { PROFESSIONAL_TITLES } from "@/data/professionalTitles";

/** A professional title a page names by key (Showcase `titles.<key>`). */
export type ShowcaseTitleKey = Exclude<(typeof PROFESSIONAL_TITLES)[number]["value"], "otherProfessionals">;

const TITLE_KEYS = new Set<string>(PROFESSIONAL_TITLES.map((title) => title.value));

/**
 * The professional title as a page shows it: a known title key, or the profile's own words (spec 003).
 * One rule for the public profile and for the editor's « À propos » hint (showcase-service).
 */
export function showcaseTitleOf(specialty: string | null | undefined): { key: ShowcaseTitleKey | null; label: string | null } {
  const raw = specialty?.trim() ?? "";
  if (!raw || raw === "otherProfessionals") return { key: null, label: null };
  if (TITLE_KEYS.has(raw)) return { key: raw as ShowcaseTitleKey, label: null };
  return { key: null, label: raw.slice(0, 80) };
}
