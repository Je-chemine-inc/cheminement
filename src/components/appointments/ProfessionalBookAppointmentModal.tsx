"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSession } from "next-auth/react";
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
import type { AppointmentResponse } from "@/types/api";
import { useMotifs, pickMotifLabel } from "@/hooks/useMotifs";

export type BookableClient = {
  id: string;
  name: string;
  email?: string;
};

export type BookableProfessional = {
  id: string;
  name: string;
  email?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: BookableClient[];
  defaultClientId?: string;
  onCreated?: (apt: AppointmentResponse) => void;
  /**
   * When provided, the modal switches to admin mode:
   *  - shows a professional picker (defaulted to `defaultProfessionalId`)
   *  - posts to `/api/admin/appointments` with explicit `professionalId`
   * When omitted, the modal stays in pro mode and posts on behalf of the
   * logged-in professional (original behavior).
   */
  professionals?: BookableProfessional[];
  defaultProfessionalId?: string;
  /** Optional slot prefill (e.g. when opened from a calendar cell click). */
  defaultDate?: string;
  defaultTime?: string;
};

const DURATION_OPTIONS = [30, 50, 60, 90];
const TYPE_OPTIONS = ["video", "in-person", "phone"] as const;

export function ProfessionalBookAppointmentModal({
  open,
  onOpenChange,
  clients,
  defaultClientId,
  onCreated,
  professionals,
  defaultProfessionalId,
  defaultDate,
  defaultTime,
}: Props) {
  const t = useTranslations("Dashboard.bookAppointmentModal");
  const locale = useLocale();
  const { data: authSession } = useSession();
  const { motifs, loading: motifsLoading } = useMotifs();

  const isAdminMode = Array.isArray(professionals);

  const [clientId, setClientId] = useState<string>("");
  const [clientSearch, setClientSearch] = useState("");
  const [professionalId, setProfessionalId] = useState<string>("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number>(50);
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>("video");
  const [motifLabel, setMotifLabel] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ?? "");
    setClientSearch("");
    setProfessionalId(defaultProfessionalId ?? "");
    setDate(defaultDate ?? "");
    setTime(defaultTime ?? "");
    setDuration(50);
    setType("video");
    setMotifLabel("");
    setLocation("");
    setNotes("");
    setSaving(false);
    setErrorMsg(null);
  }, [open, defaultClientId, defaultProfessionalId, defaultDate, defaultTime]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [clients, clientSearch]);

  const lockedClient = useMemo(() => {
    if (!defaultClientId) return null;
    return clients.find((c) => c.id === defaultClientId) ?? null;
  }, [clients, defaultClientId]);

  const canSubmit =
    Boolean(clientId) &&
    Boolean(date) &&
    Boolean(time) &&
    Boolean(motifLabel) &&
    (!isAdminMode || Boolean(professionalId)) &&
    !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      if (isAdminMode) {
        const res = await fetch("/api/admin/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            professionalId,
            date,
            time,
            duration,
            type,
            motif: motifLabel,
            notes: notes.trim() || undefined,
            location:
              type === "in-person" ? location.trim() || undefined : undefined,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || t("genericError"));
        }
        const apt = (await res.json()) as AppointmentResponse;
        onCreated?.(apt);
        onOpenChange(false);
        return;
      }

      const sessionProId = authSession?.user?.id;
      if (!sessionProId) {
        setErrorMsg(t("genericError"));
        setSaving(false);
        return;
      }
      const res = await fetch("/api/professional/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          date,
          time,
          duration,
          type,
          motif: motifLabel,
          notes: notes.trim() || undefined,
          location:
            type === "in-person" ? location.trim() || undefined : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t("genericError"));
      }
      const apt = (await res.json()) as AppointmentResponse;
      onCreated?.(apt);
      onOpenChange(false);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
          {/* Client */}
          <div className="space-y-2">
            <Label>{t("clientLabel")}</Label>
            {lockedClient ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <div className="font-medium">{lockedClient.name}</div>
                {lockedClient.email ? (
                  <div className="text-xs text-muted-foreground">
                    {lockedClient.email}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder={t("clientSearchPlaceholder")}
                />
                <Select
                  value={clientId || undefined}
                  onValueChange={setClientId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("clientPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredClients.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {t("noClients")}
                      </div>
                    ) : (
                      filteredClients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.email ? ` — ${c.email}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {/* Professional (admin mode only) */}
          {isAdminMode && professionals ? (
            <div className="space-y-2">
              <Label>{t("professionalLabel")}</Label>
              <Select
                value={professionalId || undefined}
                onValueChange={setProfessionalId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("professionalPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {professionals.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {t("noProfessionals")}
                    </div>
                  ) : (
                    professionals.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.email ? ` — ${p.email}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Date + Time */}
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

          {/* Duration + Type */}
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
                onValueChange={(v) => setType(v as (typeof TYPE_OPTIONS)[number])}
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

          {/* Service / Motif */}
          <div className="space-y-2">
            <Label>{t("motifLabel")}</Label>
            <Select
              value={motifLabel || undefined}
              onValueChange={setMotifLabel}
              disabled={motifsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("motifPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {motifs.map((m) => {
                  const label = pickMotifLabel(m, locale);
                  return (
                    <SelectItem key={m.id} value={label}>
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Location (optional) */}
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

          {/* Notes */}
          <div className="space-y-2">
            <Label>{t("notesLabel")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesPlaceholder")}
              className="min-h-[80px]"
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">{t("notesHint")}</p>
          </div>

          {errorMsg ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMsg}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
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
