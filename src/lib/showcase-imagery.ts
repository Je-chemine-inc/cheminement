/**
 * The large images of a professional's page (the « vitrine » design, spec 003):
 * the wide band under the hero, the tall image beside « À propos », and the
 * wide closing band. The professional's own office photos come first; the
 * slots they do not fill take Je chemine's ambience photos — landscape ones for
 * the wide slots, portrait ones for the tall slot — chosen from the page's slug
 * so each page keeps the same images and neighbouring pages differ. Pure and
 * client-safe.
 */

/**
 * Je chemine's ambience photos, self-hosted (public/showcase/ambiance, sources
 * and licences in LICENSES.md there): the calm of a consultation — armchairs by
 * a window, a notebook, hands around a cup. Decorative: never a face (a stranger
 * on a professional's page could pass for the professional or a client), shown
 * with an empty alt.
 */
export const WIDE_AMBIENCE_IMAGES = [
  "/showcase/ambiance/psy-1.jpg",
  "/showcase/ambiance/psy-2.jpg",
  "/showcase/ambiance/psy-3.jpg",
] as const;

export const TALL_AMBIENCE_IMAGES = [
  "/showcase/ambiance/psy-4.jpg",
  "/showcase/ambiance/psy-5.jpg",
  "/showcase/ambiance/psy-6.jpg",
] as const;

export const AMBIENCE_IMAGES = [...WIDE_AMBIENCE_IMAGES, ...TALL_AMBIENCE_IMAGES] as const;

export const PAGE_IMAGE_SLOTS = ["band", "about", "closing"] as const;
export type PageImageSlot = (typeof PAGE_IMAGE_SLOTS)[number];

export type PageImage = {
  src: string;
  /** A photo the professional added (it has content worth describing), not an ambience photo. */
  office: boolean;
};

/** FNV-1a: a small stable hash, so a slug always picks the same photos. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickFrom(list: readonly string[], seed: string, index: number): string {
  return list[(hashOf(seed) + index) % list.length];
}

/** The `index`-th ambience photo of any shape for a seed: distinct indexes give distinct photos. */
export function pickAmbience(seed: string, index = 0): string {
  return pickFrom(AMBIENCE_IMAGES, seed, index);
}

/**
 * Every large image of a page: office photos in their order first, then the
 * library photo the professional chose for the slot, else an ambience photo of
 * the slot's shape that no other slot already shows.
 */
export function pageImages(
  seed: string,
  officeUrls: readonly string[] = [],
  chosen: Partial<Record<PageImageSlot, string>> = {},
): Record<PageImageSlot, PageImage> {
  const used = new Set<string>();
  const next = { wide: 0, tall: 0 };
  const pick = (list: readonly string[], counter: "wide" | "tall") => {
    for (let tries = 0; tries < list.length; tries++) {
      const src = pickFrom(list, seed, next[counter]++);
      if (!used.has(src)) return src;
    }
    return pickFrom(list, seed, 0);
  };
  const entries = PAGE_IMAGE_SLOTS.map((slot, index) => {
    const office = officeUrls[index];
    if (office) return [slot, { src: office, office: true }] as const;
    const list: readonly string[] = slot === "about" ? TALL_AMBIENCE_IMAGES : WIDE_AMBIENCE_IMAGES;
    const wanted = chosen[slot];
    const src = wanted && list.includes(wanted) ? wanted : pick(list, slot === "about" ? "tall" : "wide");
    used.add(src);
    return [slot, { src, office: false }] as const;
  });
  return Object.fromEntries(entries) as Record<PageImageSlot, PageImage>;
}
