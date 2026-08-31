"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  rateFromSpreadPercentage,
  spreadOf,
  THERAPY_TYPES,
  type TherapyType,
} from "@/lib/professional-pricing";

/**
 * Admin-only editor for one professional's pricing.
 *
 * The client pays `clientPrice`, the professional receives `professionalRate`,
 * and the platform keeps the spread. Both amounts are edited and stored
 * explicitly; the percentage box is a convenience that back-computes the rate,
 * never the stored source of truth (spec 001 AC-7).
 *
 * Rendered only when an admin is viewing another professional's profile — a
 * professional cannot reach this, and `PUT /api/profile` drops `pricing`/`rates`
 * so there is no way around it.
 */

interface RateRow {
  clientPrice: string;
  professionalRate: string;
}

type RatesState = Record<TherapyType, RateRow>;

const EMPTY: RatesState = {
  solo: { clientPrice: "", professionalRate: "" },
  couple: { clientPrice: "", professionalRate: "" },
  group: { clientPrice: "", professionalRate: "" },
};

const LABEL_KEY: Record<TherapyType, string> = {
  solo: "individualSession",
  couple: "coupleSession",
  group: "groupSession",
};

const numeric = (v: string): number | undefined => {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export default function AdminProfessionalPricing({
  userId,
  defaultPricing,
}: {
  /** The professional whose pricing is being edited. */
  userId: string;
  /** Platform defaults, shown as the effective client price when none is set. */
  defaultPricing?: Partial<Record<TherapyType, number>>;
}) {
  const t = useTranslations("Dashboard.adminPricing");

  const [rates, setRates] = useState<RatesState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/professionals/${userId}/pricing`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();

      const next = { ...EMPTY };
      for (const type of THERAPY_TYPES) {
        const row = data?.rates?.[type];
        next[type] = {
          clientPrice: row?.clientPrice != null ? String(row.clientPrice) : "",
          professionalRate:
            row?.professionalRate != null ? String(row.professionalRate) : "",
        };
      }
      setRates(next);
      setMessage(null);
    } catch {
      setMessageType("error");
      setMessage(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (type: TherapyType, field: keyof RateRow, value: string) =>
    setRates((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));

  /** Percentage box: back-compute the rate, then store the amount. */
  const applyPercentage = (type: TherapyType, pct: string) => {
    const price = numeric(rates[type].clientPrice);
    const parsed = numeric(pct);
    if (price === undefined || parsed === undefined) return;
    setField(
      type,
      "professionalRate",
      String(rateFromSpreadPercentage(price, parsed)),
    );
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const type of THERAPY_TYPES) {
        const price = rates[type].clientPrice.trim();
        const rate = rates[type].professionalRate.trim();
        payload[type] = {
          clientPrice: price === "" ? null : Number(price),
          professionalRate: rate === "" ? null : Number(rate),
        };
      }

      const res = await fetch(`/api/admin/professionals/${userId}/pricing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: payload }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessageType("error");
        // Known validation codes get a translated message; anything else falls
        // back to a generic one rather than leaking a raw error code.
        const known = ["RATE_EXCEEDS_CLIENT_PRICE", "CLIENT_PRICE_MUST_BE_POSITIVE"];
        setMessage(
          known.includes(data?.error) ? t(`errors.${data.error}`) : t("saveFailed"),
        );
        return;
      }

      setMessageType("success");
      setMessage(t("saved"));
      await load();
    } catch {
      setMessageType("error");
      setMessage(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-6">
        <h2 className="text-xl font-serif font-light text-foreground mb-2">
          {t("title")}
        </h2>
        <p className="text-muted-foreground">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-6">
      <h2 className="text-xl font-serif font-light text-foreground mb-1">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground mb-6">{t("description")}</p>

      <div className="space-y-6">
        {THERAPY_TYPES.map((type) => {
          const price = numeric(rates[type].clientPrice);
          const rate = numeric(rates[type].professionalRate);
          const fallbackPrice = defaultPricing?.[type];
          const effectivePrice = price ?? fallbackPrice;
          const spread =
            effectivePrice !== undefined && rate !== undefined
              ? spreadOf(effectivePrice, rate)
              : null;
          const invalid = spread !== null && spread.amount < 0;
          const zero = spread !== null && spread.amount === 0;

          return (
            <div key={type} className="p-4 bg-muted/30 rounded-lg">
              <Label className="font-medium mb-3 block">
                {t(`types.${LABEL_KEY[type]}`)}
              </Label>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label
                    htmlFor={`${type}-clientPrice`}
                    className="text-xs mb-1 block"
                  >
                    {t("clientPrice")}
                  </Label>
                  <Input
                    id={`${type}-clientPrice`}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder={
                      fallbackPrice !== undefined
                        ? t("usingDefault", { amount: fallbackPrice })
                        : ""
                    }
                    value={rates[type].clientPrice}
                    onChange={(e) =>
                      setField(type, "clientPrice", e.target.value)
                    }
                  />
                </div>

                <div>
                  <Label
                    htmlFor={`${type}-professionalRate`}
                    className="text-xs mb-1 block"
                  >
                    {t("professionalRate")}
                  </Label>
                  <Input
                    id={`${type}-professionalRate`}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={rates[type].professionalRate}
                    onChange={(e) =>
                      setField(type, "professionalRate", e.target.value)
                    }
                  />
                </div>

                <div>
                  <Label
                    htmlFor={`${type}-spreadPct`}
                    className="text-xs mb-1 block"
                  >
                    {t("spreadPercentage")}
                  </Label>
                  <Input
                    id={`${type}-spreadPct`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    inputMode="decimal"
                    value={spread ? String(spread.percentage) : ""}
                    onChange={(e) => applyPercentage(type, e.target.value)}
                    disabled={effectivePrice === undefined}
                  />
                </div>
              </div>

              <p
                className={`mt-2 text-sm ${
                  invalid
                    ? "text-destructive"
                    : zero
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-muted-foreground"
                }`}
              >
                {spread === null
                  ? t("spreadUnset")
                  : invalid
                    ? t("spreadNegative")
                    : zero
                      ? t("spreadZero")
                      : t("spreadSummary", {
                          amount: spread.amount,
                          percentage: spread.percentage,
                        })}
              </p>
            </div>
          );
        })}
      </div>

      {message && (
        <p
          role="status"
          className={`mt-4 text-sm ${
            messageType === "error" ? "text-destructive" : "text-emerald-600"
          }`}
        >
          {message}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? t("saving") : t("save")}
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={saving}>
          {t("reset")}
        </Button>
      </div>
    </div>
  );
}
