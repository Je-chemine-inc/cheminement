"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  User,
  CreditCard,
  Shield,
  Home,
  Download,
  Landmark,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildReceiptNumber } from "@/lib/receipt-number";
import { useLocale, useTranslations } from "next-intl";
import { GuestPaySetupFlow } from "@/components/payments";
import { useLocaleFromQuery } from "@/lib/use-locale-from-query";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

type PaymentMethodType = "card" | "direct_debit";

interface AppointmentDetails {
  appointmentId: string;
  date: string;
  time: string;
  duration: number;
  type: string;
  therapyType: string;
  price: number;
  guestName: string;
  guestEmail: string;
  professionalName: string;
  alreadyPaid?: boolean;
  paidAt?: string;
  appointmentStatus?: string;
  hasPaymentMethodOnFile?: boolean;
  interacTrustPending?: boolean;
}

type GuestSetupPaymentType = "card" | "acss_debit" | "interac_manual";

interface CheckoutFormProps {
  amount: number;
  onSuccess: () => void;
  onError: (error: string) => void;
  paymentMethod: PaymentMethodType;
}

function CheckoutForm({
  amount,
  onSuccess,
  onError,
  paymentMethod,
}: CheckoutFormProps) {
  const t = useTranslations("Client.guestPay");
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | null>(
    null,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setMessage(null);
    setMessageKind(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setMessage(error.message || t("errorLabel"));
      setMessageKind("error");
      onError(error.message || t("errorLabel"));
      setLoading(false);
    } else if (paymentIntent) {
      if (paymentIntent.status === "succeeded") {
        setMessage(t("paymentSuccessful"));
        setMessageKind("success");
        onSuccess();
      } else if (paymentIntent.status === "processing") {
        setMessage(t("paymentProcessingMessage"));
        setMessageKind("success");
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } else if (paymentIntent.status === "requires_action") {
        setMessage(t("additionalVerification"));
        setMessageKind("error");
        setLoading(false);
      } else {
        setMessage(t("paymentProcessing"));
        setMessageKind("success");
        setLoading(false);
      }
    }
  };

  const getPaymentMethodIcon = () => {
    switch (paymentMethod) {
      case "direct_debit":
        return <Landmark className="h-5 w-5 text-primary" />;
      default:
        return <CreditCard className="h-5 w-5 text-primary" />;
    }
  };

  const getPaymentMethodLabel = () => {
    switch (paymentMethod) {
      case "direct_debit":
        return t("directDebitLabel");
      default:
        return t("cardPaymentLabel");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            {t("amountToPayLabel")}
          </span>
          <span className="text-2xl font-semibold text-foreground">
            ${amount.toFixed(2)} CAD
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {getPaymentMethodIcon()}
          <span>{getPaymentMethodLabel()}</span>
        </div>
      </div>

      {paymentMethod === "direct_debit" && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-800 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Landmark className="h-5 w-5 text-purple-600 dark:text-purple-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                {t("padDisclaimerTitle")}
              </p>
              <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                {t("padDisclaimerBody")}
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

      {message && messageKind === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 mt-0.5 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-800 dark:text-red-200">{message}</p>
        </div>
      )}

      {message && messageKind === "success" && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 mt-0.5 text-green-600 dark:text-green-400" />
          <p className="text-sm text-green-800 dark:text-green-200">
            {message}
          </p>
        </div>
      )}

      <Button
        type="submit"
        disabled={!stripe || !elements || loading}
        className="w-full"
        size="lg"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("paymentProcessing")}
          </>
        ) : paymentMethod === "direct_debit" ? (
          <>
            <Landmark className="mr-2 h-4 w-4" />
            {t("linkBankConfirm")} — ${amount.toFixed(2)} CAD
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            {t("payNowAmount", { amount: `$${amount.toFixed(2)} CAD` })}
          </>
        )}
      </Button>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-4 w-4" />
        <span>
          {paymentMethod === "direct_debit"
            ? t("padAuthorizeFootnote")
            : t("cardOptionDescription")}
        </span>
      </div>
    </form>
  );
}

function GuestPaymentContent() {
  // Apply the email deep-link's &lang= to the cookie-based locale (may reload
  // once so the page renders in the recipient's language).
  useLocaleFromQuery();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const t = useTranslations("Client.guestPay");
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
      label: t("cardOptionLabel"),
      description: t("cardOptionDescription"),
      icon: <CreditCard className="h-5 w-5" />,
    },
    {
      id: "direct_debit",
      label: t("padOptionLabel"),
      description: t("padOptionDescription"),
      icon: <Landmark className="h-5 w-5" />,
    },
  ];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentDetails | null>(
    null,
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethodType>("card");
  const [paymentMethodSelected, setPaymentMethodSelected] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [guestSetupType, setGuestSetupType] =
    useState<GuestSetupPaymentType>("card");
  const [guestSetupSecret, setGuestSetupSecret] = useState<string | null>(null);
  const [guestSetupStarted, setGuestSetupStarted] = useState(false);
  const [creatingGuestSetup, setCreatingGuestSetup] = useState(false);
  const [methodSetupSuccess, setMethodSetupSuccess] = useState(false);
  const [interacRequestSent, setInteracRequestSent] = useState(false);

  const fetchAppointment = useCallback(async () => {
    if (!token) {
      setError(t("invalidLink"));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/payments/guest?token=${token}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("loadFailed"));
      }

      setAppointment(data);

      // Check if already paid
      if (data.alreadyPaid) {
        setAlreadyPaid(true);
      }
    } catch (err) {
      console.error("Error fetching appointment:", err);
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    fetchAppointment();
  }, [fetchAppointment]);

  const createPaymentIntent = async (method: PaymentMethodType) => {
    if (!token) return;

    try {
      setCreatingIntent(true);
      setError(null);

      const intentResponse = await fetch("/api/payments/guest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, paymentMethod: method }),
      });

      const intentData = await intentResponse.json();

      if (!intentResponse.ok) {
        throw new Error(intentData.error || t("intentInitFailed"));
      }

      setClientSecret(intentData.clientSecret);
      setPaymentMethodSelected(true);
    } catch (err) {
      console.error("Error creating payment intent:", err);
      setError(err instanceof Error ? err.message : t("intentInitFailed"));
    } finally {
      setCreatingIntent(false);
    }
  };

  const handleContinueToPayment = () => {
    createPaymentIntent(selectedPaymentMethod);
  };

  const handleBackToMethodSelection = () => {
    setPaymentMethodSelected(false);
    setClientSecret(null);
    setError(null);
  };

  const handlePaymentSuccess = () => {
    setPaymentSuccess(true);
  };

  const createGuestSetupIntent = async () => {
    if (!token) return;
    try {
      setCreatingGuestSetup(true);
      setError(null);
      const res = await fetch("/api/payments/guest-appointment-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          paymentMethodType: guestSetupType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("setupInitFailed"));
      }
      setGuestSetupSecret(data.clientSecret);
      setGuestSetupStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("setupInitFailed"));
    } finally {
      setCreatingGuestSetup(false);
    }
  };

  const handleGuestSetupContinue = async () => {
    if (!token || !appointment) return;
    if (guestSetupType === "interac_manual") {
      setCreatingGuestSetup(true);
      setError(null);
      try {
        const res = await fetch("/api/payments/request-transfer-guarantee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            appointmentId: appointment.appointmentId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || t("setupInitFailed"));
        }
        setInteracRequestSent(true);
        setMethodSetupSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("setupInitFailed"));
      } finally {
        setCreatingGuestSetup(false);
      }
      return;
    }
    createGuestSetupIntent();
  };

  const handleGuestSetupSuccess = () => {
    setInteracRequestSent(false);
    setMethodSetupSuccess(true);
    setGuestSetupStarted(false);
    setGuestSetupSecret(null);
    if (appointment) {
      setAppointment({
        ...appointment,
        hasPaymentMethodOnFile: true,
      });
    }
  };

  const handlePaymentError = (errorMessage: string) => {
    setError(errorMessage);
  };

  const handleDownloadReceipt = async () => {
    if (!appointment) return;

    try {
      setDownloadingReceipt(true);
      const response = await fetch(
        `/api/payments/receipt?appointmentId=${appointment.appointmentId}`,
      );

      if (!response.ok) {
        throw new Error(t("receiptDownloadFailed"));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${buildReceiptNumber(appointment.appointmentId)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Error downloading receipt:", err);
      setError(t("receiptDownloadFailed"));
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const appearance = {
    theme: "stripe" as const,
    variables: {
      colorPrimary: "#0f172a",
      borderRadius: "8px",
    },
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">{t("loadingPaymentDetails")}</p>
        </div>
      </div>
    );
  }

  if (alreadyPaid && appointment) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {t("alreadyPaidTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">{t("alreadyPaidBody")}</p>

          <div className="bg-muted/30 rounded-lg p-4 mb-6 text-left">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">{t("professionalLabel")}</p>
                  <p className="font-medium text-foreground">
                    {appointment.professionalName}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">{t("dateTimeLabel")}</p>
                  <p className="font-medium text-foreground">
                    {formatDate(appointment.date)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {appointment.time}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {t("amountPaid")}
                </span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  ${appointment.price.toFixed(2)} CAD
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Button
              onClick={handleDownloadReceipt}
              disabled={downloadingReceipt}
              className="w-full"
            >
              {downloadingReceipt ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("downloading")}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t("downloadReceiptBtn")}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="w-full"
            >
              <Home className="mr-2 h-4 w-4" />
              {t("returnHome")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (error && !appointment) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {t("paymentErrorTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("returnHome")}
          </Button>
        </div>
      </div>
    );
  }

  if (methodSetupSuccess && appointment) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              interacRequestSent
                ? "bg-amber-100 dark:bg-amber-950/30"
                : "bg-green-100 dark:bg-green-900/30"
            }`}
          >
            <CheckCircle2
              className={`h-8 w-8 ${
                interacRequestSent
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            />
          </div>
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {interacRequestSent
              ? t("interacRequestSentTitle")
              : t("setupSuccessTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">
            {interacRequestSent
              ? t("interacRequestSentBody")
              : t("setupSuccessBody")}
          </p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("backHome")}
          </Button>
        </div>
      </div>
    );
  }

  if (appointment?.appointmentStatus === "pending" && !alreadyPaid) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {t("pendingTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">{t("pendingBody")}</p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("backHome")}
          </Button>
        </div>
      </div>
    );
  }

  if (
    appointment &&
    appointment.appointmentStatus === "scheduled" &&
    appointment.interacTrustPending &&
    !alreadyPaid
  ) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <Clock className="h-12 w-12 text-sky-600 mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {t("interacPendingTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">{t("interacPendingBody")}</p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("backHome")}
          </Button>
        </div>
      </div>
    );
  }

  if (
    appointment &&
    appointment.appointmentStatus === "scheduled" &&
    appointment.hasPaymentMethodOnFile &&
    !alreadyPaid
  ) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {t("scheduledReadyTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">{t("scheduledReadyBody")}</p>
          <p className="text-xs text-muted-foreground mb-6">{t("interacNote")}</p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("backHome")}
          </Button>
        </div>
      </div>
    );
  }

  if (
    appointment &&
    appointment.appointmentStatus === "scheduled" &&
    !appointment.hasPaymentMethodOnFile
  ) {
    const guestSetupOptions: {
      id: GuestSetupPaymentType;
      label: string;
      description: string;
      icon: React.ReactNode;
    }[] = [
      {
        id: "card",
        label: t("cardOptionLabel"),
        description: t("cardOptionDescription"),
        icon: <CreditCard className="h-5 w-5" />,
      },
      {
        id: "acss_debit",
        label: t("padOptionLabel"),
        description: t("padOptionDescription"),
        icon: <Landmark className="h-5 w-5" />,
      },
      {
        id: "interac_manual",
        label: t("interacOptionLabel"),
        description: t("interacOptionDescription"),
        icon: <Banknote className="h-5 w-5" />,
      },
    ];

    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-serif font-light text-foreground mb-2">
              {t("setupTitle")}
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto">
              {t("setupSubtitle")}
            </p>
          </div>

          {appointment && (
            <div className="rounded-xl bg-card border border-border/40 p-6 mb-6">
              <h2 className="text-lg font-medium text-foreground mb-4">
                {t("appointmentDetails")}
              </h2>
              <div className="space-y-3 text-left text-sm">
                <p>
                  <span className="text-muted-foreground">{t("professionalLabel")}: </span>
                  <span className="font-medium">{appointment.professionalName}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">{t("whenLabel")}: </span>
                  <span className="font-medium">
                    {formatDate(appointment.date)} {appointment.time}
                  </span>
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-card border border-border/40 p-6">
            {!guestSetupStarted ? (
              <div className="space-y-4">
                <h2 className="text-lg font-medium text-foreground mb-4">
                  {t("selectMethod")}
                </h2>
                <div className="space-y-3">
                  {guestSetupOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setGuestSetupType(option.id)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left",
                        guestSetupType === option.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/40 bg-card/50 hover:bg-accent/50",
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-full p-2.5",
                          guestSetupType === option.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {option.icon}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{option.label}</p>
                        <p className="text-sm text-muted-foreground">
                          {option.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex gap-3">
                    <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
                    <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                  </div>
                )}
                <Button
                  className="w-full"
                  size="lg"
                  disabled={creatingGuestSetup}
                  onClick={() => void handleGuestSetupContinue()}
                >
                  {creatingGuestSetup ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("preparingSetup")}
                    </>
                  ) : (
                    t("continueSecure")
                  )}
                </Button>
              </div>
            ) : (
              guestSetupSecret &&
              token &&
              (guestSetupType === "card" ||
                guestSetupType === "acss_debit") && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => {
                      setGuestSetupStarted(false);
                      setGuestSetupSecret(null);
                      setError(null);
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    ← {t("changeMethodLink")}
                  </button>
                  <GuestPaySetupFlow
                    token={token}
                    clientSecret={guestSetupSecret}
                    paymentMethodType={guestSetupType}
                    onSuccess={handleGuestSetupSuccess}
                    onError={(msg) => setError(msg)}
                  />
                </div>
              )
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center mt-6">
            {t("interacNote")}
          </p>
        </div>
      </div>
    );
  }

  if (
    appointment &&
    appointment.appointmentStatus &&
    appointment.appointmentStatus !== "completed" &&
    !alreadyPaid
  ) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-serif font-light text-foreground mb-2">
            {t("notAvailableTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">{t("notAvailableBody")}</p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("backHome")}
          </Button>
        </div>
      </div>
    );
  }

  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-card border border-border/40 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-serif font-light text-foreground mb-2">
            {selectedPaymentMethod === "direct_debit"
              ? t("padSetupTitle")
              : t("paymentSuccessTitle")}
          </h1>
          <p className="text-muted-foreground mb-6">
            {selectedPaymentMethod === "direct_debit"
              ? t("padSetupBody")
              : t("paymentSuccessBody")}
          </p>

          {appointment && (
            <div className="bg-muted/30 rounded-lg p-4 mb-6 text-left">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("professionalLabel")}
                    </p>
                    <p className="font-medium text-foreground">
                      {appointment.professionalName}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">{t("dateTimeLabel")}</p>
                    <p className="font-medium text-foreground">
                      {formatDate(appointment.date)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {appointment.time}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Button variant="outline" onClick={() => router.push("/")}>
            <Home className="mr-2 h-4 w-4" />
            {t("returnHome")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-background to-muted/20 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-serif font-light text-foreground mb-2">
            {t("payAfterSessionTitle")}
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {t("payAfterSessionSubtitle")}
          </p>
        </div>

        <div className="grid gap-6">
          {/* Appointment Details */}
          {appointment && (
            <div className="rounded-xl bg-card border border-border/40 p-6">
              <h2 className="text-lg font-medium text-foreground mb-4">
                {t("appointmentDetails")}
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("professionalLabel")}
                    </p>
                    <p className="font-medium text-foreground">
                      {appointment.professionalName}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">{t("dateLabel")}</p>
                    <p className="font-medium text-foreground">
                      {formatDate(appointment.date)}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">{t("timeLabel")}</p>
                    <p className="font-medium text-foreground">
                      {appointment.time} ({t("durationMinutes", { duration: appointment.duration })})
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between items-center pt-2">
                  <span className="text-muted-foreground">{t("totalAmountLabel")}</span>
                  <span className="text-xl font-semibold text-foreground">
                    ${appointment.price.toFixed(2)} CAD
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Payment Method Selection or Payment Form */}
          <div className="rounded-xl bg-card border border-border/40 p-6">
            {!paymentMethodSelected ? (
              <>
                <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                  {t("selectMethod")}
                </h2>

                <div className="space-y-4">
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

                  {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 mt-0.5 text-red-600 dark:text-red-400" />
                      <p className="text-sm text-red-800 dark:text-red-200">
                        {error}
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handleContinueToPayment}
                    disabled={creatingIntent}
                    className="w-full"
                    size="lg"
                  >
                    {creatingIntent ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("preparingShort")}
                      </>
                    ) : (
                      t("continueToPaymentBtn")
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
                    {selectedPaymentMethod === "card" && (
                      <CreditCard className="h-5 w-5" />
                    )}
                    {selectedPaymentMethod === "direct_debit" && (
                      <Landmark className="h-5 w-5" />
                    )}
                    {t("paymentInformationTitle")}
                  </h2>
                  <button
                    onClick={handleBackToMethodSelection}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← {t("changeMethodLink")}
                  </button>
                </div>

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3 mb-4">
                    <AlertCircle className="h-5 w-5 mt-0.5 text-red-600 dark:text-red-400" />
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {error}
                    </p>
                  </div>
                )}

                {clientSecret && appointment && (
                  <Elements
                    options={{
                      clientSecret,
                      appearance,
                      locale: stripeLocale,
                    }}
                    stripe={stripePromise}
                  >
                    <CheckoutForm
                      amount={appointment.price}
                      onSuccess={handlePaymentSuccess}
                      onError={handlePaymentError}
                      paymentMethod={selectedPaymentMethod}
                    />
                  </Elements>
                )}
              </>
            )}
          </div>

          {/* Info */}
          <p className="text-xs text-muted-foreground text-center">
            {t("encryptedFootnote")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GuestPaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <GuestPaymentContent />
    </Suspense>
  );
}
