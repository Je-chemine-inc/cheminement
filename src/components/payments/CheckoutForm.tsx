"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Plus,
  Building2,
  Landmark,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface PaymentMethod {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

interface CheckoutFormProps {
  amount: number;
  clientSecret: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  paymentMethod?: "card" | "transfer" | "direct_debit";
  currency?: string;
}

export default function CheckoutForm({
  amount,
  clientSecret,
  onSuccess,
  onError,
  paymentMethod = "card",
  currency = "CAD",
}: CheckoutFormProps) {
  const t = useTranslations("CheckoutForm");
  const locale = useLocale();
  const stripe = useStripe();
  const elements = useElements();

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Track the message tone explicitly instead of string-matching the (now
  // localized) message text — otherwise success vs error styling would break.
  const [messageType, setMessageType] = useState<"success" | "error" | null>(
    null,
  );
  const [isComplete, setIsComplete] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<string>("new");
  const [showPaymentElement, setShowPaymentElement] = useState(true);

  const notify = (text: string, type: "success" | "error") => {
    setMessage(text);
    setMessageType(type);
  };

  // Simple inline radio component
  const RadioButton = ({
    id,
    value,
    checked,
    onChange,
    children,
  }: {
    id: string;
    value: string;
    checked: boolean;
    onChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <div className="flex items-center space-x-3">
      <input
        type="radio"
        id={id}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className={cn(
          "h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "appearance-none relative cursor-pointer",
          "before:absolute before:inset-0 before:rounded-full before:transition-all before:m-0.5",
          checked && "before:bg-primary",
        )}
      />
      <Label
        htmlFor={id}
        className="flex items-center gap-3 flex-1 cursor-pointer rounded-lg border border-border/40 bg-card/50 p-4 hover:bg-accent/50 transition-colors"
      >
        {children}
      </Label>
    </div>
  );

  useEffect(() => {
    // Only fetch payment methods for card payments
    if (paymentMethod === "card") {
      fetchPaymentMethods();
    } else {
      setLoadingMethods(false);
      setShowPaymentElement(true);
    }
  }, [paymentMethod]);

  useEffect(() => {
    if (!stripe) {
      return;
    }

    // Check initial payment intent status
    const clientSecretParam = new URLSearchParams(window.location.search).get(
      "payment_intent_client_secret",
    );

    if (!clientSecretParam) {
      return;
    }

    stripe
      .retrievePaymentIntent(clientSecretParam)
      .then(({ paymentIntent }) => {
        switch (paymentIntent?.status) {
          case "succeeded":
            notify(t("msgSucceeded"), "success");
            setIsComplete(true);
            onSuccess?.();
            break;
          case "processing":
            notify(t("msgProcessing"), "success");
            break;
          case "requires_payment_method":
            notify(t("msgProvideDetails"), "error");
            break;
          default:
            notify(t("msgSomethingWrong"), "error");
            break;
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe, onSuccess]);

  const fetchPaymentMethods = async () => {
    try {
      setLoadingMethods(true);
      const data = await apiClient.get<{ paymentMethods: PaymentMethod[] }>(
        "/payments/payment-methods",
      );
      setPaymentMethods(data.paymentMethods || []);

      // If there are saved methods, default to the first one
      if (data.paymentMethods && data.paymentMethods.length > 0) {
        setSelectedMethod(data.paymentMethods[0].id);
        setShowPaymentElement(false);
      }
    } catch (err) {
      console.error("Error fetching payment methods:", err);
    } finally {
      setLoadingMethods(false);
    }
  };

  const handleMethodChange = (value: string) => {
    setSelectedMethod(value);
    setShowPaymentElement(value === "new");
    setMessage(null);
    setMessageType(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setMessage(null);
    setMessageType(null);

    try {
      // For card payments with saved payment method
      if (
        paymentMethod === "card" &&
        selectedMethod !== "new" &&
        selectedMethod
      ) {
        const { error, paymentIntent } = await stripe.confirmCardPayment(
          clientSecret,
          {
            payment_method: selectedMethod,
          },
        );

        if (error) {
          if (
            error.type === "card_error" ||
            error.type === "validation_error"
          ) {
            notify(error.message || t("msgErrorOccurred"), "error");
          } else {
            notify(t("msgUnexpected"), "error");
          }
          onError?.(error.message || t("msgPaymentFailed"));
        } else if (paymentIntent && paymentIntent.status === "succeeded") {
          notify(t("msgSucceeded"), "success");
          setIsComplete(true);
          setTimeout(() => {
            onSuccess?.();
          }, 1500);
        }
      } else {
        // For new payment methods (card, transfer, or direct debit)
        if (!elements) {
          notify(t("msgFormNotReady"), "error");
          setLoading(false);
          return;
        }

        const { error, paymentIntent } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/client/dashboard/appointments?payment_success=true`,
          },
          redirect: "if_required",
        });

        if (error) {
          if (
            error.type === "card_error" ||
            error.type === "validation_error"
          ) {
            notify(error.message || t("msgErrorOccurred"), "error");
          } else {
            notify(t("msgUnexpected"), "error");
          }
          onError?.(error.message || t("msgPaymentFailed"));
        } else if (paymentIntent) {
          if (paymentIntent.status === "succeeded") {
            notify(t("msgSucceeded"), "success");
            setIsComplete(true);
            setTimeout(() => {
              onSuccess?.();
            }, 1500);
          } else if (paymentIntent.status === "processing") {
            notify(t("msgBeingProcessed"), "success");
            setIsComplete(true);
            setTimeout(() => {
              onSuccess?.();
            }, 2000);
          } else if (paymentIntent.status === "requires_action") {
            // Handle any additional action required (like 3D Secure)
            notify(t("msgRequiresAction"), "error");
          }
        }
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("msgPaymentFailed");
      notify(errorMessage, "error");
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (isComplete) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-medium text-foreground mb-2">
          {paymentMethod === "transfer"
            ? t("transferSentTitle")
            : paymentMethod === "direct_debit"
              ? t("padSetupTitle")
              : t("paymentSuccessTitle")}
        </h3>
        <p className="text-muted-foreground">
          {paymentMethod === "transfer"
            ? t("transferSentDesc")
            : paymentMethod === "direct_debit"
              ? t("padSetupDesc")
              : t("paymentSuccessDesc")}
        </p>
      </div>
    );
  }

  const getPaymentMethodIcon = () => {
    switch (paymentMethod) {
      case "transfer":
        return <Building2 className="h-5 w-5 text-primary" />;
      case "direct_debit":
        return <Landmark className="h-5 w-5 text-primary" />;
      default:
        return <CreditCard className="h-5 w-5 text-primary" />;
    }
  };

  const getPaymentMethodLabel = () => {
    switch (paymentMethod) {
      case "transfer":
        return t("methodTransfer");
      case "direct_debit":
        return t("methodPad");
      default:
        return t("methodCard");
    }
  };

  // Locale-aware currency (e.g. "120,00 $" in fr-CA, "$120.00" in en-CA) instead
  // of a hardcoded "$120.00 CAD" with a period decimal.
  const priceLabel = new Intl.NumberFormat(
    locale === "fr" ? "fr-CA" : "en-CA",
    { style: "currency", currency },
  ).format(amount);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            {t("amountToPay")}
          </span>
          <span className="text-2xl font-semibold text-foreground">
            {priceLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {getPaymentMethodIcon()}
          <span>{getPaymentMethodLabel()}</span>
        </div>
      </div>

      {/* Payment Method Instructions */}
      {paymentMethod === "transfer" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                {t("transferInstrTitle")}
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                {t("transferInstrDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {paymentMethod === "direct_debit" && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-800 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Landmark className="h-5 w-5 text-purple-600 dark:text-purple-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                {t("padTitle")}
              </p>
              <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                {t("padDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Card Payment Method Selection - Only for card payments */}
      {paymentMethod === "card" && (
        <>
          {loadingMethods ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : paymentMethods.length > 0 ? (
            <div className="space-y-4">
              <Label className="text-base font-medium">{t("selectCard")}</Label>
              <div className="space-y-3">
                {/* Saved Payment Methods */}
                {paymentMethods.map((method) => (
                  <RadioButton
                    key={method.id}
                    id={method.id}
                    value={method.id}
                    checked={selectedMethod === method.id}
                    onChange={handleMethodChange}
                  >
                    <div className="rounded-full bg-primary/10 p-2">
                      <CreditCard className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      {method.card && (
                        <>
                          <p className="font-medium text-foreground capitalize">
                            {method.card.brand} ••••{method.card.last4}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t("expires", {
                              date: `${method.card.expMonth}/${method.card.expYear}`,
                            })}
                          </p>
                        </>
                      )}
                    </div>
                  </RadioButton>
                ))}

                {/* Add New Payment Method Option */}
                <RadioButton
                  id="new"
                  value="new"
                  checked={selectedMethod === "new"}
                  onChange={handleMethodChange}
                >
                  <div className="rounded-full bg-primary/10 p-2">
                    <Plus className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {t("useDifferentCard")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("enterNewDetails")}
                    </p>
                  </div>
                </RadioButton>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Show PaymentElement for new cards or other payment methods */}
      {showPaymentElement && (
        <div className="space-y-4">
          <PaymentElement
            options={{
              layout: "tabs",
            }}
          />
        </div>
      )}

      {message && (
        <div
          className={`rounded-lg border p-4 flex items-start gap-3 ${
            messageType === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200"
          }`}
        >
          {messageType === "success" ? (
            <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          )}
          <p className="text-sm">{message}</p>
        </div>
      )}

      <Button
        type="submit"
        disabled={
          !stripe ||
          loading ||
          (paymentMethod === "card" && selectedMethod === "new" && !elements)
        }
        className="w-full"
        size="lg"
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading
          ? t("processing")
          : paymentMethod === "transfer"
            ? t("getTransferInstructions", { price: priceLabel })
            : paymentMethod === "direct_debit"
              ? t("authorizeDebit", { price: priceLabel })
              : t("pay", { price: priceLabel })}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {paymentMethod === "transfer"
          ? t("secureTransfer")
          : paymentMethod === "direct_debit"
            ? t("securePad")
            : t("secureCard")}
      </p>
    </form>
  );
}
