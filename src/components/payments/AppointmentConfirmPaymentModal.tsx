"use client";

import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
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
  Banknote,
} from "lucide-react";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

type PaymentMethodType = "card" | "acss_debit";
type SelectedPaymentChoice = PaymentMethodType | "interac_manual";

const paymentMethodOptions: {
  id: SelectedPaymentChoice;
  labelKey:
    | "cardLabel"
    | "padLabel"
    | "interacLabel";
  descriptionKey:
    | "cardDescription"
    | "padDescription"
    | "interacDescription";
  icon: React.ReactNode;
}[] = [
  {
    id: "card",
    labelKey: "cardLabel",
    descriptionKey: "cardDescription",
    icon: <CreditCard className="h-5 w-5" />,
  },
  {
    id: "acss_debit",
    labelKey: "padLabel",
    descriptionKey: "padDescription",
    icon: <Landmark className="h-5 w-5" />,
  },
  {
    id: "interac_manual",
    labelKey: "interacLabel",
    descriptionKey: "interacDescription",
    icon: <Banknote className="h-5 w-5" />,
  },
];

function AppointmentSetupForm({
  appointmentId,
  paymentMethodType,
  onSuccess,
}: {
  appointmentId: string;
  paymentMethodType: PaymentMethodType;
  onSuccess?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const t = useTranslations("Client.billing.appointmentConfirm");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

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
      setMessage(error.message || "An error occurred");
      setLoading(false);
      return;
    }

    if (
      setupIntent &&
      (setupIntent.status === "succeeded" ||
        setupIntent.status === "processing")
    ) {
      try {
        await apiClient.post("/payments/appointment-setup/complete", {
          appointmentId,
          setupIntentId: setupIntent.id,
        });
        setMessage(t("successMessage"));
        setIsComplete(true);
        setTimeout(() => onSuccess?.(), 1200);
      } catch (err) {
        if (!(err instanceof ApiClientError && err.status < 500)) {
          console.error(err);
        }
        const m =
          err instanceof Error ? err.message : t("saveFailed");
        setMessage(m);
      } finally {
        setLoading(false);
      }
      return;
    }

    setMessage(t("incomplete"));
    setLoading(false);
  };

  if (isComplete) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-medium text-foreground mb-2">
          {t("successTitle")}
        </h3>
        <p className="text-muted-foreground">{t("successBody")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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

      <PaymentElement options={{ layout: "tabs" }} />

      {message && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3 text-sm">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          <p>{message}</p>
        </div>
      )}

      <Button type="submit" disabled={!stripe || !elements || loading} className="w-full" size="lg">
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading
          ? t("saving")
          : paymentMethodType === "acss_debit"
            ? t("submitPad")
            : t("submitCard")}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {t("stripeFootnote")}
      </p>
    </form>
  );
}

interface AppointmentConfirmPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  onSuccess?: () => void;
}

export default function AppointmentConfirmPaymentModal({
  open,
  onOpenChange,
  appointmentId,
  onSuccess,
}: AppointmentConfirmPaymentModalProps) {
  const t = useTranslations("Client.billing.appointmentConfirm");
  const locale = useLocale();
  const stripeLocale = locale === "fr" ? "fr-CA" : "en-CA";
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] =
    useState<SelectedPaymentChoice>("card");
  const [typeSelected, setTypeSelected] = useState(false);

  const submitInteracRequest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await apiClient.post("/payments/request-transfer-guarantee", {
        appointmentId,
      });
      setTypeSelected(true);
      setClientSecret("__interac__");
    } catch (err) {
      if (!(err instanceof ApiClientError && err.status < 500)) {
        console.error(err);
      }
      setError(
        err instanceof Error ? err.message : t("initFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [appointmentId, t]);

  const createSetupIntent = useCallback(
    async (type: PaymentMethodType) => {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient.post<{
          clientSecret: string;
          setupIntentId: string;
        }>("/payments/appointment-setup", {
          appointmentId,
          paymentMethodType: type,
        });
        setClientSecret(response.clientSecret);
        setTypeSelected(true);
      } catch (err) {
        if (!(err instanceof ApiClientError && err.status < 500)) {
          console.error(err);
        }
        setError(
          err instanceof Error ? err.message : t("initFailed"),
        );
      } finally {
        setLoading(false);
      }
    },
    [appointmentId, t],
  );

  useEffect(() => {
    if (!open) {
      setClientSecret("");
      setError(null);
      setLoading(false);
      setSelectedType("card");
      setTypeSelected(false);
    }
  }, [open]);

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
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
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
                        {t(option.labelKey)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t(option.descriptionKey)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <Button
                onClick={() =>
                  selectedType === "interac_manual"
                    ? void submitInteracRequest()
                    : createSetupIntent(selectedType)
                }
                className="w-full"
                size="lg"
              >
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

          {!loading && clientSecret && typeSelected && clientSecret === "__interac__" && (
            <div className="text-center py-8 space-y-4">
              <CheckCircle2 className="h-16 w-16 text-amber-500 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-foreground mb-2">
                {t("interacSuccessTitle")}
              </h3>
              <p className="text-muted-foreground text-sm">{t("interacSuccessBody")}</p>
              <Button
                className="mt-4"
                onClick={() => {
                  onSuccess?.();
                  onOpenChange(false);
                }}
              >
                {t("continue")}
              </Button>
            </div>
          )}

          {!loading &&
            clientSecret &&
            typeSelected &&
            clientSecret !== "__interac__" && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setTypeSelected(false);
                  setClientSecret("");
                  setError(null);
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                ← {t("changeType")}
              </button>
              <Elements
                options={{ clientSecret, appearance, locale: stripeLocale }}
                stripe={stripePromise}
              >
                <AppointmentSetupForm
                  appointmentId={appointmentId}
                  paymentMethodType={selectedType as PaymentMethodType}
                  onSuccess={() => {
                    onSuccess?.();
                    onOpenChange(false);
                  }}
                />
              </Elements>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
