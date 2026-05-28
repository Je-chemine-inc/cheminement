"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { appointmentsAPI, clientsAPI, usersAPI } from "@/lib/api-client";

export default function DashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations("Dashboard.overview");

  // The JWT only refreshes the license status at login, so an admin approval
  // is invisible to a pro who is already signed in. Fetch the live value from
  // /api/users/me on mount so the "Actif" badge appears without forcing a
  // re-login. Fall back to the session value while the fetch is in flight.
  const [liveLicenseStatus, setLiveLicenseStatus] = useState<string | null>(
    null,
  );
  const [liveAccountStatus, setLiveAccountStatus] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    usersAPI
      .get()
      .then((u: any) => {
        if (cancelled) return;
        if (u?.professionalLicenseStatus) {
          setLiveLicenseStatus(u.professionalLicenseStatus);
        }
        if (u?.status) {
          setLiveAccountStatus(u.status);
        }
      })
      .catch(() => {
        // Network failure: keep showing the session-derived state.
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const licenseStatus =
    liveLicenseStatus ?? session?.user?.professionalLicenseStatus;
  const isVerified = licenseStatus === "verified";
  const isActive = (liveAccountStatus ?? "") === "active";

  const [totalClients, setTotalClients] = useState<number | null>(null);
  const [weekSessions, setWeekSessions] = useState<number | null>(null);
  const [monthSessions, setMonthSessions] = useState<number | null>(null);
  const [pendingProposalsCount, setPendingProposalsCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/appointments/proposed");
        if (!res.ok) return;
        const data = (await res.json()) as unknown[];
        if (!cancelled) {
          setPendingProposalsCount(Array.isArray(data) ? data.length : 0);
        }
      } catch {
        // silent
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startOfWeek = new Date();
    const day = startOfWeek.getDay(); // 0 = Sunday
    const diffToMonday = (day + 6) % 7;
    startOfWeek.setDate(startOfWeek.getDate() - diffToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    Promise.all([
      clientsAPI.list().catch(() => [] as Array<{ totalSessions: number }>),
      appointmentsAPI
        .list({ startDate: fmt(startOfMonth), endDate: fmt(endOfMonth) })
        .catch(() => [] as Awaited<ReturnType<typeof appointmentsAPI.list>>),
    ]).then(([clientList, monthAppointments]) => {
      if (cancelled) return;

      const activeClients = (clientList as Array<{ totalSessions: number }>)
        .filter((c) => (c.totalSessions ?? 0) > 0).length;
      setTotalClients(activeClients);

      const counted = (monthAppointments as Array<{
        date?: string;
        status: string;
      }>).filter((a) =>
        ["scheduled", "ongoing", "completed"].includes(a.status),
      );

      setMonthSessions(counted.length);

      const weekCount = counted.filter((a) => {
        if (!a.date) return false;
        const d = new Date(a.date);
        return d >= startOfWeek && d < endOfWeek;
      }).length;
      setWeekSessions(weekCount);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const renderMetric = (value: number | null) =>
    value === null ? "…" : String(value);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="text-muted-foreground font-light mt-2">{t("subtitle")}</p>
      </div>

      {pendingProposalsCount > 0 && (
        <a
          href="/professional/dashboard/proposals"
          className="block rounded-xl border-l-4 border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-950/30 px-5 py-4 transition-colors hover:bg-amber-100/70 dark:hover:bg-amber-950/50"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                {pendingProposalsCount === 1
                  ? t("pendingProposalsAlertOne")
                  : t("pendingProposalsAlertMany", {
                      count: pendingProposalsCount,
                    })}
              </p>
              <p className="text-xs font-light text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                {t("pendingProposalsAlertSub")}
              </p>
            </div>
            <span className="inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-sm font-bold min-w-7 h-7 px-2">
              {pendingProposalsCount > 9 ? "9+" : pendingProposalsCount}
            </span>
          </div>
        </a>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("totalClients")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                {renderMetric(totalClients)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("weekSessions")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                {renderMetric(weekSessions)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-muted-foreground">
                {t("monthSessions")}
              </p>
              <p className="text-2xl font-serif font-light text-foreground mt-2">
                {renderMetric(monthSessions)}
              </p>
            </div>
          </div>
        </div>

        {!isVerified && (
          <div className="rounded-xl bg-card p-6 border-l-4 border-amber-500/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-light text-muted-foreground">
                  {t("profileStatus")}
                </p>
                <p className="text-2xl font-serif font-light text-foreground mt-2">
                  {t("pendingReview")}
                </p>
              </div>
            </div>
          </div>
        )}

        {isVerified && (
          <div className="rounded-xl bg-card p-6 border-l-4 border-emerald-500/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-light text-muted-foreground">
                  {t("profileStatus")}
                </p>
                <p className="text-2xl font-serif font-light text-emerald-600 dark:text-emerald-400 mt-2">
                  {t("verifiedStatus")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-card p-6">
        <h2 className="text-xl font-serif font-light text-foreground mb-4">
          {t("quickActions")}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <a
            href="/professional/dashboard/profile"
            className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted group"
          >
            <h3 className="font-light text-foreground mb-2 group-hover:text-primary transition-colors">
              {isVerified ? t("editProfile") : t("completeProfile")}
            </h3>
            <p className="text-sm text-muted-foreground font-light">
              {isVerified ? t("editProfileDesc") : t("completeProfileDesc")}
            </p>
          </a>
          <a
            href="/professional/dashboard/schedule"
            className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted group"
          >
            <h3 className="font-light text-foreground mb-2 group-hover:text-primary transition-colors">
              {t("setSchedule")}
            </h3>
            <p className="text-sm text-muted-foreground font-light">
              {t("setScheduleDesc")}
            </p>
          </a>

          {isVerified && (
            <a
              href="/professional/dashboard/clients"
              className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted group"
            >
              <h3 className="font-light text-foreground mb-2 group-hover:text-primary transition-colors">
                {useTranslations("Dashboard.sidebar")("clientManagement")}
              </h3>
              <p className="text-sm text-muted-foreground font-light">
                {useTranslations("Dashboard.sidebar")("myClients")}
              </p>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
