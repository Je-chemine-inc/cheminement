"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCalendarDate } from "@/lib/format-calendar-date";

/**
 * Spec 002 phase 6 — what organizations owe by age, and what in organization
 * billing needs a person. Shown at the top of "Factures aux organismes".
 */

const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
type Bucket = (typeof BUCKETS)[number];

type Session = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  forLovedOne: string;
  date: string | null;
  organizationId: string;
  orgAmountCents: number;
};

interface Receivables {
  organizations: Record<string, string>;
  aging: {
    rows: Array<{ organizationId: string; buckets: Record<Bucket, number>; totalCents: number; invoices: number }>;
    totals: Record<Bucket, number> & { totalCents: number };
  };
  anomalies: {
    overdue: Array<{ invoiceId: string; organizationId: string; number: string; balanceCents: number; daysLate: number; remindersSent: number; disputed: boolean }>;
    awaitingDecision: Array<Session & { reason: string }>;
    uninvoiced: Array<Session & { daysSinceClosure: number }>;
    capMismatch: Array<{ coverageId: string; clientId: string; clientName: string; organizationId: string; used: number; max: number | null; issues: string[]; staleSlots: number }>;
    negativeMargin: Array<Session & { marginCents: number }>;
    paymentReview: Array<{ invoiceId: string; organizationId: string; number: string; status: string; balanceCents: number; disputed: boolean; refundUnconfirmed?: boolean; lastEvent: string }>;
  };
}

const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} $`;
const day = (iso: string | null) => (iso ? formatCalendarDate(iso, "fr-CA") : "—");

export function OrganizationReceivablesPanel({ reloadKey }: { reloadKey: number }) {
  const t = useTranslations("AdminDashboard.orgInvoices.receivables");
  const [data, setData] = useState<Receivables | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/organization-invoices/receivables")
      .then(async (res) => (res.ok ? ((await res.json()) as Receivables) : null))
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setFailed(!body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (failed) return null;
  if (!data) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const org = (id: string) => data.organizations[id] ?? "—";
  const a = data.anomalies;
  const person = (s: { clientName: string; forLovedOne?: string }) =>
    s.forLovedOne ? t("forLovedOne", { client: s.clientName, name: s.forLovedOne }) : s.clientName;
  const patientLink = (clientId: string, label: string) =>
    clientId ? (
      <Link href={`/admin/dashboard/patients/${clientId}`} className="underline underline-offset-2 hover:text-primary">
        {label}
      </Link>
    ) : (
      label
    );

  const groups: Array<{ key: string; count: number; body: React.ReactNode }> = [
    {
      key: "overdue",
      count: a.overdue.length,
      body: a.overdue.map((i) => (
        <li key={i.invoiceId}>
          {i.number} — {org(i.organizationId)} — {money(i.balanceCents)} —{" "}
          {t("daysLate", { days: i.daysLate })} — {t("remindersSent", { count: i.remindersSent })}
          {i.disputed ? ` — ${t("disputed")}` : ""}
        </li>
      )),
    },
    {
      key: "awaitingDecision",
      count: a.awaitingDecision.length,
      body: a.awaitingDecision.map((s) => (
        <li key={s.appointmentId}>
          {day(s.date)} — {patientLink(s.clientId, person(s))}
          {s.organizationId ? ` — ${org(s.organizationId)}` : ""}
        </li>
      )),
    },
    {
      key: "uninvoiced",
      count: a.uninvoiced.length,
      body: a.uninvoiced.map((s) => (
        <li key={s.appointmentId}>
          {day(s.date)} — {person(s)} — {org(s.organizationId)} — {money(s.orgAmountCents)} —{" "}
          {t("closedDaysAgo", { days: s.daysSinceClosure })}
        </li>
      )),
    },
    {
      key: "capMismatch",
      count: a.capMismatch.length,
      body: a.capMismatch.map((c) => (
        <li key={c.coverageId}>
          {patientLink(c.clientId, c.clientName || "—")} — {org(c.organizationId)} —{" "}
          {c.max !== null ? `${c.used}/${c.max}` : c.used} —{" "}
          {c.issues.map((k) => t(`capIssues.${k}`, { count: c.staleSlots })).join(" ; ")}
        </li>
      )),
    },
    {
      key: "negativeMargin",
      count: a.negativeMargin.length,
      body: a.negativeMargin.map((s) => (
        <li key={s.appointmentId}>
          {day(s.date)} — {person(s)} — {org(s.organizationId)} — {t("margin", { amount: money(s.marginCents) })}
        </li>
      )),
    },
    {
      key: "paymentReview",
      count: a.paymentReview.length,
      body: a.paymentReview.map((i) => (
        <li key={i.invoiceId}>
          {i.number} — {org(i.organizationId)} — {t(`invoiceStatus.${i.status}`)} —{" "}
          {i.balanceCents < 0 ? t("credit", { amount: money(-i.balanceCents) }) : money(i.balanceCents)}
          {i.disputed ? ` — ${t("disputed")}` : ""}
          {i.refundUnconfirmed ? ` — ${t("refundUnconfirmed")}` : ""}
          {i.lastEvent ? <span className="block text-muted-foreground">{i.lastEvent}</span> : null}
        </li>
      )),
    },
  ];
  const anomalyCount = groups.reduce((n, g) => n + g.count, 0);

  return (
    <section className="rounded-xl border border-border/40 bg-card p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-serif font-light">{t("title")}</h2>
        {data.aging.rows.length > 0 && (
          <button
            type="button"
            // A file download, not a page: a plain navigation, not the router.
            onClick={() => window.location.assign("/api/admin/organization-invoices/receivables?format=csv")}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
          </button>
        )}
      </div>

      {data.aging.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noOpenBalance")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-normal">{t("organization")}</th>
                {BUCKETS.map((b) => (
                  <th key={b} className="py-2 px-2 text-right font-normal">{t(`buckets.${b}`)}</th>
                ))}
                <th className="py-2 pl-2 text-right font-normal">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {data.aging.rows.map((r) => (
                <tr key={r.organizationId} className="border-b border-border/20">
                  <td className="py-2 pr-3">
                    {org(r.organizationId)}
                    <span className="block text-xs text-muted-foreground">{t("invoicesCount", { count: r.invoices })}</span>
                  </td>
                  {BUCKETS.map((b) => (
                    <td
                      key={b}
                      className={`py-2 px-2 text-right font-mono ${r.buckets[b] > 0 && b !== "current" ? (b === "d1_30" ? "text-amber-700" : "text-red-700") : ""}`}
                    >
                      {r.buckets[b] > 0 ? money(r.buckets[b]) : "—"}
                    </td>
                  ))}
                  <td className="py-2 pl-2 text-right font-mono font-medium">{money(r.totalCents)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2 pr-3">{t("total")}</td>
                {BUCKETS.map((b) => (
                  <td key={b} className="py-2 px-2 text-right font-mono">{money(data.aging.totals[b])}</td>
                ))}
                <td className="py-2 pl-2 text-right font-mono">{money(data.aging.totals.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {anomalyCount > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          )}
          {anomalyCount > 0 ? t("anomaliesTitle", { count: anomalyCount }) : t("noAnomalies")}
        </h3>
        {groups
          .filter((g) => g.count > 0)
          .map((g) => (
            <details key={g.key} className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/20">
              <summary className="cursor-pointer font-medium">
                {t(`groups.${g.key}.title`)} ({g.count})
                <span className="block text-xs font-normal text-muted-foreground">{t(`groups.${g.key}.hint`)}</span>
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{g.body}</ul>
            </details>
          ))}
      </div>
    </section>
  );
}
