"use client";

import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Landmark,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

type PaymentMethodType = "card" | "acss_debit";

interface AddPaymentMethodModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

function SetupForm({
  onSuccess,
  onError,
  paymentMethodType,
}: {
  onSuccess?: () => void;
  onError?: (error: string) => void;
  paymentMethodType: PaymentMethodType;
}) {
  const t = useTranslations("Client.billing.addPaymentMethodModal");
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | null>(
    null,
  );
  const [isComplete, setIsComplete] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setMessage(null);
    setMessageKind(null);

    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setMessage(error.message || t("addError"));
      setMessageKind("error");
      onError?.(error.message || t("unableToAdd"));
      setLoading(false);
    } else if (setupIntent && setupIntent.status === "succeeded") {
      setMessage(t("addedSuccess"));
      setMessageKind("success");
      setIsComplete(true);

      // Save payment method to backend
      try {
        await apiClient.post("/payments/payment-methods", {
          paymentMethodId: setupIntent.payment_method,
        });
        setTimeout(() => {
          onSuccess?.();
        }, 1500);
      } catch (err) {
        console.error("Error saving payment method:", err);
        setMessage(t("saveFailed"));
        setMessageKind("error");
        setLoading(false);
      }
    } else if (setupIntent && setupIntent.status === "processing") {
      setMessage(t("verificationProgress"));
      setMessageKind("success");
      setIsComplete(true);
      setTimeout(() => {
        onSuccess?.();
      }, 2000);
    } else {
      setMessage(t("unableToAdd"));
      setMessageKind("error");
      setLoading(false);
    }
  };

  const getIcon = () => {
    return paymentMethodType === "acss_debit" ? (
      <Landmark className="h-5 w-5 text-primary" />
    ) : (
      <CreditCard className="h-5 w-5 text-primary" />
    );
  };

  const getSectionLabel = () => {
    return paymentMethodType === "acss_debit"
      ? t("addPadSection")
      : t("addCardSection");
  };

  if (isComplete) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-medium text-foreground mb-2">
          {paymentMethodType === "acss_debit"
            ? t("successPadTitle")
            : t("successCardTitle")}
        </h3>
        <p className="text-muted-foreground">
          {paymentMethodType === "acss_debit"
            ? t("successPadBody")
            : t("successCardBody")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4">
        <div className="flex items-center gap-3 mb-2">
          {getIcon()}
          <span className="text-sm font-medium text-foreground">
            {getSectionLabel()}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {paymentMethodType === "acss_debit"
            ? t("padNote")
            : t("cardSavedNote")}
        </p>
      </div>

      {paymentMethodType === "acss_debit" && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-800 p-4">
          <div className="flex items-start gap-2">
            <Landmark className="h-5 w-5 text-purple-600 dark:text-purple-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                {t("padAgreementTitle")}
              </p>
              <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                {t("padAgreementBody")}
              </p>
            </div>
          </div>
        </div>
      )}

      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />

      {message && (
        <div
          className={`rounded-lg border p-4 flex items-start gap-3 ${
            messageKind === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200"
          }`}
        >
          {messageKind === "success" ? (
            <CheckCircle2 className="h-5 w-5 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 mt-0.5" />
          )}
          <p className="text-sm">{message}</p>
        </div>
      )}

      <Button
        type="submit"
        disabled={!stripe || !elements || loading}
        className="w-full"
        size="lg"
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading
          ? t("adding")
          : paymentMethodType === "acss_debit"
            ? t("linkBankAccount")
            : t("addCardBtn")}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {paymentMethodType === "acss_debit"
          ? t("padSecuredFootnote")
          : t("cardSecuredFootnote")}
      </p>
    </form>
  );
}

export default function AddPaymentMethodModal({
  open,
  onOpenChange,
  onSuccess,
}: AddPaymentMethodModalProps) {
  const t = useTranslations("Client.billing.addPaymentMethodModal");
  const locale = useLocale();
  const stripeLocale = locale === "fr" ? "fr-CA" : "en-CA";
  const paymentMethodOptions: {
    id: PaymentMethodType;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "card",
      label: t("cardLabel"),
      description: t("cardDescription"),
      icon: <CreditCard className="h-5 w-5" />,
    },
    {
      id: "acss_debit",
      label: t("padLabel"),
      description: t("padDescription"),
      icon: <Landmark className="h-5 w-5" />,
    },
  ];
  const [clientSecret, setClientSecret] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<PaymentMethodType>("card");
  const [typeSelected, setTypeSelected] = useState(false);

  const createSetupIntent = useCallback(
    async (type: PaymentMethodType) => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiClient.post<{
          clientSecret: string;
          setupIntentId: string;
          paymentMethodType: string;
        }>("/payments/setup-intent", { paymentMethodType: type });

        setClientSecret(response.clientSecret);
        setTypeSelected(true);
      } catch (err) {
        console.error("Error creating setup intent:", err);
        setError(
          err instanceof Error ? err.message : t("addError"),
        );
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setClientSecret("");
      setError(null);
      setLoading(false);
      setSelectedType("card");
      setTypeSelected(false);
    }
  }, [open]);

  const handleContinue = () => {
    createSetupIntent(selectedType);
  };

  const handleBack = () => {
    setTypeSelected(false);
    setClientSecret("");
    setError(null);
  };

  const handleSuccess = () => {
    onSuccess?.();
    onOpenChange(false);
  };

  const appearance = {
    theme: "stripe" as const,
    variables: {
      colorPrimary: "#0f172a",
      borderRadius: "8px",
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif font-light">
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {typeSelected ? t("subtitleEnter") : t("subtitleSelect")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {/* Payment Method Type Selection */}
          {!typeSelected && !loading && (
            <div className="space-y-6">
              <div className="space-y-3">
                {paymentMethodOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedType(option.id)}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left",
                      selectedType === option.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border/40 bg-card/50 hover:bg-accent/50",
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-full p-2.5",
                        selectedType === option.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {option.icon}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground">
                        {option.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {option.description}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-5 rounded-full border-2 flex items-center justify-center",
                        selectedType === option.id
                          ? "border-primary"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {selectedType === option.id && (
                        <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-200">
                    {error}
                  </p>
                </div>
              )}

              <Button onClick={handleContinue} className="w-full" size="lg">
                {t("continue")}
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">{t("preparing")}</p>
            </div>
          )}

          {!loading && error && typeSelected && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    {t("errorTitle")}
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                    {error}
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={handleBack} className="w-full">
                {t("goBack")}
              </Button>
            </div>
          )}

          {!loading && !error && clientSecret && typeSelected && (
            <div className="space-y-4">
              <button
                onClick={handleBack}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                ← {t("changeType")}
              </button>
              <Elements
                options={{
                  clientSecret,
                  appearance,
                  locale: stripeLocale,
                }}
                stripe={stripePromise}
              >
                <SetupForm
                  onSuccess={handleSuccess}
                  onError={setError}
                  paymentMethodType={selectedType}
                />
              </Elements>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
