import PlatformSettings from "@/models/PlatformSettings";
import Profile from "@/models/Profile";
import { roundMoney } from "@/lib/session-closure";

export interface PricingResult {
  /** What the client is charged. */
  sessionPrice: number;
  /** What the platform keeps: always `sessionPrice - professionalPayout`. */
  platformFee: number;
  /** What the professional receives. */
  professionalPayout: number;
  currency: string;
  /** Whether a per-professional rate drove the split, or the platform fallback did. */
  source: "professional" | "platform";
  /**
   * True when the configured professional rate exceeded the client price and
   * was capped so the platform does not pay out more than it collected. Signals
   * misconfiguration — surface it to an admin rather than ignoring it.
   */
  rateClamped: boolean;
}

/** Map a therapy type onto the legacy single-number pricing key. */
const LEGACY_PRICING_KEY = {
  solo: "individualSession",
  couple: "coupleSession",
  group: "groupSession",
} as const;

/** Used only when no PlatformSettings row exists at all. */
const HARDCODED_DEFAULT_PRICING = { solo: 120, couple: 150, group: 80 } as const;

/**
 * A stored `0` means "unset", never "free" / "pays nothing" — the legacy schema
 * wrote 0 into therapy types a professional had not configured, and migrating
 * that literally would set real payouts to zero.
 */
function configured(value: number | undefined | null): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

/**
 * Work out what the client pays, what the professional receives, and what the
 * platform keeps for one appointment.
 *
 * The model: the **client price** is set by the platform (per professional when
 * an admin configures one, otherwise the platform default), the professional
 * receives their **negotiated rate**, and the platform keeps the spread between
 * them. `platformFee` is always derived as `sessionPrice - professionalPayout`,
 * so `sessionPrice === platformFee + professionalPayout` holds by construction
 * whatever the rounding.
 *
 * Resolution order per therapy type:
 *  1. `profile.rates[type]` — admin-configured client price and/or pro rate.
 *  2. `profile.pricing[...]` — the legacy single number, read as the pro's rate.
 *  3. Platform default price, split by `platformFeePercentage`.
 *
 * Before this, the professional's own number was what the *client* was charged
 * and the platform took a percentage of it — so the platform tarif in Paramètres
 * never applied to any professional who had set a rate.
 */
export async function calculateAppointmentPricing(
  profileId: string | null,
  therapyType: "solo" | "couple" | "group",
): Promise<PricingResult> {
  const profile = profileId
    ? await Profile.findOne({ userId: profileId })
    : null;

  let platformSettings = await PlatformSettings.findOne();
  if (!platformSettings) {
    platformSettings = new PlatformSettings({
      defaultPricing: { ...HARDCODED_DEFAULT_PRICING },
      platformFeePercentage: 10,
      currency: "CAD",
    });
    await platformSettings.save();
  }

  const currency = platformSettings.currency || "CAD";
  const platformFeePercentage = platformSettings.platformFeePercentage ?? 10;
  const defaultPrice =
    configured(platformSettings.defaultPricing?.[therapyType]) ??
    HARDCODED_DEFAULT_PRICING[therapyType];

  const adminRate = profile?.rates?.[therapyType];
  const legacyRate = configured(
    profile?.pricing?.[LEGACY_PRICING_KEY[therapyType]],
  );

  // The professional's rate: admin-configured wins, else the legacy number.
  const professionalRate = configured(adminRate?.professionalRate) ?? legacyRate;
  // The client price: admin-configured per-professional price, else the
  // platform default for this therapy type.
  const sessionPrice = configured(adminRate?.clientPrice) ?? defaultPrice;

  // No per-professional rate at all → platform default split by percentage.
  if (professionalRate === undefined) {
    const platformFee = roundMoney((sessionPrice * platformFeePercentage) / 100);
    return {
      sessionPrice,
      platformFee,
      professionalPayout: roundMoney(sessionPrice - platformFee),
      currency,
      source: "platform",
      rateClamped: false,
    };
  }

  // Never pay out more than was collected. A rate above the client price is a
  // misconfiguration (the pro's self-serve form can still produce one until the
  // admin editor replaces it); cap it at a zero spread and flag it rather than
  // letting the platform owe money it never took.
  const rateClamped = professionalRate > sessionPrice;
  const professionalPayout = roundMoney(
    rateClamped ? sessionPrice : professionalRate,
  );

  return {
    sessionPrice,
    platformFee: roundMoney(sessionPrice - professionalPayout),
    professionalPayout,
    currency,
    source: "professional",
    rateClamped,
  };
}

/**
 * Split an admin-supplied price into (platform fee, professional payout) using
 * the percentage an admin actually configures in Paramètres.
 *
 * Use this instead of the old `calculatePlatformFee` / `calculateProfessionalPayout`
 * helpers, which read `process.env.PLATFORM_FEE_PERCENTAGE`. Those disagreed with
 * `PlatformSettings.platformFeePercentage` (env 10 vs db 11 in production), so a
 * price split at booking was silently re-split at a different rate later — the
 * admin's configured percentage was discarded exactly when money moved.
 * There must be exactly one source of truth for the split.
 *
 * `professionalPayout` is derived as `price − platformFee` so that
 * `price === platformFee + professionalPayout` holds by construction, whatever
 * the rounding.
 */
export async function splitPriceByPlatformFee(price: number): Promise<{
  platformFee: number;
  professionalPayout: number;
  platformFeePercentage: number;
}> {
  const platformSettings = await PlatformSettings.findOne();
  const platformFeePercentage = platformSettings?.platformFeePercentage ?? 10;

  const platformFee = roundMoney((price * platformFeePercentage) / 100);
  const professionalPayout = roundMoney(price - platformFee);

  return { platformFee, professionalPayout, platformFeePercentage };
}

/**
 * Get all pricing for a professional (all therapy types).
 *
 * @deprecated Currently **unused** (no callers as of 2026-08-31) and not updated
 * for the client-price / professional-rate model: it returns the legacy single
 * number, which is now the professional's *rate*, in a shape that reads like a
 * client price. Do not call it — use {@link calculateAppointmentPricing}, which
 * resolves `rates` then the legacy field and returns an explicit split. Kept
 * only so this change stays scoped; delete it or rewrite it against `rates`
 * when the admin pricing editor lands (spec 001 step 6).
 */
export async function getProfessionalPricing(profileId: string) {
  const profile = await Profile.findOne({ userId: profileId });
  const platformSettings = await PlatformSettings.findOne();

  const defaultPricing = {
    solo: 120,
    couple: 150,
    group: 80,
  };

  const pricing = {
    solo:
      profile?.pricing?.individualSession ||
      platformSettings?.defaultPricing?.solo ||
      defaultPricing.solo,
    couple:
      profile?.pricing?.coupleSession ||
      platformSettings?.defaultPricing?.couple ||
      defaultPricing.couple,
    group:
      profile?.pricing?.groupSession ||
      platformSettings?.defaultPricing?.group ||
      defaultPricing.group,
  };

  return {
    pricing,
    hasProfessionalPricing: !!(
      profile?.pricing?.individualSession ||
      profile?.pricing?.coupleSession ||
      profile?.pricing?.groupSession
    ),
    currency: platformSettings?.currency || "CAD",
  };
}

/**
 * Format price for display
 */
export function formatPrice(amount: number, currency: string = "CAD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Get therapy type display name
 */
export function getTherapyTypeLabel(
  therapyType: "solo" | "couple" | "group",
): string {
  const labels = {
    solo: "Individual Therapy",
    couple: "Couple Therapy",
    group: "Group Therapy",
  };
  return labels[therapyType];
}
