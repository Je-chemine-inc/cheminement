/**
 * Premium (paid) content rules.
 *
 * A premium entry is a `ContentEntry` the visitor must buy before they may read
 * it. Two fields carry the paid good and must NEVER reach someone who has not
 * bought it:
 *
 *   - `contentHtml` — the article body
 *   - `mediaUrl`    — the unlisted video/podcast link, which IS the paid good
 *                     for a video resource. A public YouTube URL behind a
 *                     paywall is only as private as the URL itself.
 *
 * `stripPremiumPayload` is the single gate. Every path that hands a resource to
 * an unauthenticated (or unentitled) caller goes through it — the reader page
 * and the public listing API. Do not hand-roll a second one: two surfaces that
 * answer "may I read this?" will drift, and the drift is a paywall bypass.
 */
import type { ContentKind } from "./content-kind";

/** Only resources can be sold. Problematiques/traitements/nouveautes/medias are editorial. */
export const PREMIUM_KINDS: readonly ContentKind[] = ["resource"];

/** $10,000 — a sanity ceiling, not a business rule. Catches a stray cents/dollars mixup. */
export const MAX_PRICE_CENTS = 1_000_000;

export function canBePremium(kind: ContentKind): boolean {
  return PREMIUM_KINDS.includes(kind);
}

/**
 * True only when the entry is genuinely sellable: the right kind, flagged, and
 * carrying a real price. A flagged entry with `priceCents: 0` is treated as
 * free rather than as a $0 purchase — otherwise a half-finished admin edit
 * would put a "buy" button on something Stripe cannot charge for.
 */
export function isPremiumEntry(entry: {
  kind: ContentKind;
  isPremium?: boolean;
  priceCents?: number;
}): boolean {
  return (
    canBePremium(entry.kind) &&
    entry.isPremium === true &&
    (entry.priceCents ?? 0) > 0
  );
}

/**
 * Returns a copy with the paid fields REMOVED — the keys are absent, not empty.
 *
 * Absence rather than `""` is deliberate: an empty string still renders an
 * empty `<iframe src="">` or a blank prose block, and a downstream `??` would
 * happily resurrect a default. A missing key fails loudly at the type level.
 */
export function stripPremiumPayload<
  T extends { contentHtml?: string; mediaUrl?: string },
>(dto: T): Omit<T, "contentHtml" | "mediaUrl"> & { locked: true } {
  // Destructure the paid fields out; keep the rest. Never mutate the input —
  // callers hold the full DTO and may still need it.
  const { contentHtml: _contentHtml, mediaUrl: _mediaUrl, ...rest } = dto;
  void _contentHtml;
  void _mediaUrl;
  return { ...rest, locked: true };
}

/**
 * Validates a price arriving from the admin form.
 *
 * Integer cents only. `19.5` cents is meaningless, and accepting a float here
 * is how a rounding drift reaches Stripe. Returns null when unusable so the
 * caller can 400 rather than storing garbage.
 */
export function validatePriceCents(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isInteger(value)) return null;
  if (value <= 0) return null;
  if (value > MAX_PRICE_CENTS) return null;
  return value;
}
