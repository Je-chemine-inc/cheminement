"use client";

import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import CheckoutForm from "./CheckoutForm";
import { Loader2, AlertCircle, CreditCard, Landmark } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

type PaymentMethodType = "card" | "direct_debit";

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  amount: number;
  professionalName: string;
  appointmentDate?: string;
  onSuccess?: () => void;
}

export default function PaymentModal({
  open,
  onOpenChange,
  appointmentId,
  amount,
  professionalName,
  appointmentDate,
  onSuccess,
}: PaymentModalProps) {
  const t = useTranslations("Client.billing.paymentModal");
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
      id: "direct_debit",
      label: t("directDebitLabel"),
      description: t("directDebitDescription"),
      icon: <Landmark className="h-5 w-5" />,
    },
  ];
  const [clientSecret, setClientSecret] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethodType>("card");
  const [paymentInitiated, setPaymentInitiated] = useState(false);
  const [currency, setCurrency] = useState<string>("CAD");

  const createPaymentIntent = useCallback(
    async (method: PaymentMethodType) => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiClient.post<{
          clientSecret: string;
          paymentIntentId: string;
        }>("/payments/create-intent", {
          appointmentId,
          paymentMethod: method,
        });

        setClientSecret(response.clientSecret);
        setPaymentInitiated(true);
      } catch (err) {
        console.error("Error creating payment intent:", err);
        setError(
          err instanceof Error ? err.message : "Failed to initialize payment",
        );
      } finally {
        setLoading(false);
      }
    },
    [appointmentId],
  );

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setClientSecret("");
      setPaymentInitiated(false);
      setError(null);
      setSelectedPaymentMethod("card");
    }
  }, [open]);

  // Fetch currency from platform settings
  useEffect(() => {
    const fetchCurrency = async () => {
      try {
        const response = await apiClient.get<{ currency: string }>(
          "/platform/currency",
        );
        setCurrency(response.currency || "CAD");
      } catch (err) {
        console.error("Error fetching currency:", err);
        setCurrency("CAD");
      }
    };

    fetchCurrency();
  }, []);

  const handleContinue = () => {
    createPaymentIntent(selectedPaymentMethod);
  };

  const handleBack = () => {
    setPaymentInitiated(false);
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
          <DialogDescription className="space-y-2">
            <span>{t("session", { name: professionalName })}</span>
            <span className="text-sm">{appointmentDate}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {/* Payment Method Selection */}
          {!paymentInitiated && !loading && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border/40 bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("amountToPay")}
                  </span>
                  <span className="text-2xl font-semibold text-foreground">
                    ${amount.toFixed(2)} {currency}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <Label className="text-base font-medium">
                  {t("selectMethod")}
                </Label>
                <div className="space-y-3">
                  {paymentMethodOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedPaymentMethod(option.id)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left",
                        selectedPaymentMethod === option.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/40 bg-card/50 hover:bg-accent/50",
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-full p-2.5",
                          selectedPaymentMethod === option.id
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
                          selectedPaymentMethod === option.id
                            ? "border-primary"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {selectedPaymentMethod === option.id && (
                          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleContinue}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 rounded-md font-medium transition-colors"
              >
                {t("continue")}
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">
                {t("preparing")}
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">
                    {t("errorTitle")}
                  </p>
                  <p className="text-sm text-red-700 mt-1">{error}</p>
                </div>
              </div>
              <button
                onClick={handleBack}
                className="w-full border border-border hover:bg-accent h-10 px-4 rounded-md font-medium transition-colors"
              >
                {t("goBack")}
              </button>
            </div>
          )}

          {!loading && !error && clientSecret && paymentInitiated && (
            <div className="space-y-4">
              <button
                onClick={handleBack}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                ← {t("changeMethod")}
              </button>
              <Elements
                options={{
                  clientSecret,
                  appearance,
                  locale: stripeLocale,
                }}
                stripe={stripePromise}
              >
                <CheckoutForm
                  amount={amount}
                  clientSecret={clientSecret}
                  onSuccess={handleSuccess}
                  onError={setError}
                  paymentMethod={selectedPaymentMethod}
                  currency={currency}
                />
              </Elements>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
