"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { AlertCircle, Banknote, CheckCircle2, CreditCard, Loader2, Shield } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLocaleFromQuery } from "@/lib/use-locale-from-query";

/**
 * An organization pays its invoice (spec 002, phase 5). Reached from the link
 * in the invoice and reminder emails; no login. The page knows the
 * organization, the invoice number, the amounts and the due date — never a
 * patient's name.
 */

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface InvoiceView {
  organizationName: string;
  number: string;
  totalCents: number;
  paidCents: number;
  creditedCents: number;
  balanceCents: number;
  dueAt: string | null;
  overdue: boolean;
  state: "awaiting" | "paid" | "closed";
  interacEmail: string | null;
}

function useMoney() {
  const locale = useLocale();
  return (cents: number) =>
    locale === "en"
      ? `$${(cents / 100).toFixed(2)}`
      : `${(cents / 100).toFixed(2).replace(".", ",")} $`;
}

function useDay() {
  const locale = useLocale();
  return (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "fr-CA", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(iso))
      : "—";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-linear-to-br from-background to-muted/20 px-4 py-10">
      <div className="mx-auto max-w-xl space-y-6">{children}</div>
    </div>
  );
}

function Message({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">{icon}</div>
      <h1 className="mb-2 text-2xl font-serif font-light text-foreground">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}

function CardForm({
  amountLabel,
  onPaid,
}: {
  amountLabel: string;
  onPaid: (processing: boolean) => void;
}) {
  const t = useTranslations("OrgPay");
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (stripeError) {
      setError(stripeError.message || t("errorGeneric"));
      setSubmitting(false);
      return;
    }
    if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
      onPaid(paymentIntent.status === "processing");
      return;
    }
    setError(paymentIntent?.status === "requires_action" ? t("additionalVerification") : t("errorGeneric"));
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:bg-red-950/20">
          <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || !elements || submitting}>
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("processing")}
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            {t("payAmount", { amount: amountLabel })}
          </>
        )}
      </Button>
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-4 w-4" />
        {t("cardFootnote")}
      </p>
    </form>
  );
}

function OrgPayContent() {
  useLocaleFromQuery();
  const t = useTranslations("OrgPay");
  const locale = useLocale();
  const money = useMoney();
  const day = useDay();
  const token = useSearchParams().get("token");

  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [done, setDone] = useState<"paid" | "processing" | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    void fetch(`/api/organization-invoices/pay?token=${encodeURIComponent(token)}`)
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok) setInvoice(body as InvoiceView);
        else setLoadError(t("invalidBody"));
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  const startCard = async () => {
    if (!token) return;
    setStarting(true);
    setStartError(null);
    const res = await fetch("/api/organization-invoices/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setStarting(false);
    if (res?.ok && body.clientSecret) setClientSecret(body.clientSecret);
    else setStartError(body.code === "PAYMENT_IN_PROGRESS" ? t("inProgress") : t("errorGeneric"));
  };

  if (!token || loadError) {
    return (
      <Shell>
        <Message
          icon={<AlertCircle className="h-7 w-7 text-red-600" />}
          title={t("invalidTitle")}
          body={loadError ?? t("invalidBody")}
        />
      </Shell>
    );
  }

  if (!invoice) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Message
          icon={<CheckCircle2 className="h-7 w-7 text-green-600" />}
          title={t("successTitle")}
          body={done === "processing" ? t("processingBody") : t("successBody", { org: invoice.organizationName })}
        />
      </Shell>
    );
  }

  if (invoice.state === "paid") {
    return (
      <Shell>
        <Message
          icon={<CheckCircle2 className="h-7 w-7 text-green-600" />}
          title={t("paidTitle")}
          body={t("paidBody", { number: invoice.number })}
        />
      </Shell>
    );
  }

  if (invoice.state === "closed") {
    return (
      <Shell>
        <Message
          icon={<AlertCircle className="h-7 w-7 text-muted-foreground" />}
          title={t("closedTitle")}
          body={t("closedBody", { number: invoice.number })}
        />
      </Shell>
    );
  }

  const balance = money(invoice.balanceCents);

  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-3xl font-serif font-light text-foreground">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{invoice.organizationName}</p>
      </div>

      <div className="space-y-3 rounded-xl border border-border/40 bg-card p-6 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("invoiceNumber")}</span>
          <span className="font-medium">{invoice.number}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t("dueDate")}</span>
          <span className={invoice.overdue ? "font-medium text-red-700" : "font-medium"}>
            {day(invoice.dueAt)}
            {invoice.overdue ? ` · ${t("overdue")}` : ""}
          </span>
        </div>
        {(invoice.paidCents > 0 || invoice.creditedCents > 0) && (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("total")}</span>
              <span>{money(invoice.totalCents)}</span>
            </div>
            {invoice.creditedCents > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("credit")}</span>
                <span>− {money(invoice.creditedCents)}</span>
              </div>
            )}
            {invoice.paidCents > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("paid")}</span>
                <span>{money(invoice.paidCents)}</span>
              </div>
            )}
          </>
        )}
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t("balance")}</span>
          <span className="text-xl font-semibold">{balance}</span>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-border/40 bg-card p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <CreditCard className="h-5 w-5" /> {t("cardTitle")}
        </h2>
        {clientSecret ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: "stripe", variables: { colorPrimary: "#0f172a", borderRadius: "8px" } },
              locale: locale === "en" ? "en-CA" : "fr-CA",
            }}
          >
            <CardForm amountLabel={balance} onPaid={(processing) => setDone(processing ? "processing" : "paid")} />
          </Elements>
        ) : (
          <>
            {startError && (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:bg-red-950/20">
                <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
                <p className="text-sm text-red-800 dark:text-red-200">{startError}</p>
              </div>
            )}
            <Button size="lg" className="w-full" disabled={starting} onClick={() => void startCard()}>
              {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              {starting ? t("preparing") : t("payAmount", { amount: balance })}
            </Button>
          </>
        )}
      </div>

      {invoice.interacEmail && (
        <div className="space-y-2 rounded-xl border border-border/40 bg-card p-6 text-sm">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Banknote className="h-5 w-5" /> {t("interacTitle")}
          </h2>
          <p className="text-muted-foreground">
            {t.rich("interacBody", {
              amount: balance,
              email: invoice.interacEmail,
              number: invoice.number,
              ref: (chunks) => <span className="whitespace-nowrap font-medium text-foreground">{chunks}</span>,
            })}
          </p>
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">{t("otherMethods", { number: invoice.number })}</p>
    </Shell>
  );
}

export default function OrganizationPayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <OrgPayContent />
    </Suspense>
  );
}
