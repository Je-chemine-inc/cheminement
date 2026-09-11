"use client";

import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { needsOwedChoice, overpaidPartCents } from "@/lib/organization-invoice-money";

const OUTSIDE_METHODS = ["interac", "cheque", "eft", "other"] as const;

export interface RefundTarget {
  invoice: { id: string; number: string | null; status: string; balanceCents: number; organizationName: string };
  payment: {
    id: string;
    amountCents: number;
    refundedCents: number;
    refundableCents: number;
    method: string;
    receivedAt: string;
    refundVia: "stripe" | "outside";
  };
}

const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} $`;
const toCents = (dollars: string) => {
  const n = Number(dollars.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

/** What is left to refund, or just the overpayment when the invoice was overpaid. */
function presetAmount(target: RefundTarget): string {
  const overpaid = Math.max(0, -target.invoice.balanceCents);
  const cents = overpaid > 0 ? Math.min(overpaid, target.payment.refundableCents) : target.payment.refundableCents;
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Refund one payment of an organization. The admin says whether the money is
 * still owed (the balance comes back, reminders resume) or no longer owed (a
 * credit is recorded). A card is refunded through Stripe; anything else is
 * recorded as refunded outside the platform.
 *
 * Mounted for one refund at a time (the page keys it): each opening starts
 * clean, with its own request key.
 */
export function OrganizationRefundDialog({
  target,
  onClose,
  onDone,
}: {
  target: RefundTarget;
  onClose: () => void;
  onDone: (invoice: unknown, notice: string) => void;
}) {
  const t = useTranslations("AdminDashboard.orgInvoices.refund");
  const tm = useTranslations("AdminDashboard.orgInvoices.methods");
  // The same click twice refunds once: the server keys the refund on this.
  const [requestKey] = useState(newKey);
  const [amount, setAmount] = useState(() => presetAmount(target));
  const [owed, setOwed] = useState<"still" | "no_longer" | "">("");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [method, setMethod] = useState<string>("interac");
  const [reference, setReference] = useState("");
  const [refundedOn, setRefundedOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { invoice, payment } = target;
  const cents = toCents(amount);
  const valid = Number.isInteger(cents) && cents > 0 && cents <= payment.refundableCents;
  const overpaid = valid ? overpaidPartCents(cents, invoice.balanceCents) : 0;
  const choice = valid && needsOwedChoice({ amountCents: cents, balanceBeforeCents: invoice.balanceCents, invoiceStatus: invoice.status });
  const outside = payment.refundVia === "outside";
  const ready = valid && reason.trim().length > 0 && (!choice || owed !== "") && !busy;

  const errorText = (body: { code?: string; error?: string; details?: { refundableCents?: number } }) =>
    body.code === "REFUND_TOO_LARGE" && typeof body.details?.refundableCents === "number"
      ? t("errors.REFUND_TOO_LARGE", { amount: money(body.details.refundableCents) })
      : body.code && t.has(`errors.${body.code}`) && body.code !== "REFUND_TOO_LARGE"
        ? t(`errors.${body.code}`)
        : (body.error ?? t("errors.FAILED"));

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/organization-invoices/${invoice.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refund",
        paymentId: payment.id,
        amount: (cents / 100).toFixed(2),
        ...(choice ? { owed } : {}),
        reason: reason.trim(),
        requestKey,
        notify,
        ...(outside ? { method, reference: reference.trim() || undefined, refundedOn: refundedOn || null } : {}),
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(errorText(body));
      return;
    }
    onDone(body.invoice, outside ? t("recordedNotice") : t("refundedNotice"));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title", { number: invoice.number ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("paymentLine", {
              date: new Date(payment.receivedAt).toLocaleDateString("fr-CA"),
              amount: money(payment.amountCents),
              method: tm.has(payment.method) ? tm(payment.method) : payment.method,
            })}
            {payment.refundedCents > 0 ? ` · ${t("alreadyRefunded", { amount: money(payment.refundedCents) })}` : ""}
            {" · "}
            {t("refundable", { amount: money(payment.refundableCents) })}
          </DialogDescription>
        </DialogHeader>

        <p
          className={`rounded-md border p-3 text-sm ${
            outside ? "border-border/60 bg-muted/40" : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {outside ? t("viaOutside") : payment.method === "pad" ? t("viaStripePad") : t("viaStripe")}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="refund-amount">{t("amount")}</Label>
          <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {!valid && amount.trim() !== "" && (
            <p className="text-xs text-destructive">{t("amountInvalid", { amount: money(payment.refundableCents) })}</p>
          )}
          {valid && overpaid > 0 && <p className="text-xs text-muted-foreground">{t("overpaidPart", { amount: money(overpaid) })}</p>}
        </div>

        {choice && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("owedQuestion")}</legend>
            <label className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-sm">
              <input type="radio" name="owed" className="mt-1" checked={owed === "still"} onChange={() => setOwed("still")} />
              <span>
                <span className="font-medium">{t("owedStill")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("owedStillHelp", { balance: money(invoice.balanceCents + cents) })}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-sm">
              <input type="radio" name="owed" className="mt-1" checked={owed === "no_longer"} onChange={() => setOwed("no_longer")} />
              <span>
                <span className="font-medium">{t("owedNoLonger")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("owedNoLongerHelp", {
                    credit: money(cents - overpaid),
                    balance: money(Math.max(0, invoice.balanceCents + overpaid)),
                  })}
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {outside && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("method")}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTSIDE_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {tm(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-date">{t("date")}</Label>
              <Input id="refund-date" type="date" value={refundedOn} onChange={(e) => setRefundedOn(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="refund-reference">{t("reference")}</Label>
              <Input id="refund-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="refund-reason">{t("reason")}</Label>
          <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>{t("notify")}</span>
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant={outside ? "default" : "destructive"} disabled={!ready} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1 h-4 w-4" />}
            {outside ? t("submitOutside") : t("submitStripe", { amount: valid ? money(cents) : "" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
