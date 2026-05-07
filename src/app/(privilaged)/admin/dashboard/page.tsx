"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  User,
  BarChart3,
  DollarSign,
  TrendingUp,
  Activity,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Flag,
} from "lucide-react";
import Link from "next/link";

interface PaymentFlag {
  appointmentId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  professionalName: string | null;
  sessionAt: string | null;
  hoursUntilSession: number | null;
}

interface DashboardData {
  stats: {
    totalProfessionals: number;
    professionalsChange: number;
    totalPatients: number;
    patientsChange: number;
    totalSessions: number;
    sessionsChange: number;
    totalRevenue: number;
    revenueChange: number;
  };
  recentActivity: Array<{
    id: string;
    type: string;
    message: string;
    time: string;
    icon: string;
    color: string;
  }>;
  topProfessionals: Array<{
    name: string;
    sessions: number;
    rating: number;
    revenue: number;
  }>;
  pendingApprovals: number;
  paymentFlags?: PaymentFlag[];
}

export default function AdminDashboardPage() {
  const t = useTranslations("AdminDashboard.overview");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/admin/dashboard");
      if (!response.ok) {
        throw new Error(t("error"));
      }
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case "CheckCircle2":
        return CheckCircle2;
      case "Activity":
        return Activity;
      case "Clock":
        return Clock;
      default:
        return CheckCircle2;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>

        {/* Loading skeleton */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-card p-6 border border-border/40"
            >
              <div className="animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-24"></div>
                    <div className="h-8 bg-muted rounded w-16"></div>
                    <div className="h-3 bg-muted rounded w-12"></div>
                  </div>
                  <div className="h-12 w-12 bg-muted rounded-full"></div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl bg-card p-6 border border-border/40">
            <div className="animate-pulse">
              <div className="h-6 bg-muted rounded w-32 mb-4"></div>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded"></div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-card p-6 border border-border/40">
            <div className="animate-pulse">
              <div className="h-6 bg-muted rounded w-32 mb-4"></div>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-light text-foreground mb-2">
                {error || t("error")}
              </h3>
              <p className="text-muted-foreground mb-4"></p>
              <button
                onClick={fetchDashboardData}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                {t("tryAgain")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboardData) return null;

  const { stats, recentActivity, topProfessionals } = dashboardData;
  const paymentFlags = dashboardData.paymentFlags ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <button
          onClick={fetchDashboardData}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("refresh")}
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("totalProfessionals")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                {stats.totalProfessionals}
              </p>
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="h-3 w-3 text-green-600" />
                <span className="text-xs text-green-600 font-medium">
                  +{stats.professionalsChange}%
                </span>
              </div>
            </div>
            <div className="rounded-full bg-purple-100 p-3">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("totalPatients")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                {stats.totalPatients}
              </p>
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="h-3 w-3 text-orange-600" />
                <span className="text-xs text-orange-600 font-medium">
                  +{stats.patientsChange}%
                </span>
              </div>
            </div>
            <div className="rounded-full bg-orange-100 p-3">
              <User className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("totalSessions")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                {stats.totalSessions.toLocaleString()}
              </p>
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="h-3 w-3 text-blue-600" />
                <span className="text-xs text-blue-600 font-medium">
                  +{stats.sessionsChange}%
                </span>
              </div>
            </div>
            <div className="rounded-full bg-blue-100 p-3">
              <BarChart3 className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("totalRevenue")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                ${stats.totalRevenue.toLocaleString()}
              </p>
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="h-3 w-3 text-green-600" />
                <span className="text-xs text-green-600 font-medium">
                  +{stats.revenueChange}%
                </span>
              </div>
            </div>
            <div className="rounded-full bg-green-100 p-3">
              <DollarSign className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {paymentFlags.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <Flag className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-xl font-serif font-light text-red-900">
                  {t("paymentFlags.title")}
                </h2>
                <p className="text-sm font-light text-red-700/80 mt-1">
                  {t("paymentFlags.subtitle", { count: paymentFlags.length })}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {paymentFlags.slice(0, 8).map((flag) => {
              const sessionLabel = flag.sessionAt
                ? new Date(flag.sessionAt).toLocaleString("fr-CA", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—";
              return (
                <Link
                  key={flag.appointmentId}
                  href={`/admin/dashboard/patients/${flag.clientId}`}
                  className="flex items-center justify-between gap-4 rounded-lg bg-white/70 border border-red-100 px-4 py-3 hover:bg-white transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Flag className="h-4 w-4 text-red-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {flag.clientName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {flag.professionalName
                          ? `${t("paymentFlags.with")} ${flag.professionalName} · `
                          : ""}
                        {sessionLabel}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-medium text-red-700 bg-red-100 rounded-full px-2 py-1">
                      {flag.hoursUntilSession !== null
                        ? t("paymentFlags.hoursLeft", {
                            hours: flag.hoursUntilSession,
                          })
                        : t("paymentFlags.urgent")}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          {paymentFlags.length > 8 && (
            <p className="text-xs text-red-700/70 mt-3 font-light">
              {t("paymentFlags.moreCount", {
                count: paymentFlags.length - 8,
              })}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <h2 className="text-xl font-serif font-light text-foreground mb-4">
            {t("recentActivity")}
          </h2>
          <div className="space-y-4">
            {recentActivity.length > 0 ? (
              recentActivity.map((activity) => {
                const Icon = getIconComponent(activity.icon);
                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-4 p-3 rounded-lg bg-muted/30"
                  >
                    <div
                      className={`rounded-full bg-background p-2 ${activity.color}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-light text-foreground">
                        {activity.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {activity.time}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t("noRecentActivity")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <h2 className="text-xl font-serif font-light text-foreground mb-4">
            {t("topProfessionals")}
          </h2>
          <div className="space-y-3">
            {topProfessionals.length > 0 ? (
              topProfessionals.map((prof, index) => (
                <div
                  key={prof.name}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-light text-foreground">
                        {prof.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {prof.sessions} {t("sessions")} • ⭐ {prof.rating.toFixed(1)}
                      </p>
                    </div>
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    ${prof.revenue.toLocaleString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t("noProfessionalsData")}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-card p-6 border border-border/40">
        <h2 className="text-xl font-serif font-light text-foreground mb-4">
          {t("quickActions")}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            href="/admin/dashboard/professionals"
            className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted"
          >
            <h3 className="font-light text-foreground mb-2">
              {t("reviewProfessionals")}
            </h3>
            <p className="text-sm text-muted-foreground font-light">
              {t("reviewProfessionalsDesc")}
            </p>
          </Link>
          <Link
            href="/admin/dashboard/patients"
            className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted"
          >
            <h3 className="font-light text-foreground mb-2">{t("managePatients")}</h3>
            <p className="text-sm text-muted-foreground font-light">
              {t("managePatientsDesc")}
            </p>
          </Link>
          <a
            href="/admin/dashboard/reports"
            className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted"
          >
            <h3 className="font-light text-foreground mb-2">{t("viewReports")}</h3>
            <p className="text-sm text-muted-foreground font-light">
              {t("viewReportsDesc")}
            </p>
          </a>
        </div>
      </div>
    </div>
  );
}
