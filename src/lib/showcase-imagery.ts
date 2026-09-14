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
 * and licences in LICENSES.md there). Decorative: no people, shown with an empty alt.
 */
export const WIDE_AMBIENCE_IMAGES = [
  "/showcase/ambiance/ambiance-1.jpg",
  "/showcase/ambiance/ambiance-6.jpg",
] as const;

export const TALL_AMBIENCE_IMAGES = [
  "/showcase/ambiance/ambiance-2.jpg",
  "/showcase/ambiance/ambiance-3.jpg",
  "/showcase/ambiance/ambiance-4.jpg",
  "/showcase/ambiance/ambiance-5.jpg",
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

/** Every large image of a page: office photos in their order first, then ambience photos of the slot's shape, never the same twice. */
export function pageImages(seed: string, officeUrls: readonly string[] = []): Record<PageImageSlot, PageImage> {
  const wide = { next: 0 };
  const ambience: Record<PageImageSlot, () => string> = {
    band: () => pickFrom(WIDE_AMBIENCE_IMAGES, seed, wide.next++),
    about: () => pickFrom(TALL_AMBIENCE_IMAGES, seed, 0),
    closing: () => pickFrom(WIDE_AMBIENCE_IMAGES, seed, wide.next++),
  };
  const entries = PAGE_IMAGE_SLOTS.map((slot, index) => {
    const office = officeUrls[index];
    const image: PageImage = office ? { src: office, office: true } : { src: ambience[slot](), office: false };
    return [slot, image] as const;
  });
  return Object.fromEntries(entries) as Record<PageImageSlot, PageImage>;
}
