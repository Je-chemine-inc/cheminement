import { findCityByLabel } from "@/data/canadaCities";

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .trim();

// City portion only (drop a ", QC" province suffix) for free-text vs label compares.
const cityPart = (s: string): string => norm(s.split(",")[0] ?? "");

export type LocationProximity = "same_city" | "same_region" | "none";

/**
 * How close two locations are, for the in-person jumelage bonus. Works with both
 * the autocomplete "City, QC" values and legacy free text:
 *  - both recognised cities → precise city+province, else region compare
 *  - otherwise              → best-effort city-name compare (same_city only)
 *
 * Returns "none" when either side is empty/unknown, so the caller simply skips
 * the bonus rather than penalising — location never empties the candidate pool.
 */
export function locationProximityScore(
  a?: string | null,
  b?: string | null,
): LocationProximity {
  if (!a || !b) return "none";

  const ea = findCityByLabel(a.trim());
  const eb = findCityByLabel(b.trim());
  if (ea && eb) {
    if (norm(ea.city) === norm(eb.city) && ea.province === eb.province) {
      return "same_city";
    }
    return ea.region === eb.region ? "same_region" : "none";
  }

  // At least one free-typed value — no province/region info on that side, so
  // only same_city is possible. We KEEP this name-only compare because the
  // common case is valuable: a legacy free-text "terrebonne" matching a new
  // autocomplete "Terrebonne, QC". The tradeoff is a rare, accepted false
  // positive when a same-named city exists across provinces (e.g. Windsor) and
  // one side is free text — only ever a +20 soft, in-person-gated nudge.
  const ca = cityPart(a);
  const cb = cityPart(b);
  if (ca && cb && ca === cb) return "same_city";
  return "none";
}
