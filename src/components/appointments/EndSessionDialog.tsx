"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appointmentsAPI } from "@/lib/api-client";
import type { AppointmentResponse } from "@/types/api";
import {
  SESSION_ACT_NATURE_VALUES,
  SESSION_OUTCOME_VALUES,
} from "@/lib/session-closure";

type EndSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  onCompleted: (apt: AppointmentResponse) => void;
};

export function EndSessionDialog({
  open,
  onOpenChange,
  appointmentId,
  onCompleted,
}: EndSessionDialogProps) {
  const t = useTranslations("Dashboard.sessions.sessionClosure");
  const [act, setAct] = useState("");
  const [actOther, setActOther] = useState("");
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAct("");
      setActOther("");
      setOutcome("");
    }
  }, [open, appointmentId]);

  const handleSubmit = async () => {
    if (!act || !outcome) return;

    try {
      setSaving(true);
      const payload: {
        sessionActNature: string;
        sessionActNatureOther?: string;
        sessionOutcome: string;
      } = {
        sessionActNature: act,
        sessionOutcome: outcome,
      };
      if (actOther.trim()) {
        payload.sessionActNatureOther = actOther.trim();
      }
      const apt = await appointmentsAPI.completeSession(appointmentId, payload);
      onCompleted(apt);
      onOpenChange(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = Boolean(act && outcome) && !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("outcomeLabel")}</Label>
            <Select value={outcome || undefined} onValueChange={setOutcome}>
              <SelectTrigger>
                <SelectValue placeholder={t("outcomePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {SESSION_OUTCOME_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`outcomes.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("actNatureLabel")}</Label>
            <Select value={act || undefined} onValueChange={setAct}>
              <SelectTrigger>
                <SelectValue placeholder={t("actPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {SESSION_ACT_NATURE_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`acts.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-normal text-muted-foreground">
              {t("actNatureOtherLabel")}
            </Label>
            <Input
              value={actOther}
              onChange={(e) => setActOther(e.target.value)}
              placeholder={t("actNatureOtherPlaceholder")}
              maxLength={200}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? t("saving") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
