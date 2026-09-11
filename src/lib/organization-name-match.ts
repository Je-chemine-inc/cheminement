/**
 * Matching the organization a client typed at booking ("pae desjardins inc.")
 * to the organizations already on file ("PAE Desjardins"). Used to preselect
 * the right one and to suggest look-alikes before an admin creates a new one —
 * a duplicate organization splits its invoices in two.
 *
 * Pure; no database.
 */

/** Legal suffixes and filler words that don't tell organizations apart. */
const NOISE = new Set([
  "inc", "incorporated", "ltee", "ltd", "limited", "limitee", "corp", "corporation", "co", "cie", "enr",
  "senc", "sencrl", "llc", "the", "le", "la", "les", "de", "du", "des", "d", "l", "and", "et",
]);

export function normalizeOrganizationName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE.has(w))
    .join(" ");
}

const tokens = (normalized: string) => new Set(normalized.split(" ").filter(Boolean));

/** 0…1: how alike two names are once normalized. */
export function organizationNameSimilarity(a: string, b: string): number {
  const na = normalizeOrganizationName(a);
  const nb = normalizeOrganizationName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const compactA = na.replace(/ /g, "");
  const compactB = nb.replace(/ /g, "");
  if (compactA === compactB) return 1;
  // "PAE" vs "PAE Desjardins": one name contained in the other, whole words.
  if (` ${na} `.includes(` ${nb} `) || ` ${nb} `.includes(` ${na} `)) return 0.8;
  const ta = tokens(na);
  const tb = tokens(nb);
  const shared = [...ta].filter((w) => tb.has(w)).length;
  return shared / new Set([...ta, ...tb]).size;
}

/** The organization on file that is the same name, once normalized. */
export function exactOrganizationMatch<T extends { name: string }>(declared: string, orgs: T[]): T | undefined {
  const target = normalizeOrganizationName(declared);
  if (!target) return undefined;
  return orgs.find((o) => {
    const n = normalizeOrganizationName(o.name);
    return n === target || n.replace(/ /g, "") === target.replace(/ /g, "");
  });
}

/** Look-alikes worth showing before creating a new organization, best first. */
export function similarOrganizations<T extends { name: string }>(
  declared: string,
  orgs: T[],
  limit = 3,
): T[] {
  return orgs
    .map((o) => ({ o, score: organizationNameSimilarity(declared, o.name) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.o);
}
