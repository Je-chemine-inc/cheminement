"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ACCEPT_ALL,
  REFUSE_NON_ESSENTIAL,
  readCookieConsent,
  writeCookieConsent,
  type CookieConsentCategories,
} from "@/lib/cookie-consent";

/**
 * Law 25 (Quebec) cookie consent banner.
 *
 * - Renders only when the user has not yet made a decision (or the stored
 *   decision is from an older policy version).
 * - Three actions on the top row: Accept all / Refuse non-essential /
 *   Customize. Per Law 25 the refuse path must be as prominent as accept.
 * - "Personnaliser" expands the banner in place with per-category toggles
 *   for `statistics` and `marketing`. Essential cookies (auth, locale) are
 *   always granted and shown as locked-on.
 * - Mounted globally in the root layout; sits at the bottom of the viewport.
 */
export function CookieConsentBanner() {
  const t = useTranslations("CookieConsent");
  const [visible, setVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [draft, setDraft] = useState<CookieConsentCategories>(
    REFUSE_NON_ESSENTIAL,
  );

  useEffect(() => {
    // Cookie is only readable client-side, so we defer the check to after
    // hydration. The single cascading render here is intentional — without it
    // SSR would emit the banner markup before we know if the user has already
    // consented, causing a flash.
    const decision = readCookieConsent();
    if (!decision) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
    }
  }, []);

  const decide = (categories: CookieConsentCategories) => {
    writeCookieConsent(categories);
    setVisible(false);
    setShowCustomize(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border/60 bg-background/95 shadow-[0_-8px_20px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="flex items-start gap-3">
            <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Cookie className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p
                id="cookie-consent-title"
                className="text-sm font-medium text-foreground"
              >
                🍪 {t("title")}
              </p>
              <p
                id="cookie-consent-body"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                {t("body")}{" "}
                {t("learnMorePrefix")}{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("privacyPolicy")}
                </Link>
                {", "}
                <Link
                  href="/cookies"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("cookiesPolicy")}
                </Link>
                .
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center lg:flex-row">
            <Button
              type="button"
              onClick={() => decide(ACCEPT_ALL)}
              className="min-w-[140px]"
            >
              {t("acceptAll")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => decide(REFUSE_NON_ESSENTIAL)}
              className="min-w-[220px]"
            >
              {t("refuseNonEssential")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCustomize((v) => !v)}
              aria-expanded={showCustomize}
              aria-controls="cookie-consent-customize"
              className="min-w-[140px]"
            >
              {t("customize")}
            </Button>
          </div>
        </div>

        {showCustomize ? (
          <div
            id="cookie-consent-customize"
            className="mt-5 rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <CategoryRow
                title={t("categoryEssential")}
                requiredSuffix={t("requiredSuffix")}
                description={t("categoryEssentialDesc")}
                checked
                locked
              />
              <CategoryRow
                title={t("categoryStatistics")}
                description={t("categoryStatisticsDesc")}
                checked={draft.statistics}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, statistics: v }))
                }
              />
              <CategoryRow
                title={t("categoryMarketing")}
                description={t("categoryMarketingDesc")}
                checked={draft.marketing}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, marketing: v }))
                }
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => decide(draft)}
                className="min-w-[160px]"
              >
                {t("savePreferences")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CategoryRow({
  title,
  description,
  checked,
  onChange,
  locked,
  requiredSuffix,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  locked?: boolean;
  requiredSuffix?: string;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">
            {title}
            {locked && requiredSuffix ? (
              <span className="ml-1 font-normal text-muted-foreground">
                ({requiredSuffix})
              </span>
            ) : null}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        <Checkbox
          checked={checked}
          disabled={locked}
          onCheckedChange={(v) => onChange?.(v === true)}
          aria-label={title}
          className="mt-0.5"
        />
      </div>
    </div>
  );
}
