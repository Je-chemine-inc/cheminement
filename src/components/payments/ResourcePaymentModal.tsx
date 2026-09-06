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
  isSignedIn: boolean;
  signedInEmail?: string;
}

export default function ResourcePaymentModal({
  open,
  onOpenChange,
  slug,
  title,
  priceCents,
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

  const price = formatCad(priceCents, locale);

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

        <div className="mb-4 flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 p-4">
          <span className="text-sm text-muted-foreground">{t("amountToPay")}</span>
          <span className="font-serif text-xl font-light text-foreground">{price}</span>
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
                amount={priceCents / 100}
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
