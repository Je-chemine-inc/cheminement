"use client";

import { useLocale, useTranslations } from "next-intl";
import { Receipt } from "lucide-react";
import { formatCad } from "@/lib/format-currency";
import {
  DEFAULT_TPS_RATE_PERCENT,
  DEFAULT_TVQ_RATE_PERCENT,
  MAX_SALES_TAX_RATE_PERCENT,
  TAX_NUMBER_MAX_LENGTH,
  taxOnCents,
  type SalesTaxSettings,
} from "@/lib/sales-taxes";

/** The price the example is worked out on. */
const EXAMPLE_PRICE_CENTS = 4900;

/**
 * « Taxes sur les ventes en ligne » in the admin settings: the switch, the TPS
 * and TVQ rates and the registration numbers. The example uses the checkout's
 * own arithmetic, so what an admin reads here is what a buyer is charged. The
 * server validates everything again (api/admin/settings).
 */
export function SalesTaxesSettings({
  value,
  onChange,
}: {
  value: SalesTaxSettings | undefined;
  onChange: (next: SalesTaxSettings) => void;
}) {
  const t = useTranslations("AdminDashboard.settings");
  const locale = useLocale();
  const taxes: SalesTaxSettings = value ?? {
    enabled: false,
    tpsRatePercent: DEFAULT_TPS_RATE_PERCENT,
    tvqRatePercent: DEFAULT_TVQ_RATE_PERCENT,
    tpsNumber: "",
    tvqNumber: "",
  };
  const set = (patch: Partial<SalesTaxSettings>) => onChange({ ...taxes, ...patch });
  const numbersMissing = !taxes.tpsNumber.trim() || !taxes.tvqNumber.trim();
  const rateOf = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const tps = taxOnCents(EXAMPLE_PRICE_CENTS, taxes.tpsRatePercent);
  const tvq = taxOnCents(EXAMPLE_PRICE_CENTS, taxes.tvqRatePercent);
  const inputClass =
    "w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="rounded-xl bg-card p-6 border border-border/40" data-testid="sales-taxes-settings">
      <div className="flex items-center gap-2 mb-2">
        <Receipt className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-serif font-light text-foreground">{t("salesTaxesTitle")}</h2>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">{t("salesTaxesHelp")}</p>

      <label className="mb-2 flex items-center gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={taxes.enabled}
          disabled={!taxes.enabled && numbersMissing}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="h-4 w-4"
        />
        {t("salesTaxesEnabled")}
      </label>
      <p className={`mb-6 text-xs ${!taxes.enabled && numbersMissing ? "text-amber-700" : "text-muted-foreground"}`}>
        {!taxes.enabled && numbersMissing ? t("salesTaxesNumbersRequired") : taxes.enabled ? "" : t("salesTaxesOff")}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="tps-rate" className="block text-sm font-light text-muted-foreground mb-2">
            {t("tpsRate")}
          </label>
          <input
            id="tps-rate"
            type="number"
            min="0"
            max={MAX_SALES_TAX_RATE_PERCENT}
            step="0.001"
            value={taxes.tpsRatePercent}
            onChange={(e) => set({ tpsRatePercent: rateOf(e.target.value) })}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground mt-1">{t("salesTaxesRateHelp")}</p>
        </div>
        <div>
          <label htmlFor="tvq-rate" className="block text-sm font-light text-muted-foreground mb-2">
            {t("tvqRate")}
          </label>
          <input
            id="tvq-rate"
            type="number"
            min="0"
            max={MAX_SALES_TAX_RATE_PERCENT}
            step="0.001"
            value={taxes.tvqRatePercent}
            onChange={(e) => set({ tvqRatePercent: rateOf(e.target.value) })}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground mt-1">{t("salesTaxesRateHelp")}</p>
        </div>
        <div>
          <label htmlFor="tps-number" className="block text-sm font-light text-muted-foreground mb-2">
            {t("tpsNumber")}
          </label>
          <input
            id="tps-number"
            type="text"
            maxLength={TAX_NUMBER_MAX_LENGTH}
            value={taxes.tpsNumber}
            onChange={(e) => set({ tpsNumber: e.target.value })}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground mt-1">{t("taxNumberHelp")}</p>
        </div>
        <div>
          <label htmlFor="tvq-number" className="block text-sm font-light text-muted-foreground mb-2">
            {t("tvqNumber")}
          </label>
          <input
            id="tvq-number"
            type="text"
            maxLength={TAX_NUMBER_MAX_LENGTH}
            value={taxes.tvqNumber}
            onChange={(e) => set({ tvqNumber: e.target.value })}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground mt-1">{t("taxNumberHelp")}</p>
        </div>
      </div>

      <p className="mt-6 text-sm text-foreground" data-testid="sales-taxes-example">
        {t("salesTaxesExample", {
          price: formatCad(EXAMPLE_PRICE_CENTS, locale),
          tps: formatCad(tps, locale),
          tvq: formatCad(tvq, locale),
          total: formatCad(EXAMPLE_PRICE_CENTS + tps + tvq, locale),
        })}
      </p>
    </div>
  );
}
