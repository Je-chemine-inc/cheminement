import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not defined in environment variables");
}

// Initialize Stripe with your secret key
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-10-29.clover",
  typescript: true,
});

// Default currency
export const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "CAD";

// REMOVED (2026-08-31): PLATFORM_FEE_PERCENTAGE, calculatePlatformFee and
// calculateProfessionalPayout.
//
// They read `process.env.PLATFORM_FEE_PERCENTAGE` while booking used
// `PlatformSettings.platformFeePercentage`. In production those were 10 and 11,
// so a split agreed at booking was silently re-derived at a different rate when
// the client was charged — the admin's configured percentage was discarded
// exactly when money moved.
//
// The single source of truth is now `splitPriceByPlatformFee` in @/lib/pricing.
// Do not reintroduce an env-based fee: it will disagree with the database again.

// Convert amount to cents for Stripe (Stripe uses smallest currency unit)
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

// Convert amount from cents to dollars
export function fromCents(amount: number): number {
  return amount / 100;
}
