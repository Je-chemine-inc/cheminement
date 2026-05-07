"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Landmark } from "lucide-react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

type PaymentMethodType = "card" | "acss_debit";

function SetupInner({
  token,
  paymentMethodType,
  onSuccess,
  onError,
}: {
  token: string;
  paymentMethodType: PaymentMethodType;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("Client.guestPay");
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setMessage(null);

    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (error) {
      const m = error.message || t("errorLabel");
      setMessage(m);
      onError(m);
      setLoading(false);
      return;
    }

    if (
      setupIntent &&
      (setupIntent.status === "succeeded" ||
        setupIntent.status === "processing")
    ) {
      try {
        const res = await fetch("/api/payments/guest-appointment-setup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            setupIntentId: setupIntent.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || t("errorLabel"));
        }
        onSuccess();
      } catch (err) {
        const m =
          err instanceof Error ? err.message : t("errorLabel");
        setMessage(m);
        onError(m);
      } finally {
        setLoading(false);
      }
      return;
    }

    setMessage(t("errorLabel"));
    onError(t("errorLabel"));
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {paymentMethodType === "acss_debit" && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-800 p-4">
          <div className="flex items-start gap-2">
            <Landmark className="h-5 w-5 text-purple-600 dark:text-purple-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                {t("padCanadaTitle")}
              </p>
              <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                {t("padCanadaBody")}
              </p>
            </div>
          </div>
        </div>
      )}

      <PaymentElement options={{ layout: "tabs" }} />

      {message && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 mt-0.5 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-800 dark:text-red-200">{message}</p>
        </div>
      )}

      <Button type="submit" disabled={!stripe || !elements || loading} className="w-full" size="lg">
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("saving")}
          </>
        ) : paymentMethodType === "acss_debit" ? (
          t("linkBankConfirm")
        ) : (
          t("saveCardConfirm")
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {t("stripeSecuredFootnote")}
      </p>
    </form>
  );
}

export default function GuestPaySetupFlow({
  token,
  clientSecret,
  paymentMethodType,
  onSuccess,
  onError,
}: {
  token: string;
  clientSecret: string;
  paymentMethodType: PaymentMethodType;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const locale = useLocale();
  const stripeLocale = locale === "fr" ? "fr-CA" : "en-CA";
  const appearance = {
    theme: "stripe" as const,
    variables: {
      colorPrimary: "#0f172a",
      borderRadius: "8px",
    },
  };

  return (
    <Elements
      options={{
        clientSecret,
        appearance,
        locale: stripeLocale,
      }}
      stripe={stripePromise}
    >
      <SetupInner
        token={token}
        paymentMethodType={paymentMethodType}
        onSuccess={onSuccess}
        onError={onError}
      />
    </Elements>
  );
}
