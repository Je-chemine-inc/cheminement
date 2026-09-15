/**
 * TPS and TVQ on online sales: professionals' products and the team's premium
 * resources on /book. An admin sets the rates and the registration numbers
 * (PlatformSettings.salesTaxes); the taxes are added at checkout on top of the
 * displayed price, and every purchase keeps the amounts and rates it was
 * charged with, so a later change never alters a past sale.
 *
 * Pure and client-safe: the settings screen shows its example with the same
 * arithmetic the checkout charges.
 *
 * Money is integer cents; rates are carried as thousandths of a percent
 * (9,975 % → 9975) so no step goes through a float.
 */

export const DEFAULT_TPS_RATE_PERCENT = 5;
export const DEFAULT_TVQ_RATE_PERCENT = 9.975;
export const MAX_SALES_TAX_RATE_PERCENT = 20;
export const TAX_NUMBER_MAX_LENGTH = 30;

export interface SalesTaxSettings {
  enabled: boolean;
  tpsRatePercent: number;
  tvqRatePercent: number;
  tpsNumber: string;
  tvqNumber: string;
}

/** The rates a checkout adds, as the browser receives them before a purchase starts. */
export interface CheckoutTaxRates {
  tpsRatePercent: number;
  tvqRatePercent: number;
}

/** What one sale is charged, as stored on the purchase. */
export interface SaleTaxBreakdown {
  subtotalCents: number;
  tpsCents: number;
  tvqCents: number;
  totalCents: number;
  tpsRatePercent: number;
  tvqRatePercent: number;
  tpsNumber: string;
  tvqNumber: string;
}

/** A rate as an admin may save it: 0–20 %, at most three decimals. Null when refused. */
export function parseTaxRatePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_SALES_TAX_RATE_PERCENT) return null;
  const milli = Math.round(value * 1000);
  if (Math.abs(milli / 1000 - value) > 1e-9) return null;
  return milli / 1000;
}

/** A registration number: trimmed, letters, digits, spaces and hyphens, 30 characters at most. Null when refused. */
export function parseTaxNumber(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > TAX_NUMBER_MAX_LENGTH) return null;
  return /^[A-Za-z0-9 -]*$/.test(text) ? text : null;
}

/** The saved settings with their defaults; a missing or broken rate falls back to the official one. */
export function salesTaxSettingsOf(raw: unknown): SalesTaxSettings {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof SalesTaxSettings, unknown>>;
  return {
    enabled: input.enabled === true,
    tpsRatePercent: parseTaxRatePercent(input.tpsRatePercent) ?? DEFAULT_TPS_RATE_PERCENT,
    tvqRatePercent: parseTaxRatePercent(input.tvqRatePercent) ?? DEFAULT_TVQ_RATE_PERCENT,
    tpsNumber: parseTaxNumber(input.tpsNumber) ?? "",
    tvqNumber: parseTaxNumber(input.tvqNumber) ?? "",
  };
}

/** Taxes are charged only when switched on with both registration numbers filled in. */
export function salesTaxesApply(settings: SalesTaxSettings): boolean {
  return settings.enabled && settings.tpsNumber !== "" && settings.tvqNumber !== "";
}

/** One tax on a subtotal, rounded half up to the cent, in integers only. */
export function taxOnCents(subtotalCents: number, ratePercent: number): number {
  const subtotal = Math.max(0, Math.round(subtotalCents));
  const milli = Math.round(ratePercent * 1000);
  return Math.floor((subtotal * milli + 50_000) / 100_000);
}

/**
 * What a sale at `subtotalCents` is charged. Null when taxes do not apply: the
 * buyer then pays the displayed price and nothing else.
 * 49,00 $ at 5 % and 9,975 % → TPS 245, TVQ 489, total 5 634.
 */
export function saleTaxBreakdown(subtotalCents: number, settings: SalesTaxSettings): SaleTaxBreakdown | null {
  if (!salesTaxesApply(settings)) return null;
  const subtotal = Math.max(0, Math.round(subtotalCents));
  const tpsCents = taxOnCents(subtotal, settings.tpsRatePercent);
  const tvqCents = taxOnCents(subtotal, settings.tvqRatePercent);
  return {
    subtotalCents: subtotal,
    tpsCents,
    tvqCents,
    totalCents: subtotal + tpsCents + tvqCents,
    tpsRatePercent: settings.tpsRatePercent,
    tvqRatePercent: settings.tvqRatePercent,
    tpsNumber: settings.tpsNumber,
    tvqNumber: settings.tvqNumber,
  };
}
