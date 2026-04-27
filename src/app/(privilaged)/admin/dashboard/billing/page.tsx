"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Download,
  Wallet,
  CheckCircle2,
  Clock,
  TrendingUp,
  Search,
  Users,
  AlertCircle,
  RefreshCw,
  Send,
  CreditCard,
  ArrowRightLeft,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type PaymentStatus = "paid" | "pending" | "upcoming" | "processing" | "overdue";
type PaymentMethod = "all" | "card" | "transfer";

interface Payment {
  id: string;
  sessionId: string;
  client: string;
  professional: string;
  date: string;
  sessionDate: string;
  amount: number;
  platformFee: number;
  professionalPayout: number;
  status: PaymentStatus;
  paymentMethod?: string;
  invoiceUrl?: string;
  paidDate?: string;
  interacReferenceCode?: string;
  transferDueAt?: string;
  interacReminder24hSent?: boolean;
  interacReminder48hSent?: boolean;
}

interface BillingData {
  payments: Payment[];
  summary: {
    totalRevenue: number;
    pendingRevenue: number;
    professionalPayouts: number;
    totalTransactions: number;
    overdueCount: number;
    interacPendingCount: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function AdminBillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendFeedback, setResendFeedback] = useState<Record<string, "ok" | "error">>({});
  const t = useTranslations("Admin.billing");

  const fetchBillingData = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "20",
          search,
          status: statusFilter,
          paymentMethod: methodFilter,
        });
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        const response = await fetch(`/api/admin/billing?${params}`);
        if (!response.ok) throw new Error("Failed to fetch billing data");
        const result = await response.json();
        setData(result);
        setCurrentPage(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, methodFilter, dateFrom, dateTo],
  );

  useEffect(() => {
    fetchBillingData(1);
  }, [fetchBillingData]);

  const payments = data?.payments || [];
  const stats = data?.summary || {
    totalRevenue: 0,
    pendingRevenue: 0,
    professionalPayouts: 0,
    totalTransactions: 0,
    overdueCount: 0,
    interacPendingCount: 0,
  };

  const getStatusColor = (status: PaymentStatus) => {
    switch (status) {
      case "paid":
        return "bg-green-500/15 text-green-700 dark:text-green-400";
      case "pending":
        return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
      case "upcoming":
        return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
      case "processing":
        return "bg-purple-500/15 text-purple-700 dark:text-purple-400";
      case "overdue":
        return "bg-red-500/15 text-red-700 dark:text-red-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusIcon = (status: PaymentStatus) => {
    switch (status) {
      case "paid":
        return <CheckCircle2 className="h-4 w-4" />;
      case "overdue":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const handleDownloadReceipt = async (appointmentId: string) => {
    try {
      const response = await fetch(
        `/api/payments/receipt?appointmentId=${appointmentId}`,
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to download receipt");
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
    }
  };

  const handleResend = async (paymentId: string) => {
    setResendingId(paymentId);
    try {
      const res = await fetch(
        `/api/admin/appointments/${paymentId}/resend-payment`,
        { method: "POST" },
      );
      setResendFeedback((prev) => ({
        ...prev,
        [paymentId]: res.ok ? "ok" : "error",
      }));
      setTimeout(
        () =>
          setResendFeedback((prev) => {
            const next = { ...prev };
            delete next[paymentId];
            return next;
          }),
        4000,
      );
    } catch {
      setResendFeedback((prev) => ({ ...prev, [paymentId]: "error" }));
    } finally {
      setResendingId(null);
    }
  };

  const exportBillingReport = () => {
    if (!data) return;
    const { payments, summary } = data;
    let csv = "Rapport de facturation\n";
    csv += `Généré le : ${new Date().toLocaleDateString("fr-CA")}\n\n`;
    csv += "Résumé\nMétrique,Valeur\n";
    csv += `Revenus totaux,$${summary.totalRevenue.toFixed(2)}\n`;
    csv += `Revenus en attente,$${summary.pendingRevenue.toFixed(2)}\n`;
    csv += `Versements professionnels,$${summary.professionalPayouts.toFixed(2)}\n`;
    csv += `Total transactions,${summary.totalTransactions}\n`;
    csv += `En retard,${summary.overdueCount}\n`;
    csv += `Interac en attente,${summary.interacPendingCount}\n\n`;
    csv += "Transactions\nID,Client,Professionnel,Date séance,Montant,Frais plateforme,Versement pro,Statut,Mode paiement,Date paiement\n";
    payments.forEach((p) => {
      csv += `${p.sessionId},"${p.client}","${p.professional}",${p.sessionDate},${p.amount.toFixed(2)},${p.platformFee.toFixed(2)},${p.professionalPayout.toFixed(2)},${p.status},${p.paymentMethod || ""},${p.paidDate || ""}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `facturation-${new Date().toISOString().split("T")[0]}.csv`;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
              <div className="animate-pulse">
                <div className="h-4 bg-muted rounded w-24 mb-2"></div>
                <div className="h-8 bg-muted rounded w-16"></div>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-3xl border border-border/20 bg-card/60 p-6 shadow-inner">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded w-full max-w-md"></div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="rounded-3xl border border-border/20 bg-card/80 p-12 shadow-lg">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-light text-foreground mb-2">{t("failedLoad")}</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <button
              onClick={() => fetchBillingData(1)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              {t("tryAgain")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchBillingData(currentPage)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
          <Button className="gap-2 rounded-full" onClick={exportBillingReport}>
            <Download className="h-4 w-4" />
            {t("exportReport")}
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("platformRevenue")}</p>
              <p className="text-2xl font-light text-foreground">{stats.totalRevenue.toFixed(2)} $</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-500/10 p-3">
              <Clock className="h-6 w-6 text-yellow-700 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("pendingRevenue")}</p>
              <p className="text-2xl font-light text-foreground">{stats.pendingRevenue.toFixed(2)} $</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-green-500/10 p-3">
              <Users className="h-6 w-6 text-green-700 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("professionalPayouts")}</p>
              <p className="text-2xl font-light text-foreground">{stats.professionalPayouts.toFixed(2)} $</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-red-500/10 p-3">
              <AlertCircle className="h-6 w-6 text-red-700 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("overdue")}</p>
              <p className="text-2xl font-light text-foreground">{stats.overdueCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-orange-500/10 p-3">
              <ArrowRightLeft className="h-6 w-6 text-orange-700 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("interacPending")}</p>
              <p className="text-2xl font-light text-foreground">{stats.interacPendingCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Suivi quotidien ── */}
      <section className="space-y-4 rounded-3xl border border-border/20 bg-card/60 p-6 shadow-inner">
        <div>
          <h2 className="font-serif text-xl font-light text-foreground">{t("dailyTracking")}</h2>
          <p className="text-sm text-muted-foreground">{t("dailyTrackingDesc")}</p>
        </div>

        {/* Search + date range */}
        <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
          <div className="relative flex items-center">
            <Search className="absolute left-4 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-full border border-border/40 bg-card/80 py-3 pl-11 pr-4 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">{t("dateFrom")}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-border/40 bg-card/80 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">{t("dateTo")}</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-border/40 bg-card/80 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          {(["all", "paid", "pending", "upcoming", "processing", "overdue"] as const).map(
            (s) => {
              const isActive = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-lg"
                      : "border-border/40 bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {s !== "all" && getStatusIcon(s as PaymentStatus)}
                  {t(`filters.${s}`)}
                </button>
              );
            },
          )}
        </div>

        {/* Payment method filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("filterMethod")}</span>
          {(["all", "card", "transfer"] as const).map((m) => {
            const isActive = methodFilter === m;
            return (
              <button
                key={m}
                onClick={() => setMethodFilter(m)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-lg"
                    : "border-border/40 bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {m === "card" && <CreditCard className="h-4 w-4" />}
                {m === "transfer" && <ArrowRightLeft className="h-4 w-4" />}
                {m === "all" ? t("allMethods") : m === "card" ? t("methodCard") : t("methodInterac")}
              </button>
            );
          })}
        </div>
      </section>

      {/* Payments List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-light text-foreground">{t("allTransactions")}</h2>
          <span className="text-sm text-muted-foreground">
            {payments.length}{" "}
            {payments.length > 1 ? t("transactionsPlural") : t("transactions")}
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="rounded-3xl border border-border/20 bg-card/80 p-12 text-center shadow-lg">
            <Wallet className="mx-auto h-16 w-16 text-muted-foreground/50" />
            <h3 className="mt-4 font-serif text-xl text-foreground">{t("noTransactions")}</h3>
          </div>
        ) : (
          <div className="space-y-4">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className={`rounded-3xl border bg-card/80 p-6 shadow-lg transition hover:shadow-xl ${
                  payment.status === "overdue"
                    ? "border-red-500/40"
                    : "border-border/20"
                }`}
              >
                {/* Overdue banner */}
                {payment.status === "overdue" && (
                  <div className="mb-4 flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {t("overdueAlert")}
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-serif text-xl font-light text-foreground">
                          {payment.client} → {payment.professional}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {payment.sessionDate !== "N/A" ? formatDate(payment.date) : "—"}
                        </p>
                      </div>
                      <span
                        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wider ${getStatusColor(payment.status)}`}
                      >
                        {getStatusIcon(payment.status)}
                        {t(`status.${payment.status}`)}
                      </span>
                    </div>

                    {/* Details Grid */}
                    <div className="grid gap-4 rounded-2xl bg-muted/30 p-4 md:grid-cols-5">
                      <div>
                        <p className="text-xs text-muted-foreground">{t("invoiceNumber")}</p>
                        <p className="font-medium text-foreground">{payment.sessionId}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("clientPayment")}</p>
                        <p className="font-medium text-foreground">{payment.amount.toFixed(2)} $</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("platformFee")}</p>
                        <p className="font-medium text-primary">{payment.platformFee.toFixed(2)} $</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("professionalPayout")}</p>
                        <p className="font-medium text-foreground">{payment.professionalPayout.toFixed(2)} $</p>
                      </div>
                      {payment.paymentMethod && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t("paymentMethod")}</p>
                          <p className="font-medium text-foreground capitalize">
                            {payment.paymentMethod === "transfer"
                              ? t("methodInterac")
                              : payment.paymentMethod === "card"
                                ? t("methodCard")
                                : payment.paymentMethod}
                          </p>
                        </div>
                      )}
                      {payment.paidDate && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t("paidDate")}</p>
                          <p className="font-medium text-foreground">{formatDate(payment.paidDate)}</p>
                        </div>
                      )}
                      {payment.transferDueAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t("transferDueAt")}</p>
                          <p className="font-medium text-foreground">{formatDate(payment.transferDueAt)}</p>
                        </div>
                      )}
                      {payment.interacReferenceCode && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t("interacCode")}</p>
                          <p className="font-mono font-medium text-foreground">{payment.interacReferenceCode}</p>
                        </div>
                      )}
                    </div>

                    {/* Reminder badges */}
                    {(payment.interacReminder24hSent || payment.interacReminder48hSent) && (
                      <div className="flex flex-wrap gap-2">
                        {payment.interacReminder24hSent && (
                          <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-700 dark:text-orange-400">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("reminder24hSent")}
                          </span>
                        )}
                        {payment.interacReminder48hSent && (
                          <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-400">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("reminder48hSent")}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      {payment.status === "paid" && (
                        <Button
                          variant="outline"
                          className="gap-2 rounded-full"
                          size="sm"
                          onClick={() => handleDownloadReceipt(payment.id)}
                        >
                          <Download className="h-4 w-4" />
                          {t("downloadInvoice")}
                        </Button>
                      )}

                      {/* Relancer button — Interac pending/overdue only */}
                      {payment.paymentMethod === "transfer" &&
                        payment.status !== "paid" && (
                          <Button
                            variant={payment.status === "overdue" ? "destructive" : "outline"}
                            className="gap-2 rounded-full"
                            size="sm"
                            disabled={resendingId === payment.id}
                            onClick={() => handleResend(payment.id)}
                          >
                            <Send className="h-4 w-4" />
                            {resendingId === payment.id
                              ? t("resending")
                              : t("resend")}
                          </Button>
                        )}

                      {/* Feedback after resend */}
                      {resendFeedback[payment.id] === "ok" && (
                        <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                          {t("resendSuccess")}
                        </span>
                      )}
                      {resendFeedback[payment.id] === "error" && (
                        <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                          <AlertCircle className="h-4 w-4" />
                          {t("resendError")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && data.pagination.pages > 1 && (
          <div className="flex justify-center gap-2 pt-4">
            {Array.from({ length: data.pagination.pages }, (_, i) => i + 1).map(
              (p) => (
                <button
                  key={p}
                  onClick={() => fetchBillingData(p)}
                  className={`h-10 w-10 rounded-full border text-sm transition ${
                    p === currentPage
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/40 bg-card/80 text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {p}
                </button>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
