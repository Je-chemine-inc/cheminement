"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppointmentResponse } from "@/types/api";

const DURATION_OPTIONS = [30, 50, 60, 90, 120];
const TYPE_OPTIONS = ["video", "in-person", "phone"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

// 15-minute start-time slots (06:00–23:00). A controlled <Select> replaces the
// native <input type="time">, whose clock dialog mis-behaves / gets clipped on
// some browsers ("l'horloge se dérègle"). Mirrors ProfessionalBookAppointmentModal.
const BASE_TIME_OPTIONS: string[] = (() => {
  const slots: string[] = [];
  for (let minutes = 6 * 60; minutes <= 23 * 60; minutes += 15) {
    slots.push(`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`);
  }
  return slots;
})();

/**
 * Shared appointment edit / reschedule / cancel dialog used by both the admin
 * per-professional calendar and the professional's own agenda. Mount it with a
 * `key` of the appointment id (only while an appointment is selected) so its
 * fields seed from props via useState initializers — no setState-in-effect.
 *
 * `apiBase` is the REST collection the dialog talks to:
 *   - "/api/admin/appointments"        (admin acting on a pro's behalf)
 *   - "/api/professional/appointments" (professional editing their own)
 * Both expose PATCH (edit) and DELETE (cancel) on `${apiBase}/${id}`.
 */
export function AppointmentEditDialog({
  appointment,
  apiBase,
  onClose,
  onSaved,
  sessionHref,
}: {
  appointment: AppointmentResponse;
  apiBase: string;
  onClose: () => void;
  onSaved: () => void;
  /** Optional link to the full session page (professional context). */
  sessionHref?: string;
}) {
  const t = useTranslations("AppointmentEditDialog");

  const initialDate = useMemo(() => {
    if (!appointment.date) return "";
    const d = new Date(appointment.date);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, [appointment.date]);

  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(appointment.time ?? "");
  // Keep an off-grid existing time (e.g. "09:13") selectable so the Select can
  // still display the appointment's current value.
  const timeOptions = useMemo(
    () =>
      time && !BASE_TIME_OPTIONS.includes(time)
        ? [...BASE_TIME_OPTIONS, time].sort()
        : BASE_TIME_OPTIONS,
    [time],
  );
  const [duration, setDuration] = useState(appointment.duration || 50);
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>(
    (TYPE_OPTIONS as readonly string[]).includes(appointment.type)
      ? (appointment.type as (typeof TYPE_OPTIONS)[number])
      : "video",
  );
  const [location, setLocation] = useState(appointment.location ?? "");
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const [meetingLink, setMeetingLink] = useState(appointment.meetingLink ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCancel =
    appointment.status === "scheduled" || appointment.status === "pending";

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only send fields actually touched; never resend an unchanged date
      // (avoids storage round-trip drift across timezones).
      const body: Record<string, unknown> = {
        duration,
        type,
        notes: notes.trim() || null,
        meetingLink: meetingLink.trim() || null,
        location: type === "in-person" ? location.trim() || null : null,
      };
      if (date && date !== initialDate) body.date = date;
      if (time && time !== appointment.time) body.time = time;

      const res = await fetch(`${apiBase}/${appointment._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(
          res.status === 409
            ? t("conflictError")
            : res.status === 400
              ? t("pastError")
              : t("errorGeneric"),
        );
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError(t("errorGeneric"));
      setSaving(false);
    }
  };

  const handleCancelAppointment = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${appointment._id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(t("errorGeneric"));
        setCancelling(false);
        return;
      }
      onSaved();
    } catch {
      setError(t("errorGeneric"));
      setCancelling(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription>
            {appointment.clientId?.firstName} {appointment.clientId?.lastName}
            {" · "}
            {t(`statuses.${appointment.status}`)}
            {" · "}
            {t(`paymentStatus.${appointment.payment?.status ?? "pending"}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
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
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger>
                  <SelectValue placeholder="--:--" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {timeOptions.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                      {t("minutes", { count: d })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("typeLabel")}</Label>
              <Select
                value={type}
                onValueChange={(v) =>
                  setType(v as (typeof TYPE_OPTIONS)[number])
                }
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

          {type === "in-person" && (
            <div className="space-y-2">
              <Label>{t("locationLabel")}</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t("locationPlaceholder")}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("meetingLinkLabel")}</Label>
            <Input
              type="url"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              placeholder={t("meetingLinkPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("notesLabel")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesPlaceholder")}
              className="min-h-[70px]"
              maxLength={1000}
            />
          </div>

          {sessionHref && (
            <Link
              href={sessionHref}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              {t("viewSession")}
            </Link>
          )}

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {confirmCancel && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-3">
              <p className="text-sm text-foreground">{t("cancelConfirmBody")}</p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelAppointment}
                  disabled={cancelling}
                >
                  {cancelling ? t("cancelling") : t("cancelConfirmYes")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmCancel(false)}
                  disabled={cancelling}
                >
                  {t("cancelConfirmNo")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div>
            {canCancel && !confirmCancel && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive gap-2"
                onClick={() => setConfirmCancel(true)}
                disabled={saving}
              >
                <Trash2 className="h-4 w-4" />
                {t("cancelAppointment")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving || cancelling}
            >
              {t("close")}
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={handleSave}
              disabled={saving || cancelling}
            >
              <Pencil className="h-4 w-4" />
              {saving ? t("saving") : t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
