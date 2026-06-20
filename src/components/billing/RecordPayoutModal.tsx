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
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionalId: string;
  professionalName: string;
  /** Called after a payout is recorded so the parent can refresh + close. */
  onRecorded?: () => void;
};

/**
 * Admin-only "record an external payment" form. The admin pays the professional
 * outside the platform (Interac / bank transfer) and logs it here so both the
 * admin and the pro can track it — the entry surfaces in the pro's
 * "Historique des paiements" as a "Versement reçu". Posts to the existing
 * /api/admin/accounting/payout-debit (a ledger debit, paymentChannel "none").
 */
export function RecordPayoutModal({
  open,
  onOpenChange,
  professionalId,
  professionalName,
  onRecorded,
}: Props) {
  const t = useTranslations("AdminDashboard.recordPayout");

  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericAmount = Number(amount);
  const canSubmit =
    Number.isFinite(numericAmount) && numericAmount > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError(t("validationError"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/accounting/payout-debit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          professionalId,
          payoutAmountCad: numericAmount,
          payoutReference: reference.trim() || undefined,
          payoutNotes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      onRecorded?.();
    } catch {
      setError(t("error"));
    } finally {
      setSubmitting(false);
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

          <div className="space-y-2">
            <Label>{t("referenceLabel")}</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("referencePlaceholder")}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("notesLabel")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesPlaceholder")}
              maxLength={300}
            />
          </div>

          <p className="text-xs text-muted-foreground">{t("hint")}</p>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full gap-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("submit")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="w-full"
          >
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
