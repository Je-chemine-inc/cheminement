"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DURATION_OPTIONS = [30, 50, 60, 90];
const TYPE_OPTIONS = ["video", "in-person", "phone"] as const;
type AppointmentType = (typeof TYPE_OPTIONS)[number];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionalName: string;
  defaultDuration?: number;
  onCreated?: () => void;
}

export function RequestNextAppointmentModal({
  open,
  onOpenChange,
  professionalName,
  defaultDuration,
  onCreated,
}: Props) {
  const t = useTranslations(
    "Client.appointments.requestWithCurrentProModal",
  );

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(defaultDuration ?? 60);
  const [type, setType] = useState<AppointmentType>("video");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedOk, setSubmittedOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate("");
    setTime("");
    setDuration(defaultDuration ?? 60);
    setType("video");
    setNotes("");
    setSaving(false);
    setErrorMsg(null);
    setSubmittedOk(false);
  }, [open, defaultDuration]);

  const canSubmit = Boolean(date) && Boolean(time) && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/appointments/request-with-current-pro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          duration,
          type,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "PHONE_NOT_VERIFIED") {
          throw new Error(t("errorPhoneNotVerified"));
        }
        throw new Error(data.error || t("errorGeneric"));
      }
      setSubmittedOk(true);
      onCreated?.();
      setTimeout(() => {
        onOpenChange(false);
      }, 1800);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("subtitle", { pro: professionalName })}
          </DialogDescription>
        </DialogHeader>

        {submittedOk ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600 mb-3" />
            <h3 className="text-lg font-medium text-foreground">
              {t("successTitle")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("successBody")}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("durationLabel")}</Label>
                  <Select
                    value={String(duration)}
                    onValueChange={(v) => setDuration(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {t("minutesValue", { count: d })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("typeLabel")}</Label>
                  <Select
                    value={type}
                    onValueChange={(v) => setType(v as AppointmentType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((tp) => (
                        <SelectItem key={tp} value={tp}>
                          {t(`types.${tp}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("notesLabel")}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("notesPlaceholder")}
                  rows={3}
                />
              </div>

              {errorMsg && (
                <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-200">
                  {errorMsg}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? t("submitting") : t("submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
