import "server-only";
import connectToDatabase from "@/lib/mongodb";
import PlatformSettings from "@/models/PlatformSettings";
import { salesTaxSettingsOf, salesTaxesApply, type CheckoutTaxRates } from "@/lib/sales-taxes";

/**
 * The TPS and TVQ rates a checkout adds right now, for showing the price with
 * its taxes before the buyer starts paying; null when no tax is added. What is
 * actually charged is computed again by the purchase-intent route.
 */
export async function loadCheckoutTaxRates(): Promise<CheckoutTaxRates | null> {
  await connectToDatabase();
  const doc = await PlatformSettings.findOne().select("salesTaxes").lean<{ salesTaxes?: unknown } | null>();
  const settings = salesTaxSettingsOf(doc?.salesTaxes);
  return salesTaxesApply(settings)
    ? { tpsRatePercent: settings.tpsRatePercent, tvqRatePercent: settings.tvqRatePercent }
    : null;
}
