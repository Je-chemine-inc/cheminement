"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Download,
  Eye,
  Filter,
  Wallet,
  CheckCircle2,
  Clock,
  TrendingUp,
  DollarSign,
  Loader2,
  AlertCircle,
  X,
  ScrollText,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  appointmentsAPI,
  professionalLedgerAPI,
  type ProfessionalLedgerEntryResponse,
} from "@/lib/api-client";
import { getSessionActNatureLabelFr } from "@/lib/receipt-pdf";
import { AppointmentResponse } from "@/types/api";

type ConnectPayoutResponse = {
  setupComplete: boolean;
  balance: { available: number; pending: number };
  accountStatus?: {
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  };
  bankDetails?: {
    institution?: string;
    last4?: string;
    routingNumber?: string;
    currency?: string;
  } | null;
  accountHolder?: string;
};

export default function ProfessionalBillingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"receivables" | "history">(
    "receivables",
  );
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [appointments, setAppointments] = useState<AppointmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] =
    useState<ConnectPayoutResponse | null>(null);
  const [connectLoading, setConnectLoading] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [setupBanner, setSetupBanner] = useState<string | null>(null);
  const [ledgerData, setLedgerData] = useState<{
    entries: ProfessionalLedgerEntryResponse[];
    pendingPayoutCad: number;
    currentCycleKey?: string;
    balanceLifetimeCad?: number;
    balanceCurrentCycleCad?: number;
  } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerShowAll, setLedgerShowAll] = useState(false);
  const t = useTranslations("Professional.billing");

  const fetchConnectStatus = useCallback(async () => {
    try {
      setConnectError(null);
      setConnectLoading(true);
      const res = await fetch("/api/stripe-connect/payout");
      const data = (await res.json()) as ConnectPayoutResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to load payout status",
        );
      }
      setConnectStatus(data);
    } catch (err: unknown) {
      console.error("Connect status error:", err);
      setConnectError(
        err instanceof Error ? err.message : "Failed to load payout status",
      );
      setConnectStatus(null);
    } finally {
      setConnectLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
  }, []);

  useEffect(() => {
    const loadLedger = async () => {
      try {
        setLedgerLoading(true);
        const data = await professionalLedgerAPI.get();
        setLedgerData(data);
      } catch (e) {
        console.error("ledger:", e);
        setLedgerData(null);
      } finally {
        setLedgerLoading(false);
      }
    };
    void loadLedger();
  }, []);

  useEffect(() => {
    fetchConnectStatus();
  }, [fetchConnectStatus]);

  useEffect(() => {
    const setup = searchParams.get("setup");
    if (setup === "success") {
      setSetupBanner(t("setupReturnSuccess"));
      void fetchConnectStatus();
      router.replace("/professional/dashboard/billing", { scroll: false });
      return;
    }
    if (setup === "refresh") {
      setSetupBanner(t("setupRefreshMessage"));
      void fetchConnectStatus();
      router.replace("/professional/dashboard/billing", { scroll: false });
    }
  }, [searchParams, router, fetchConnectStatus, t]);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await appointmentsAPI.list();

      setAppointments(response);
    } catch (err: unknown) {
      console.error("Error fetching appointments:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load appointments",
      );
    } finally {
      setLoading(false);
    }
  };

  const receivablePayments = appointments.filter(
    (apt) => apt.status === "pending" || apt.payment.status === "processing",
  );
  const paidPayments = appointments.filter(
    (apt) =>
      apt.payment.status === "paid" ||
      apt.payment.status === "refunded" ||
      apt.payment.status === "cancelled",
  );

  const totalReceivables = receivablePayments.reduce(
    (sum, p) => sum + p.payment.professionalPayout,
    0,
  );
  const totalReceived = paidPayments.reduce(
    (sum, p) => sum + p.payment.professionalPayout,
    0,
  );
  const monthlyRevenue = paidPayments
    .filter((p) => {
      const date = new Date(p.payment.paidAt || p.date);
      const now = new Date();
      return (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, p) => sum + p.payment.professionalPayout, 0);

  // Pros only need to know if a session is paid or pending — everything else collapses to pending.
  const isPaid = (status: AppointmentResponse["payment"]["status"]) =>
    status === "paid";

  const getStatusColor = (status: AppointmentResponse["payment"]["status"]) =>
    isPaid(status)
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";

  const getStatusIcon = (status: AppointmentResponse["payment"]["status"]) =>
    isPaid(status) ? (
      <CheckCircle2 className="h-4 w-4" />
    ) : (
      <Clock className="h-4 w-4" />
    );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleUpdateBankDetails = async () => {
    setLinkError(null);
    setLinkLoading(true);
    try {
      const res = await fetch("/api/stripe-connect/account-link", {
        method: "POST",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : t("connectLinkError"),
        );
      }
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      throw new Error(t("connectLinkError"));
    } catch (err: unknown) {
      setLinkError(
        err instanceof Error ? err.message : t("connectLinkError"),
      );
    } finally {
      setLinkLoading(false);
    }
  };

  const handleDownloadReceipt = async (appointmentId: string) => {
    try {
      const response = await fetch(
        `/api/payments/receipt?appointmentId=${appointmentId}`,
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to download receipt");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${appointmentId.slice(-8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Error downloading receipt:", err);
      alert(err instanceof Error ? err.message : "Failed to download receipt");
    }
  };

  const displayPayments =
    activeTab === "receivables" ? receivablePayments : paidPayments;

  const hasConnectAccount =
    connectStatus?.accountStatus !== undefined &&
    connectStatus.accountStatus !== null;
  const bank = connectStatus?.bankDetails;
  const holderDisplay =
    connectStatus?.accountHolder?.trim() ||
    session?.user?.name?.trim() ||
    t("notProvided");
  const institutionDisplay = bank?.institution?.trim() || t("notProvided");
  const accountDisplay = bank?.last4
    ? `••••${bank.last4}`
    : t("notProvided");
  const transitDisplay =
    bank?.routingNumber?.trim() || t("notProvided");

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{error}</p>
          <Button onClick={fetchAppointments} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {setupBanner && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
        >
          <p>{setupBanner}</p>
          <button
            type="button"
            onClick={() => setSetupBanner(null)}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background/80 hover:text-foreground"
            aria-label={t("dismissBanner")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-500/10 p-3">
              <Clock className="h-6 w-6 text-yellow-700 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("totalReceivables")}
              </p>
              <p className="text-2xl font-light text-foreground">
                {totalReceivables.toFixed(2)} $
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-green-500/10 p-3">
              <CheckCircle2 className="h-6 w-6 text-green-700 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("totalReceived")}
              </p>
              <p className="text-2xl font-light text-foreground">
                {totalReceived.toFixed(2)} $
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("monthlyRevenue")}
              </p>
              <p className="text-2xl font-light text-foreground">
                {monthlyRevenue.toFixed(2)} $
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-primary/20 bg-primary/5 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("pendingPayoutCardLabel")}
              </p>
              <p className="text-2xl font-light text-primary">
                {ledgerLoading
                  ? "…"
                  : `${(ledgerData?.pendingPayoutCad ?? 0).toFixed(2)} $`}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("pendingPayoutCardSub")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center gap-3">
          <ScrollText className="h-6 w-6 text-primary" />
          <div>
            <h2 className="font-serif text-2xl font-light text-foreground">
              {t("ledgerTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("pendingPayoutSynth")}
            </p>
          </div>
        </div>
        {ledgerLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-border/20 bg-muted/20 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {t("pendingPayoutLabel")}
                </p>
                <p className="text-xl font-light text-foreground">
                  {(ledgerData?.pendingPayoutCad ?? 0).toFixed(2)} $
                </p>
              </div>
              <div className="rounded-2xl border border-border/20 bg-muted/20 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {t("ledgerBalanceCycle")}
                </p>
                <p className="text-xl font-light text-foreground">
                  {(ledgerData?.balanceCurrentCycleCad ?? 0).toFixed(2)} $
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {ledgerData?.currentCycleKey ?? "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-border/20 bg-muted/20 px-4 py-3 sm:col-span-2 lg:col-span-2">
                <p className="text-xs text-muted-foreground">
                  {t("ledgerBalanceLifetime")}
                </p>
                <p className="text-xl font-light text-foreground">
                  {(ledgerData?.balanceLifetimeCad ?? 0).toFixed(2)} $
                </p>
              </div>
            </div>
            {!ledgerData?.entries?.length ? (
              <p className="mt-6 text-sm text-muted-foreground">
                {t("ledgerEmpty")}
              </p>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-muted-foreground">
                      <th className="pb-2 pr-2 font-medium">{t("ledgerDate")}</th>
                      <th className="pb-2 pr-2 font-medium">{t("ledgerKind")}</th>
                      <th className="pb-2 pr-2 font-medium">{t("ledgerAct")}</th>
                      <th className="pb-2 font-medium">{t("earnings")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledgerShowAll
                      ? ledgerData.entries
                      : ledgerData.entries.slice(0, 15)
                    ).map((row) => {
                      const isDebit = row.entryKind === "debit";
                      return (
                        <tr
                          key={row._id}
                          className="border-b border-border/20 last:border-0"
                        >
                          <td className="py-2 pr-2">
                            {formatDate(row.createdAt)}
                          </td>
                          <td className="py-2 pr-2 text-xs">
                            {isDebit ? t("ledgerDebit") : t("ledgerCredit")}
                          </td>
                          <td className="py-2 pr-2 text-xs text-muted-foreground">
                            {row.sessionActNature
                              ? getSessionActNatureLabelFr(row.sessionActNature)
                              : "—"}
                          </td>
                          <td className="py-2">
                            {isDebit
                              ? `− ${(row.payoutAmountCad ?? 0).toFixed(2)} $`
                              : `${row.netToProfessionalCad.toFixed(2)} $`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ledgerData.entries.length > 15 && (
                  <button
                    type="button"
                    onClick={() => setLedgerShowAll((v) => !v)}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    {ledgerShowAll
                      ? t("ledgerShowLess")
                      : t("ledgerShowAll") +
                        ` (${ledgerData.entries.length - 15})`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Bank Details Section */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {t("bankDetails")}
          </h2>
          <Button
            onClick={() => setShowBankDetails(!showBankDetails)}
            variant="outline"
            className="gap-2 rounded-full"
          >
            {showBankDetails ? (
              <Eye className="h-4 w-4" />
            ) : (
              <Filter className="h-4 w-4" />
            )}
            {showBankDetails ? t("hide") : t("show")}
          </Button>
        </div>

        {showBankDetails && (
          <div className="mt-6 space-y-4">
            {!connectError && !connectLoading && (
              <>
                {!hasConnectAccount && (
                  <p className="text-sm text-muted-foreground">
                    {t("noBankOnFile")}
                  </p>
                )}
                {hasConnectAccount && !connectStatus?.setupComplete && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {t("payoutSetupIncomplete")}
                  </p>
                )}
                {hasConnectAccount &&
                  connectStatus?.setupComplete &&
                  !bank?.last4 &&
                  !bank?.institution && (
                    <p className="text-sm text-muted-foreground">
                      {t("noBankOnFile")}
                    </p>
                  )}
              </>
            )}
            <div className="rounded-2xl border border-border/20 bg-card/70 p-5">
              {connectError && (
                <p className="py-4 text-center text-sm text-red-600 dark:text-red-400">
                  {connectError}
                </p>
              )}
              {!connectError && !connectLoading && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("accountHolder")}
                    </p>
                    <p className="font-medium text-foreground">
                      {holderDisplay}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("institution")}
                    </p>
                    <p className="font-medium text-foreground">
                      {institutionDisplay}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("accountNumber")}
                    </p>
                    <p className="font-medium text-foreground">
                      {accountDisplay}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("transitNumber")}
                    </p>
                    <p className="font-medium text-foreground">
                      {transitDisplay}
                    </p>
                  </div>
                </div>
              )}
              {!connectError && connectLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("bankDetailsNote")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("stripeManagedNote")}
            </p>
            {linkError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {linkError}
              </p>
            )}
            <Button
              className="gap-2 rounded-full"
              variant="outline"
              onClick={() => void handleUpdateBankDetails()}
              disabled={linkLoading}
            >
              {linkLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              {linkLoading ? t("openingStripe") : t("updateBankDetails")}
            </Button>
          </div>
        )}
      </section>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border/40">
        <button
          onClick={() => setActiveTab("receivables")}
          className={`rounded-t-lg px-6 py-3 font-medium transition ${
            activeTab === "receivables"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("receivables")} ({receivablePayments.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`rounded-t-lg px-6 py-3 font-medium transition ${
            activeTab === "history"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("paymentHistory")} ({paidPayments.length})
        </button>
      </div>

      {/* Payments List */}
      {displayPayments.length === 0 ? (
        <div className="rounded-3xl border border-border/20 bg-card/80 p-12 text-center shadow-lg">
          <DollarSign className="mx-auto h-16 w-16 text-muted-foreground/50" />
          <h3 className="mt-4 font-serif text-xl text-foreground">
            {activeTab === "receivables"
              ? t("noReceivables")
              : t("noPaymentHistory")}
          </h3>
        </div>
      ) : (
        <div className="space-y-4">
          {displayPayments.map((apt) => (
            <div
              key={apt._id}
              className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg transition hover:shadow-xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-serif text-xl font-light text-foreground">
                        {t("session")} - {apt.clientId.firstName}{" "}
                        {apt.clientId.lastName}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDate(apt.date)}
                      </p>
                    </div>
                    <span
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wider ${getStatusColor(
                        apt.payment.status,
                      )}`}
                    >
                      {getStatusIcon(apt.payment.status)}
                      {isPaid(apt.payment.status)
                        ? t("paymentStatusPaid")
                        : t("paymentStatusPending")}
                    </span>
                  </div>

                  {/* Details Grid */}
                  <div className="grid gap-4 rounded-2xl bg-muted/30 p-4 md:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t("invoiceNumber")}
                      </p>
                      <p className="font-medium text-foreground">{apt._id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t("earnings")}
                      </p>
                      <p className="font-medium text-primary">
                        {apt.payment.professionalPayout.toFixed(2)} $
                      </p>
                    </div>
                    {apt.payment.paidAt && (
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {t("paidDate")}
                        </p>
                        <p className="font-medium text-foreground">
                          {formatDate(apt.payment.paidAt)}
                        </p>
                      </div>
                    )}
                    {apt.status === "cancelled" && apt.cancelReason && (
                      <div className="md:col-span-3">
                        <p className="text-xs text-muted-foreground">
                          {t("cancelReason")}
                        </p>
                        <p className="font-medium text-foreground">
                          {apt.cancelReason}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {apt.payment.status === "paid" && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="gap-2 rounded-full"
                        onClick={() => handleDownloadReceipt(apt._id)}
                      >
                        <Download className="h-4 w-4" />
                        {t("downloadInvoice")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
