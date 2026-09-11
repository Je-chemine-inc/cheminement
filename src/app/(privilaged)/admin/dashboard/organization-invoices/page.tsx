"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCalendarDate } from "@/lib/format-calendar-date";
import { OrganizationReceivablesPanel } from "@/components/admin/OrganizationReceivablesPanel";
import { OrganizationFormDialog } from "@/components/admin/OrganizationFormDialog";
import { OrganizationRefundDialog, type RefundTarget } from "@/components/admin/OrganizationRefundDialog";

type Status = "draft" | "issuing" | "sent" | "partially_paid" | "paid" | "overdue" | "void" | "refunded";
const FILTERS = ["open", "draft", "sent", "overdue", "partially_paid", "paid", "refunded", "void"] as const;
const PAY_METHODS = ["interac", "cheque", "eft", "portal", "other"] as const;

interface Line {
  appointmentId: string;
  sessionDate: string;
  patientFullName: string;
  caseNumber: string;
  professionalName: string;
  amountCents: number;
}
interface Invoice {
  id: string;
  kind: "session" | "statement";
  organizationName: string;
  number: string | null;
  periodKey: string | null;
  status: Status;
  totalCents: number;
  paidCents: number;
  creditedCents: number;
  balanceCents: number;
  issuedAt: string | null;
  dueAt: string | null;
  billToEmails: string[];
  lines: Line[];
  sendLog: {
    at: string;
    to: string[];
    kind: "sent" | "resent" | "reminder" | "payment_received" | "refund_notice";
    withForm: boolean;
    withoutOwnForm: boolean;
  }[];
  // The organization's own claim form.
  requiresOwnForm: boolean;
  formNotes: string;
  attachmentEditable: boolean;
  attachment: {
    fileName: string;
    size: number;
    scanStatus: "clean" | "skipped";
    uploadedAt: string;
    stale: boolean;
    sent: boolean;
  } | null;
  payments: {
    id: string | null;
    amountCents: number;
    refundedCents: number;
    method: "card" | "pad" | (typeof PAY_METHODS)[number];
    reference: string;
    receivedAt: string;
    source: "stripe" | "interac_reconciler" | "admin";
    refundableCents: number;
    refundVia: "stripe" | "outside";
    refundBlocked: "NO_ID" | "DISPUTED" | "IN_PROGRESS" | "NOT_REFUNDABLE" | null;
  }[];
  refunds: {
    id: string;
    paymentId: string;
    amountCents: number;
    creditCents: number;
    owed: "still" | "no_longer" | null;
    via: "stripe" | "outside";
    method: string | null;
    reference: string;
    reason: string;
    status: "requested" | "pending" | "succeeded" | "failed";
    failureReason: string;
    refundedAt: string;
    at: string;
  }[];
  paymentEvents: { at: string; kind: string; detail: string }[];
  reminders: { dueSentAt: string | null; followUpSentAt: string | null; overdueAlertSentAt: string | null };
  disputed: boolean;
  /** The organization's bank debit on its way. */
  debitPending: { amountCents: number; since: string } | null;
}
interface Unbilled {
  organizationId: string;
  organizationName: string;
  sessions: number;
  totalCents: number;
  oldest: string | null;
  billingCycle: "per_session" | "monthly";
  hasBillingEmail: boolean;
  requiresOwnForm: boolean;
}
type Blocked = { appointmentId: string; patientFullName: string; sessionDate: string };

/** Nothing can go out until the form is attached (or sent without, on purpose). */
const formMissing = (inv: Invoice) => inv.requiresOwnForm && !inv.attachment && inv.attachmentEditable;
const formStale = (inv: Invoice) => Boolean(inv.attachment?.stale) && inv.attachmentEditable;
const formBlocks = (inv: Invoice) => formMissing(inv) || formStale(inv);

const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} $`;
const previousMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const STATUS_STYLE: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  issuing: "bg-amber-100 text-amber-800",
  sent: "bg-blue-100 text-blue-800",
  partially_paid: "bg-teal-100 text-teal-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  void: "bg-gray-100 text-gray-500",
  refunded: "bg-purple-100 text-purple-800",
};

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export default function OrganizationInvoicesPage() {
  const t = useTranslations("AdminDashboard.orgInvoices");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [unbilled, setUnbilled] = useState<Unbilled[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [periods, setPeriods] = useState<Record<string, string>>({});

  const [sending, setSending] = useState<{ inv: Invoice; action: "send" | "resend" } | null>(null);
  // Send to an organization that requires its form, without it — ticked on purpose.
  const [withoutForm, setWithoutForm] = useState(false);
  const [attaching, setAttaching] = useState<Invoice | null>(null);
  const [removingForm, setRemovingForm] = useState<Invoice | null>(null);
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [pay, setPay] = useState({ amount: "", method: "cheque", reference: "", receivedOn: "" });
  // One refund dialog at a time; the counter remounts it clean on every opening.
  const [refunding, setRefunding] = useState<{ target: RefundTarget; n: number } | null>(null);
  const [refundOpenings, setRefundOpenings] = useState(0);

  // The effect fetches; whoever wants fresh data bumps `reloadKey` (and
  // raises the loading flag itself). State is only set once the response is in.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const status = filter === "open" ? "" : `?status=${filter}`;
    void call(`/api/admin/organization-invoices${status}`).then((r) => {
      if (cancelled) return;
      setError(r.ok ? null : (r.body?.error ?? `Error ${r.status}`));
      if (r.ok) {
        setInvoices(r.body.invoices ?? []);
        setUnbilled(r.body.unbilled ?? []);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  const act = async (
    key: string,
    url: string,
    body: unknown,
    onDone?: (b: Record<string, unknown>) => void,
    onRefused?: (b: Record<string, unknown>) => boolean,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const r = await call(url, { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) {
      if (onRefused?.(r.body)) return false;
      if (r.body?.code === "CONSENT_MISSING") setBlocked(r.body?.details?.blocked ?? []);
      else if (typeof r.body?.code === "string" && t.has(`debit.errors.${r.body.code}`)) setError(t(`debit.errors.${r.body.code}`));
      else setError(r.body?.error ?? `Error ${r.status}`);
      return false;
    }
    onDone?.(r.body);
    load();
    return true;
  };

  const prepare = (u: Unbilled) =>
    u.billingCycle === "monthly"
      ? act(`prep-${u.organizationId}`, "/api/admin/organization-invoices", {
          kind: "statement",
          organizationId: u.organizationId,
          periodKey: periods[u.organizationId] ?? previousMonth(),
        }, () => setNotice(t("draftReady")))
      : act(`prep-${u.organizationId}`, "/api/admin/organization-invoices", {
          kind: "sessions",
          organizationId: u.organizationId,
        }, (b) => setNotice(t("draftsReady", { count: Number(b.drafted ?? 0) })));

  const invoiceAction = (inv: Invoice, body: Record<string, unknown>, done?: () => void) =>
    act(`${body.action}-${inv.id}`, `/api/admin/organization-invoices/${inv.id}`, body, done, (b) => {
      // The form went missing or stale since the page loaded: back to the send
      // dialog, which says what to do.
      if (b?.code === "OWN_FORM_MISSING" || b?.code === "OWN_FORM_STALE") {
        const now: Invoice =
          b.code === "OWN_FORM_MISSING"
            ? { ...inv, requiresOwnForm: true, attachment: null }
            : { ...inv, attachment: inv.attachment ? { ...inv.attachment, stale: true } : null };
        setWithoutForm(false);
        setSending({ inv: now, action: body.action === "resend" ? "resend" : "send" });
        load();
        return true;
      }
      if (b?.code === "OWN_FORM_UNAVAILABLE") {
        setError(t("form.errors.OWN_FORM_UNAVAILABLE"));
        return true;
      }
      return false;
    });

  const openSend = (inv: Invoice, action: "send" | "resend") => {
    setWithoutForm(false);
    setSending({ inv, action });
  };

  const openRefund = (inv: Invoice, p: Invoice["payments"][number]) => {
    if (!p.id) return;
    setRefundOpenings((n) => n + 1);
    setRefunding({
      n: refundOpenings + 1,
      target: {
        invoice: {
          id: inv.id,
          number: inv.number,
          status: inv.status,
          balanceCents: inv.balanceCents,
          organizationName: inv.organizationName,
        },
        payment: {
          id: p.id,
          amountCents: p.amountCents,
          refundedCents: p.refundedCents,
          refundableCents: p.refundableCents,
          method: p.method,
          receivedAt: p.receivedAt,
          refundVia: p.refundVia,
        },
      },
    });
  };

  // Where a Stripe refund made from here stands (never re-sends it).
  const checkRefund = (inv: Invoice, refundId: string) =>
    act(`refund_check-${refundId}`, `/api/admin/organization-invoices/${inv.id}`, { action: "refund_check", refundId }, () =>
      setNotice(t("refund.checkedNotice")),
    );

  const removeForm = async (inv: Invoice) => {
    setBusy(`removeForm-${inv.id}`);
    setError(null);
    setNotice(null);
    const r = await call(`/api/admin/organization-invoices/${inv.id}/attachment`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      setError(
        typeof r.body?.code === "string" && t.has(`form.errors.${r.body.code}`)
          ? t(`form.errors.${r.body.code}`)
          : (r.body?.error ?? `Error ${r.status}`),
      );
      return;
    }
    setNotice(t("form.removedNotice"));
    load();
  };

  const openPdf = (inv: Invoice) =>
    window.open(`/api/admin/organization-invoices/${inv.id}/pdf?inline=1`, "_blank", "noopener,noreferrer");

  const patients = (inv: Invoice) => new Set(inv.lines.map((l) => l.patientFullName)).size;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground font-light mt-1 max-w-2xl">{t("subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={load}
          aria-label={t("refresh")}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</div>
      )}

      {/* What organizations owe by age, and what needs a person (phase 6) */}
      <OrganizationReceivablesPanel reloadKey={reloadKey} />

      {/* What is owed and not invoiced yet */}
      <section className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
        <h2 className="text-lg font-serif font-light">{t("unbilledTitle")}</h2>
        {unbilled.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("unbilledEmpty")}</p>
        ) : (
          <div className="divide-y divide-border/40">
            {unbilled.map((u) => (
              <div key={u.organizationId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <p className="font-medium">{u.organizationName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("unbilledLine", { sessions: u.sessions, total: money(u.totalCents) })}
                    {u.oldest ? ` · ${t("since", { date: formatCalendarDate(u.oldest, "fr-CA") })}` : ""}
                    {" · "}
                    {t(`cycles.${u.billingCycle}`)}
                  </p>
                  {!u.hasBillingEmail && (
                    <p className="text-xs text-amber-700">{t("noBillingEmail")}</p>
                  )}
                  {u.requiresOwnForm && (
                    <p className="text-xs text-muted-foreground">{t("form.unbilledRequired")}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {u.billingCycle === "monthly" && (
                    <Input
                      type="month"
                      className="h-8 w-40 text-xs"
                      value={periods[u.organizationId] ?? previousMonth()}
                      onChange={(e) => setPeriods({ ...periods, [u.organizationId]: e.target.value })}
                    />
                  )}
                  <Button size="sm" className="h-8" disabled={busy === `prep-${u.organizationId}`} onClick={() => prepare(u)}>
                    {busy === `prep-${u.organizationId}` && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {u.billingCycle === "monthly" ? t("prepareStatement") : t("prepareInvoices")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Invoices */}
      <section className="space-y-3">
        <div className="flex flex-wrap gap-1 rounded-full bg-muted p-1 w-fit">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                if (f === filter) return;
                setLoading(true);
                setFilter(f);
              }}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`filters.${f}`)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="rounded-lg border border-border/60 divide-y divide-border/40">
            {invoices.map((inv) => (
              <Fragment key={inv.id}>
                <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <button
                    className="flex min-w-0 items-start gap-2 text-left"
                    onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
                  >
                    {expanded === inv.id ? <ChevronDown className="mt-1 h-4 w-4" /> : <ChevronRight className="mt-1 h-4 w-4" />}
                    <span className="space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{inv.number ?? t("draftLabel")}</span>
                        <Badge variant="outline" className={`border-transparent ${STATUS_STYLE[inv.status]}`}>{t(`statuses.${inv.status}`)}</Badge>
                        {inv.disputed && (
                          <Badge variant="outline" className="border-transparent bg-red-100 text-red-800">{t("disputed")}</Badge>
                        )}
                        {inv.balanceCents < 0 && (
                          <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800">
                            {t("overpaid", { amount: money(-inv.balanceCents) })}
                          </Badge>
                        )}
                        {inv.creditedCents > 0 && (
                          <Badge variant="outline" className="border-transparent bg-purple-100 text-purple-800">
                            {t("refund.creditBadge", { amount: money(inv.creditedCents) })}
                          </Badge>
                        )}
                        {inv.refunds.some((r) => r.status === "requested") && (
                          <Badge variant="outline" className="border-transparent bg-red-100 text-red-800">
                            {t("refund.unconfirmedBadge")}
                          </Badge>
                        )}
                        {inv.debitPending && (
                          <Badge variant="outline" className="border-transparent bg-sky-100 text-sky-800">
                            {t("debit.badge", { amount: money(inv.debitPending.amountCents) })}
                          </Badge>
                        )}
                        {formStale(inv) ? (
                          <Badge variant="outline" className="border-transparent bg-red-100 text-red-800">
                            {t("form.badgeStale")}
                          </Badge>
                        ) : inv.attachment ? (
                          <Badge variant="outline" className="border-transparent bg-green-100 text-green-800">
                            {t("form.badgeAttached")}
                            {!inv.attachment.sent && ["sent", "overdue", "partially_paid"].includes(inv.status)
                              ? ` · ${t("form.notSentYet")}`
                              : ""}
                          </Badge>
                        ) : formMissing(inv) ? (
                          <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800">
                            {t("form.badgeRequired")}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block text-sm">{inv.organizationName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {inv.kind === "statement" ? t("statementOf", { period: inv.periodKey ?? "" }) : t("sessionInvoice")}
                        {" · "}
                        {t("linesCount", { count: inv.lines.length })}
                        {" · "}
                        {money(inv.totalCents)}
                        {inv.paidCents > 0 || inv.creditedCents > 0 ? ` · ${t("balance", { amount: money(inv.balanceCents) })}` : ""}
                        {inv.dueAt ? ` · ${t("due", { date: new Date(inv.dueAt).toLocaleDateString("fr-CA") })}` : ""}
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => openPdf(inv)}>
                      <Eye className="h-3.5 w-3.5" /> PDF
                    </Button>
                    {formMissing(inv) && (
                      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setAttaching(inv)}>
                        <Paperclip className="h-3.5 w-3.5" /> {t("form.attach")}
                      </Button>
                    )}
                    {inv.status === "draft" && (
                      <>
                        <Button size="sm" variant="outline" className="h-8" disabled={busy === `refresh-${inv.id}`}
                          onClick={() => invoiceAction(inv, { action: "refresh" }, () => setNotice(t("refreshed")))}>
                          {t("refreshDraft")}
                        </Button>
                        <Button size="sm" className="h-8 gap-1" onClick={() => openSend(inv, "send")}>
                          <Send className="h-3.5 w-3.5" /> {t("send")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive"
                          onClick={() => { setVoidReason(""); setVoiding(inv); }}>
                          {t("discard")}
                        </Button>
                      </>
                    )}
                    {inv.status === "issuing" && (
                      <Button size="sm" className="h-8 gap-1" onClick={() => openSend(inv, "send")}>
                        <Send className="h-3.5 w-3.5" /> {t("retrySend")}
                      </Button>
                    )}
                    {["sent", "overdue", "partially_paid"].includes(inv.status) && (
                      <>
                        <Button size="sm" variant="outline" className="h-8" disabled={busy === `resend-${inv.id}`}
                          onClick={() =>
                            // Without a usable form, the dialog explains and offers to send without it.
                            formBlocks(inv)
                              ? openSend(inv, "resend")
                              : invoiceAction(inv, { action: "resend" }, () => setNotice(t("resent")))
                          }>
                          {t("resend")}
                        </Button>
                        {/* While the organization's debit is on its way, neither: it would pay twice, or land on a void invoice. */}
                        <Button size="sm" className="h-8" disabled={Boolean(inv.debitPending)}
                          title={inv.debitPending ? t("debit.blocked") : undefined}
                          onClick={() => {
                            setPay({ amount: (inv.balanceCents / 100).toFixed(2), method: "cheque", reference: "", receivedOn: "" });
                            setPaying(inv);
                          }}>
                          {t("recordPayment")}
                        </Button>
                        {inv.paidCents === 0 && (
                          <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive"
                            disabled={Boolean(inv.debitPending)}
                            title={inv.debitPending ? t("debit.blocked") : undefined}
                            onClick={() => { setVoidReason(""); setVoiding(inv); }}>
                            {t("void")}
                          </Button>
                        )}
                      </>
                    )}
                    {/* Everything went back and nothing is owed: its sessions can go to another payer. */}
                    {inv.status === "refunded" && inv.paidCents === 0 && (
                      <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive"
                        onClick={() => { setVoidReason(""); setVoiding(inv); }}>
                        {t("void")}
                      </Button>
                    )}
                  </div>
                </div>
                {expanded === inv.id && (
                  <div className="bg-muted/30 px-6 py-3 text-xs space-y-1">
                    {(inv.requiresOwnForm || inv.attachment) && (
                      <div className="mb-2 space-y-1 rounded-md border border-border/60 bg-background p-2">
                        <p className="font-medium">{t("form.title")}</p>
                        {inv.formNotes && (
                          <p className="whitespace-pre-line text-muted-foreground">
                            {t("form.notesTitle")} : {inv.formNotes}
                          </p>
                        )}
                        {inv.attachment ? (
                          <>
                            <p>
                              {t("form.fileLine", {
                                name: inv.attachment.fileName,
                                size: Math.max(1, Math.round(inv.attachment.size / 1024)),
                                date: new Date(inv.attachment.uploadedAt).toLocaleDateString("fr-CA"),
                              })}
                              {inv.attachment.scanStatus === "skipped" ? ` · ${t("form.notScanned")}` : ""}
                            </p>
                            {formStale(inv) && <p className="text-red-700">{t("form.staleBody")}</p>}
                            <div className="flex flex-wrap gap-3 pt-1">
                              <a
                                href={`/api/admin/organization-invoices/${inv.id}/attachment`}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <Download className="h-3.5 w-3.5" /> {t("form.download")}
                              </a>
                              {inv.attachmentEditable && (
                                <>
                                  <button className="text-primary hover:underline" onClick={() => setAttaching(inv)}>
                                    {t("form.replace")}
                                  </button>
                                  <button
                                    className="text-destructive hover:underline"
                                    disabled={busy === `removeForm-${inv.id}`}
                                    onClick={() => setRemovingForm(inv)}
                                  >
                                    {t("form.remove")}
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        ) : inv.attachmentEditable ? (
                          <button className="text-primary hover:underline" onClick={() => setAttaching(inv)}>
                            {t("form.attach")}
                          </button>
                        ) : null}
                      </div>
                    )}
                    {inv.lines.map((l) => (
                      <div key={l.appointmentId} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {formatCalendarDate(l.sessionDate, "fr-CA")} — {l.patientFullName}
                          {l.caseNumber ? ` (${l.caseNumber})` : ""} — {l.professionalName}
                        </span>
                        <span className="font-mono">{money(l.amountCents)}</span>
                      </div>
                    ))}
                    {inv.debitPending && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-900">
                        <p>
                          {t("debit.line", {
                            amount: money(inv.debitPending.amountCents),
                            date: new Date(inv.debitPending.since).toLocaleDateString("fr-CA"),
                          })}
                        </p>
                        <button
                          className="text-primary hover:underline"
                          disabled={busy === `debit_check-${inv.id}`}
                          onClick={() =>
                            void act(`debit_check-${inv.id}`, `/api/admin/organization-invoices/${inv.id}`, { action: "debit_check" }, (b) =>
                              setNotice(t(`debit.outcomes.${String(b.outcome ?? "processing")}`)),
                            )
                          }
                        >
                          {t("debit.check")}
                        </button>
                      </div>
                    )}
                    {inv.payments.length > 0 && (
                      <div className="pt-2">
                        <p className="font-medium">{t("paymentsTitle")}</p>
                        {inv.payments.map((p, i) => (
                          <div key={p.id ?? i} className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-muted-foreground">
                              {t("paymentLine", {
                                date: new Date(p.receivedAt).toLocaleDateString("fr-CA"),
                                amount: money(p.amountCents),
                                method: t(`methods.${p.method}`),
                                source: t(`sources.${p.source}`),
                              })}
                              {p.reference ? ` · ${p.reference}` : ""}
                              {p.refundedCents > 0 ? ` · ${t("refundedPart", { amount: money(p.refundedCents) })}` : ""}
                            </p>
                            {p.refundableCents > 0 && (
                              <button
                                className="text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                                disabled={Boolean(p.refundBlocked)}
                                title={p.refundBlocked ? t(`refund.blocked.${p.refundBlocked}`) : undefined}
                                onClick={() => openRefund(inv, p)}
                              >
                                {t("refund.open")}
                              </button>
                            )}
                          </div>
                        ))}
                        {inv.creditedCents > 0 && (
                          <p className="text-muted-foreground">{t("refund.creditLine", { amount: money(inv.creditedCents) })}</p>
                        )}
                      </div>
                    )}
                    {inv.refunds.length > 0 && (
                      <div className="pt-2">
                        <p className="font-medium">{t("refund.listTitle")}</p>
                        {inv.refunds.map((r) => (
                          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                            <p className={r.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                              {t("refund.line", {
                                date: new Date(r.refundedAt).toLocaleDateString("fr-CA"),
                                amount: money(r.amountCents),
                                via: r.via === "stripe" ? t("refund.viaStripeShort") : t(`methods.${r.method ?? "other"}`),
                                status: t(`refund.statuses.${r.status}`),
                              })}
                              {r.owed ? ` · ${t(`refund.owedShort.${r.owed}`)}` : ""}
                              {r.creditCents > 0 ? ` · ${t("refund.creditPart", { amount: money(r.creditCents) })}` : ""}
                              {r.reference ? ` · ${r.reference}` : ""}
                              {` · « ${r.reason} »`}
                            </p>
                            {r.via === "stripe" && (r.status === "requested" || r.status === "pending") && (
                              <button
                                className="text-primary hover:underline"
                                disabled={busy === `refund_check-${r.id}`}
                                onClick={() => void checkRefund(inv, r.id)}
                              >
                                {t("refund.check")}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {inv.number && inv.status !== "void" && (
                      <p className="pt-2 text-muted-foreground">
                        <span className="font-medium text-foreground">{t("remindersTitle")} : </span>
                        {[
                          inv.reminders.dueSentAt && t("reminderDue", { date: new Date(inv.reminders.dueSentAt).toLocaleDateString("fr-CA") }),
                          inv.reminders.followUpSentAt && t("reminderFollowUp", { date: new Date(inv.reminders.followUpSentAt).toLocaleDateString("fr-CA") }),
                          inv.reminders.overdueAlertSentAt && t("reminderTeam", { date: new Date(inv.reminders.overdueAlertSentAt).toLocaleDateString("fr-CA") }),
                        ]
                          .filter(Boolean)
                          .join(" · ") || t("remindersNone")}
                      </p>
                    )}
                    {inv.paymentEvents.length > 0 && (
                      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                        <p className="font-medium">{t("eventsTitle")}</p>
                        {inv.paymentEvents.map((e, i) => (
                          <p key={i}>
                            {new Date(e.at).toLocaleString("fr-CA")} — {e.detail}
                          </p>
                        ))}
                      </div>
                    )}
                    {inv.sendLog.length > 0 && (
                      <p className="pt-2 text-muted-foreground">
                        {inv.sendLog
                          .map(
                            (s) =>
                              `${t(`logKinds.${s.kind}`)} : ${t("sentTo", { date: new Date(s.at).toLocaleString("fr-CA"), to: s.to.join(", ") })}` +
                              (s.withForm
                                ? ` (${t("form.logWithForm")})`
                                : s.withoutOwnForm
                                  ? ` (${t("form.logWithoutForm")})`
                                  : ""),
                          )
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </section>

      {/* Send (hidden while the form is being attached, then back with it) */}
      <Dialog open={Boolean(sending) && !attaching} onOpenChange={(o) => !o && setSending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sendTitle")}</DialogTitle>
            <DialogDescription>
              {sending
                ? t("sendBody", {
                    org: sending.inv.organizationName,
                    patients: patients(sending.inv),
                    total: money(sending.inv.totalCents),
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("sendConsentNote")}</p>
          {sending && formBlocks(sending.inv) ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>
                {formStale(sending.inv)
                  ? t("form.staleBody")
                  : t("form.missingBody", { org: sending.inv.organizationName })}
              </p>
              {sending.inv.formNotes && (
                <p className="whitespace-pre-line text-xs">
                  {t("form.notesTitle")} : {sending.inv.formNotes}
                </p>
              )}
              <Button size="sm" variant="outline" className="gap-1 bg-background" onClick={() => setAttaching(sending.inv)}>
                <Paperclip className="h-3.5 w-3.5" /> {t("form.attach")}
              </Button>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={withoutForm}
                  onChange={(e) => setWithoutForm(e.target.checked)}
                />
                <span>{t("form.sendWithout")}</span>
              </label>
            </div>
          ) : sending?.inv.attachment ? (
            <p className="text-xs text-muted-foreground">{t("form.sendWithForm")}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSending(null)}>{t("cancel")}</Button>
            <Button
              disabled={
                !sending ||
                busy === `${sending.action}-${sending.inv.id}` ||
                (formBlocks(sending.inv) && !withoutForm)
              }
              onClick={async () => {
                if (!sending) return;
                const { inv, action } = sending;
                const skipForm = formBlocks(inv) && withoutForm;
                setSending(null);
                setWithoutForm(false);
                await invoiceAction(
                  inv,
                  { action, ...(skipForm ? { withoutOwnForm: true } : {}) },
                  () => setNotice(action === "resend" ? t("resent") : t("sentNotice")),
                );
              }}
            >
              <FileText className="mr-1 h-4 w-4" /> {sending?.action === "resend" ? t("resend") : t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The organization's own form */}
      <OrganizationFormDialog
        target={
          attaching
            ? { id: attaching.id, organizationName: attaching.organizationName, formNotes: attaching.formNotes }
            : null
        }
        onClose={() => setAttaching(null)}
        onAttached={(invoice) => {
          const fresh = invoice as Invoice | undefined;
          setAttaching(null);
          setNotice(t("form.attachedNotice"));
          // Back in the send dialog, now with the form.
          if (fresh && sending?.inv.id === fresh.id) {
            setSending({ ...sending, inv: fresh });
            setWithoutForm(false);
          }
          load();
        }}
      />

      {/* Refund a payment */}
      {refunding && (
        <OrganizationRefundDialog
          key={refunding.n}
          target={refunding.target}
          onClose={() => setRefunding(null)}
          onDone={(_invoice, message) => {
            setRefunding(null);
            setNotice(message);
            load();
          }}
        />
      )}

      {/* Remove the form */}
      <Dialog open={Boolean(removingForm)} onOpenChange={(o) => !o && setRemovingForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("form.removeTitle")}</DialogTitle>
            <DialogDescription>{t("form.removeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingForm(null)}>{t("cancel")}</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!removingForm) return;
                const inv = removingForm;
                setRemovingForm(null);
                await removeForm(inv);
              }}
            >
              {t("form.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Consent missing */}
      <Dialog open={blocked !== null} onOpenChange={(o) => !o && setBlocked(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("blockedTitle")}</DialogTitle>
            <DialogDescription>{t("blockedBody")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {(blocked ?? []).map((b) => (
              <li key={b.appointmentId}>
                {b.patientFullName} — {formatCalendarDate(b.sessionDate, "fr-CA")}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setBlocked(null)}>{t("ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void / discard */}
      <Dialog open={Boolean(voiding)} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{voiding?.status === "draft" ? t("discardTitle") : t("voidTitle")}</DialogTitle>
            <DialogDescription>{voiding?.status === "draft" ? t("discardBody") : t("voidBody")}</DialogDescription>
          </DialogHeader>
          {voiding?.status !== "draft" && (
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={t("voidReason")} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>{t("cancel")}</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!voiding) return;
                const inv = voiding;
                setVoiding(null);
                await invoiceAction(inv, { action: "void", reason: voidReason });
              }}
            >
              {voiding?.status === "draft" ? t("discard") : t("void")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment received */}
      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("payTitle")}</DialogTitle>
            <DialogDescription>
              {paying ? t("payBody", { number: paying.number ?? "", balance: money(paying.balanceCents) }) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("payAmount")}</Label>
              <Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("payMethod")}</Label>
              <Select value={pay.method} onValueChange={(v) => setPay({ ...pay, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAY_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{t(`methods.${m}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("payReference")}</Label>
              <Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("payDate")}</Label>
              <Input type="date" value={pay.receivedOn} onChange={(e) => setPay({ ...pay, receivedOn: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("payReceiptNote")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>{t("cancel")}</Button>
            <Button
              onClick={async () => {
                if (!paying) return;
                const inv = paying;
                const ok = await invoiceAction(inv, { action: "pay", ...pay, receivedOn: pay.receivedOn || null });
                if (ok) setPaying(null);
              }}
            >
              {t("recordPayment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
