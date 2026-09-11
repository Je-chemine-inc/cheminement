"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
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

type Status = "draft" | "issuing" | "sent" | "partially_paid" | "paid" | "overdue" | "void" | "refunded";
const FILTERS = ["open", "draft", "sent", "overdue", "partially_paid", "paid", "void"] as const;
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
  balanceCents: number;
  issuedAt: string | null;
  dueAt: string | null;
  billToEmails: string[];
  lines: Line[];
  sendLog: { at: string; to: string[]; kind: string }[];
}
interface Unbilled {
  organizationId: string;
  organizationName: string;
  sessions: number;
  totalCents: number;
  oldest: string | null;
  billingCycle: "per_session" | "monthly";
  hasBillingEmail: boolean;
}
type Blocked = { appointmentId: string; patientFullName: string; sessionDate: string };

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

  const [sending, setSending] = useState<Invoice | null>(null);
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [pay, setPay] = useState({ amount: "", method: "cheque", reference: "", receivedOn: "" });

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

  const act = async (key: string, url: string, body: unknown, onDone?: (b: Record<string, unknown>) => void) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const r = await call(url, { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) {
      if (r.body?.code === "CONSENT_MISSING") setBlocked(r.body?.details?.blocked ?? []);
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
    act(`${body.action}-${inv.id}`, `/api/admin/organization-invoices/${inv.id}`, body, done);

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
                      </span>
                      <span className="block text-sm">{inv.organizationName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {inv.kind === "statement" ? t("statementOf", { period: inv.periodKey ?? "" }) : t("sessionInvoice")}
                        {" · "}
                        {t("linesCount", { count: inv.lines.length })}
                        {" · "}
                        {money(inv.totalCents)}
                        {inv.paidCents > 0 ? ` · ${t("balance", { amount: money(inv.balanceCents) })}` : ""}
                        {inv.dueAt ? ` · ${t("due", { date: new Date(inv.dueAt).toLocaleDateString("fr-CA") })}` : ""}
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => openPdf(inv)}>
                      <Eye className="h-3.5 w-3.5" /> PDF
                    </Button>
                    {inv.status === "draft" && (
                      <>
                        <Button size="sm" variant="outline" className="h-8" disabled={busy === `refresh-${inv.id}`}
                          onClick={() => invoiceAction(inv, { action: "refresh" }, () => setNotice(t("refreshed")))}>
                          {t("refreshDraft")}
                        </Button>
                        <Button size="sm" className="h-8 gap-1" onClick={() => setSending(inv)}>
                          <Send className="h-3.5 w-3.5" /> {t("send")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive"
                          onClick={() => { setVoidReason(""); setVoiding(inv); }}>
                          {t("discard")}
                        </Button>
                      </>
                    )}
                    {inv.status === "issuing" && (
                      <Button size="sm" className="h-8 gap-1" onClick={() => setSending(inv)}>
                        <Send className="h-3.5 w-3.5" /> {t("retrySend")}
                      </Button>
                    )}
                    {["sent", "overdue", "partially_paid"].includes(inv.status) && (
                      <>
                        <Button size="sm" variant="outline" className="h-8" disabled={busy === `resend-${inv.id}`}
                          onClick={() => invoiceAction(inv, { action: "resend" }, () => setNotice(t("resent")))}>
                          {t("resend")}
                        </Button>
                        <Button size="sm" className="h-8" onClick={() => {
                          setPay({ amount: (inv.balanceCents / 100).toFixed(2), method: "cheque", reference: "", receivedOn: "" });
                          setPaying(inv);
                        }}>
                          {t("recordPayment")}
                        </Button>
                        {inv.paidCents === 0 && (
                          <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive"
                            onClick={() => { setVoidReason(""); setVoiding(inv); }}>
                            {t("void")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {expanded === inv.id && (
                  <div className="bg-muted/30 px-6 py-3 text-xs space-y-1">
                    {inv.lines.map((l) => (
                      <div key={l.appointmentId} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {formatCalendarDate(l.sessionDate, "fr-CA")} — {l.patientFullName}
                          {l.caseNumber ? ` (${l.caseNumber})` : ""} — {l.professionalName}
                        </span>
                        <span className="font-mono">{money(l.amountCents)}</span>
                      </div>
                    ))}
                    {inv.sendLog.length > 0 && (
                      <p className="pt-2 text-muted-foreground">
                        {inv.sendLog
                          .map((s) => t("sentTo", { date: new Date(s.at).toLocaleString("fr-CA"), to: s.to.join(", ") }))
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

      {/* Send */}
      <Dialog open={Boolean(sending)} onOpenChange={(o) => !o && setSending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sendTitle")}</DialogTitle>
            <DialogDescription>
              {sending
                ? t("sendBody", {
                    org: sending.organizationName,
                    patients: patients(sending),
                    total: money(sending.totalCents),
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("sendConsentNote")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSending(null)}>{t("cancel")}</Button>
            <Button
              disabled={busy === `send-${sending?.id}`}
              onClick={async () => {
                if (!sending) return;
                const inv = sending;
                setSending(null);
                await invoiceAction(inv, { action: "send" }, () => setNotice(t("sentNotice")));
              }}
            >
              <FileText className="mr-1 h-4 w-4" /> {t("send")}
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
