import {
  buildMotifSearchRecords,
  smartMotifSearch,
} from "@/hooks/useMotifSearch";
import { CITY_LABELS } from "@/data/canadaCities";

// Fuzzy records over the "City, QC" labels — built once. `{}` extras: cities get
// NO motif synonym/acronym expansion (that map is only for problématiques).
const CITY_RECORDS = buildMotifSearchRecords(CITY_LABELS, {});

/**
 * Fuzzy, accent-insensitive city autocomplete over the Quebec/Canada list.
 * Returns up to `limit` "City, QC" labels. Empty query → no suggestions.
 */
export function searchCities(query: string, limit = 8): string[] {
  if (!query.trim()) return [];
  return smartMotifSearch(CITY_RECORDS, query).slice(0, limit);
}
