"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { AlertCircle, CheckCircle2, Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import CheckoutForm from "@/components/payments/CheckoutForm";
import { formatCad } from "@/lib/format-currency";
import { taxOnCents, type CheckoutTaxRates } from "@/lib/sales-taxes";

/**
 * Buying a premium resource.
 *
 * A sibling of PaymentModal rather than a generalisation of it. PaymentModal is
 * bound to appointments — its props, its endpoint and its PAD option — and it
 * is live on the client billing surface. Money is a legacy zone here: adding
 * beside is safer than rewriting. The genuinely reusable part, CheckoutForm, is
 * reused as-is.
 */

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

const appearance = {
  theme: "stripe" as const,
  variables: {
    colorPrimary: "#0f172a",
    borderRadius: "8px",
  },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "review" is the opening step for everyone: it shows the amount, and a guest
 * also types their email there. Members could technically skip it, but kicking
 * the fetch off from an effect meant a setState cascade on mount — and asking
 * for one deliberate click before a PaymentIntent exists also avoids creating
 * intents for people who only opened the dialog to look at the price.
 */
type Step = "review" | "loading" | "pay" | "owned" | "done" | "error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  title: string;
  priceCents: number;
  /** TPS and TVQ rates added at checkout, or null when none are. */
  taxRates: CheckoutTaxRates | null;
  isSignedIn: boolean;
  signedInEmail?: string;
}

/** What the buyer pays, as the purchase-intent route answered it. */
interface Charge {
  subtotalCents: number;
  tpsCents: number;
  tvqCents: number;
  totalCents: number;
  taxes: CheckoutTaxRates | null;
}

export default function ResourcePaymentModal({
  open,
  onOpenChange,
  slug,
  title,
  priceCents,
  taxRates,
  isSignedIn,
  signedInEmail,
}: Props) {
  const t = useTranslations("ResourceCheckout");
  const locale = useLocale();
  const router = useRouter();

  const [step, setStep] = useState<Step>("review");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // The server's figures once the intent exists; before that, the same
  // arithmetic on the rates the page was rendered with.
  const [serverCharge, setServerCharge] = useState<Charge | null>(null);

  const estimate: Charge = (() => {
    if (!taxRates) {
      return { subtotalCents: priceCents, tpsCents: 0, tvqCents: 0, totalCents: priceCents, taxes: null };
    }
    const tpsCents = taxOnCents(priceCents, taxRates.tpsRatePercent);
    const tvqCents = taxOnCents(priceCents, taxRates.tvqRatePercent);
    return { subtotalCents: priceCents, tpsCents, tvqCents, totalCents: priceCents + tpsCents + tvqCents, taxes: taxRates };
  })();
  const charge = serverCharge ?? estimate;
  const rate = (value: number) =>
    value.toLocaleString(locale === "fr" ? "fr-CA" : "en-CA", { maximumFractionDigits: 3 });

  const startIntent = useCallback(
    async (buyerEmail?: string) => {
      setStep("loading");
      setError(null);
      try {
        const res = await fetch(`/api/resources/${slug}/purchase-intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: buyerEmail, locale }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 409) {
          setStep("owned");
          return;
        }
        if (!res.ok) {
          setError(data?.error ?? t("errorTitle"));
          setStep("error");
          return;
        }

        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
        // The server computed what is charged; show exactly that from here on.
        if (typeof data.amountCents === "number") {
          setServerCharge({
            subtotalCents: typeof data.subtotalCents === "number" ? data.subtotalCents : data.amountCents,
            tpsCents: typeof data.tpsCents === "number" ? data.tpsCents : 0,
            tvqCents: typeof data.tvqCents === "number" ? data.tvqCents : 0,
            totalCents: data.amountCents,
            taxes: data.taxes ?? null,
          });
        }
        setStep("pay");
      } catch {
        setError(t("errorTitle"));
        setStep("error");
      }
    },
    [slug, locale, t],
  );

  const handlePaid = useCallback(async () => {
    // The webhook is the authoritative grant; this call just lets the buyer
    // start reading now instead of waiting for it. Both are idempotent, so
    // whichever lands first wins.
    try {
      const res = await fetch(`/api/resources/${slug}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.accessToken) setAccessToken(data.accessToken);
    } catch {
      // Payment succeeded regardless — the webhook will still grant access and
      // the email still goes out. Never show this as a failure.
    }
    setStep("done");
  }, [slug, paymentIntentId]);

  const readNow = () => {
    onOpenChange(false);
    if (accessToken) {
      router.push(`/book/${slug}?token=${accessToken}`);
    } else {
      router.refresh();
    }
  };

  const emailValid = EMAIL_PATTERN.test(email.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif font-light">
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("resourceLabel")} · {title}
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4 rounded-lg border border-border/40 bg-muted/30 p-4" data-testid="resource-charge">
          {charge.taxes ? (
            <dl className="mb-2 space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt>{t("subtotal")}</dt>
                <dd>{formatCad(charge.subtotalCents, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{t("tps", { rate: rate(charge.taxes.tpsRatePercent) })}</dt>
                <dd>{formatCad(charge.tpsCents, locale)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{t("tvq", { rate: rate(charge.taxes.tvqRatePercent) })}</dt>
                <dd>{formatCad(charge.tvqCents, locale)}</dd>
              </div>
            </dl>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{charge.taxes ? t("total") : t("amountToPay")}</span>
            <span className="font-serif text-xl font-light text-foreground">{formatCad(charge.totalCents, locale)}</span>
          </div>
          {charge.taxes && !serverCharge ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("taxesEstimate")}</p>
          ) : null}
        </div>

        {step === "review" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isSignedIn) startIntent();
              else if (emailValid) startIntent(email.trim());
            }}
            className="space-y-4"
          >
            {isSignedIn ? (
              <p className="text-sm text-muted-foreground">
                {t("signedInAs", { email: signedInEmail ?? "" })}
              </p>
            ) : (
              <div className="space-y-2">
                <label htmlFor="buyer-email" className="text-sm font-medium">
                  {t("emailLabel")}
                </label>
                <input
                  id="buyer-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {email.trim() && !emailValid ? (
                  <p className="text-xs text-destructive">{t("emailInvalid")}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("emailWhy")}</p>
                )}
              </div>
            )}
            <Button
              type="submit"
              disabled={!isSignedIn && !emailValid}
              className="w-full"
            >
              {t("continue")}
            </Button>
          </form>
        ) : null}

        {step === "loading" ? (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">{t("preparing")}</p>
          </div>
        ) : null}

        {step === "pay" && clientSecret ? (
          <>
            {isSignedIn && signedInEmail ? (
              <p className="mb-3 text-xs text-muted-foreground">
                {t("signedInAs", { email: signedInEmail })}
              </p>
            ) : null}
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance,
                locale: locale === "fr" ? "fr-CA" : "en-CA",
              }}
            >
              <CheckoutForm
                amount={charge.totalCents / 100}
                clientSecret={clientSecret}
                currency="CAD"
                paymentMethod="card"
                returnUrl={
                  typeof window !== "undefined"
                    ? `${window.location.origin}/book/${slug}`
                    : undefined
                }
                onSuccess={handlePaid}
                onError={setError}
              />
            </Elements>
          </>
        ) : null}

        {step === "owned" ? (
          <div className="space-y-4 py-6 text-center">
            <Lock className="mx-auto h-10 w-10 text-primary" />
            <p className="font-medium text-foreground">{t("alreadyOwnedTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("alreadyOwnedBody")}</p>
            <Button onClick={readNow} className="w-full">
              {t("readNow")}
            </Button>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4 py-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600 dark:text-green-400" />
            <p className="font-medium text-foreground">{t("successTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {isSignedIn
                ? t("successMemberBody")
                : t("successGuestBody", { email: email.trim() })}
            </p>
            <Button onClick={readNow} className="w-full">
              {t("readNow")}
            </Button>
            {isSignedIn ? (
              <Link
                href="/client/dashboard/library#purchased"
                className="block text-sm text-primary hover:underline"
              >
                {t("goToLibrary")}
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">{t("checkYourEmail")}</p>
            )}
          </div>
        ) : null}

        {step === "error" ? (
          <div className="space-y-4 py-6 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">{t("errorTitle")}</p>
            {error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : null}
            <Button
              variant="outline"
              onClick={() => setStep("review")}
              className="w-full"
            >
              {t("goBack")}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
