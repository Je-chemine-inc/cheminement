"use client";

/**
 * Spec 002 — who pays for one session, in the admin patient file.
 *
 * Before closure the admin can pre-choose the payer (closure honours it);
 * after closure they can change it, which recomputes the amounts — so that
 * path asks for confirmation. Hidden entirely without manageBilling.
 */
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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

type Payer = "organization" | "client" | "external";
const PAYERS: Payer[] = ["organization", "client", "external"];

export interface AppointmentPayerSummary {
  kind: Payer;
  state: "confirmed" | "awaiting_decision";
  reason: string;
  orgAmount: number;
  caseNumber: string | null;
  onOrganizationInvoice: boolean;
}

export function AppointmentPayerControl({
  appointmentId,
  closed,
  payer,
  billingOverride,
  canManage,
  onChanged,
}: {
  appointmentId: string;
  closed: boolean;
  payer: AppointmentPayerSummary | null;
  billingOverride: Payer | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("AdminDashboard.payer");
  const [pending, setPending] = useState<Payer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const badge = payer ? (
    payer.state === "awaiting_decision" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        <AlertCircle className="h-3 w-3" />
        {t("awaitingDecision")}
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
        {t(`paidBy.${payer.kind}`)}
        {payer.kind === "organization" && payer.orgAmount > 0
          ? ` · ${payer.orgAmount.toFixed(2)} $`
          : ""}
      </span>
    )
  ) : !closed && billingOverride ? (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {t("planned", { payer: t(`payers.${billingOverride}`) })}
    </span>
  ) : null;

  if (!canManage) return badge;

  const submit = async (choice: Payer | "auto") => {
    setSubmitting(true);
    setError(null);
    try {
      const res = closed
        ? await fetch(`/api/admin/appointments/${appointmentId}/payer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payer: choice }),
          })
        : await fetch(`/api/admin/appointments/${appointmentId}/billing-override`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payer: choice === "auto" ? null : choice }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setPending(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const current = closed ? payer?.kind : billingOverride ?? "auto";

  return (
    <div className="flex flex-col gap-1">
      {badge}
      {!payer?.onOrganizationInvoice && (
        <Select
          value={current ?? ""}
          onValueChange={(v) => {
            if (closed) {
              setError(null);
              setPending(v as Payer);
            } else {
              void submit(v as Payer | "auto");
            }
          }}
          disabled={submitting}
        >
          <SelectTrigger className="h-7 w-40 text-xs">
            <SelectValue placeholder={t("choose")} />
          </SelectTrigger>
          <SelectContent>
            {!closed && <SelectItem value="auto">{t("auto")}</SelectItem>}
            {PAYERS.map((p) => (
              <SelectItem key={p} value={p}>{t(`payers.${p}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {error && !pending && <span className="text-xs text-destructive">{error}</span>}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>
              {pending ? t(`confirmBody.${pending}`) : ""}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button onClick={() => pending && submit(pending)} disabled={submitting}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
