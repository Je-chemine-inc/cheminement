"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { SESSION_ACT_NATURE_VALUES } from "@/lib/session-closure";
import type { BookableClient } from "@/components/appointments/ProfessionalBookAppointmentModal";
import type { AppointmentResponse } from "@/types/api";

export type ManualInvoiceContext = {
  /** Empty-slot entry point: selected day (YYYY-MM-DD) and optional hour (HH:00). */
  date?: string;
  time?: string;
  /** Existing-appointment entry point. */
  appointment?: AppointmentResponse | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionalId: string;
  professionalName: string;
  clients: BookableClient[];
  context: ManualInvoiceContext | null;
  /** Called after a successful generation so the parent can refresh + close. */
  onGenerated?: () => void;
};

/**
 * Admin-only manual invoice/receipt generator, launched from the professional
 * schedule (empty slot or existing appointment).
 *
 * Spec part 2 — the contextual form ("le gabarit"): pre-filled from the calendar
 * (date/time, professional, and client when tied to an appointment), with the
 * service nature reusing the "terminer la rencontre" options and an amount to
 * bill. The issuance behaviour (what "Générer" produces, PDF/email) is wired in
 * a later step and will reuse the receipt-PDF + invoice-number pipeline.
 */
export function ManualInvoiceModal({
  open,
  onOpenChange,
  professionalId,
  professionalName,
  clients,
  context,
  onGenerated,
}: Props) {
  const t = useTranslations("AdminDashboard.manualInvoice");
  const tActs = useTranslations("Dashboard.sessions.sessionClosure");

  const appointment = context?.appointment ?? null;
  const lockedClient = appointment?.clientId ?? null;

  const [submitting, setSubmitting] = useState<null | "request" | "paid">(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from the calendar context. The parent remounts this modal with a
  // `key` per open, so these lazy initializers pick up the right context
  // without a setState-in-effect (no cascading renders).
  const [date, setDate] = useState(
    appointment?.date
      ? appointment.date.split("T")[0]
      : (context?.date ?? ""),
  );
  const [time, setTime] = useState(appointment?.time ?? context?.time ?? "");
  const [clientId, setClientId] = useState(appointment?.clientId?._id ?? "");
  const [act, setAct] = useState("");
  const [actOther, setActOther] = useState("");
  const [amount, setAmount] = useState(
    appointment?.payment?.price != null ? String(appointment.payment.price) : "",
  );

  const lockedClientName = lockedClient
    ? `${lockedClient.firstName ?? ""} ${lockedClient.lastName ?? ""}`.trim()
    : "";

  const effectiveClientId = lockedClient?._id ?? clientId;
  const numericAmount = Number(amount);
  const canSubmit =
    Boolean(effectiveClientId) &&
    Boolean(date) &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    submitting === null;

  const handleSubmit = async (action: "request" | "paid") => {
    if (!canSubmit) {
      setError(t("validationError"));
      return;
    }
    setSubmitting(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/manual-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          professionalId,
          clientId: effectiveClientId,
          appointmentId: appointment?._id,
          date,
          time,
          serviceAct: act || undefined,
          serviceOther: actOther.trim() || undefined,
          amount: numericAmount,
          action,
        }),
      });
      if (!res.ok) throw new Error();
      onGenerated?.();
    } catch {
      setError(t("error"));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: professionalName || "—" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date + Time */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("dateLabel")}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("timeLabel")}</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          {/* Professional (read-only — the schedule being viewed) */}
          <div className="space-y-2">
            <Label>{t("professionalLabel")}</Label>
            <Input value={professionalName} readOnly disabled />
          </div>

          {/* Client — locked when tied to an existing appointment */}
          <div className="space-y-2">
            <Label>{t("clientLabel")}</Label>
            {lockedClient ? (
              <Input value={lockedClientName} readOnly disabled />
            ) : (
              <Select value={clientId || undefined} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("clientPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.email ? ` — ${c.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Service nature / reason — reuses the "terminer la rencontre" options */}
          <div className="space-y-2">
            <Label>{t("serviceLabel")}</Label>
            <Select value={act || undefined} onValueChange={setAct}>
              <SelectTrigger>
                <SelectValue placeholder={t("servicePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {SESSION_ACT_NATURE_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {tActs(`acts.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-normal text-muted-foreground">
              {t("serviceOtherLabel")}
            </Label>
            <Input
              value={actOther}
              onChange={(e) => setActOther(e.target.value)}
              placeholder={t("serviceOtherPlaceholder")}
              maxLength={200}
            />
          </div>

          {/* Amount to bill */}
          <div className="space-y-2">
            <Label>{t("amountLabel")}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("amountPlaceholder")}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button
            type="button"
            onClick={() => handleSubmit("request")}
            disabled={!canSubmit}
            className="w-full gap-2"
          >
            {submitting === "request" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {t("requestButton")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleSubmit("paid")}
            disabled={!canSubmit}
            className="w-full gap-2"
          >
            {submitting === "paid" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {t("paidButton")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("paidHint")}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting !== null}
            className="w-full"
          >
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
