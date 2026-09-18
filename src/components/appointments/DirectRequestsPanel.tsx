"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Check, Eye, Loader2, Mail, Phone, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiClientError } from "@/lib/api-client";
import {
  DIRECT_REQUEST_DECLINE_NOTE_MAX,
  DIRECT_REQUEST_DECLINE_REASONS,
  type DirectRequestDeclineReason,
  type DirectRequestService,
} from "@/lib/direct-request-rules";

/** What a card needs from a proposed appointment carrying a direct request. */
export interface DirectRequestRow {
  _id: string;
  clientId: { firstName: string; lastName: string; email: string; phone?: string };
  type: "video" | "in-person" | "phone" | "both";
  duration?: number;
  notes?: string;
  bookingFor: "self" | "patient" | "loved-one";
  lovedOneInfo?: { firstName: string; relationship: string };
  directRequest?: {
    state: string;
    service: DirectRequestService;
    dayKey: string;
    time: string;
    respondBy: string;
    /** The client agreed, when asking, that a decline hands the request to the general list (phase 3b). */
    fallbackToGeneral?: boolean;
  };
}

/** Error codes with their own wording; anything else gets the generic message. */
const KNOWN_ERRORS = [
  "SLOT_CONFLICT",
  "SLOT_HELD",
  "DIRECT_REQUEST_CLOSED",
  "DIRECT_REQUEST_EXPIRED",
  "OFFICE_ADDRESS_REQUIRED",
] as const;

/**
 * The professional's pending direct requests (spec 003 phase 3): clients who
 * chose one of their slots on their showcase page. The slot is held until the
 * professional accepts — the first appointment is then confirmed in one step —
 * or declines, with a reason the client never sees.
 */
export function DirectRequestsPanel<T extends DirectRequestRow>({
  requests,
  issueOf,
  onView,
  onChanged,
}: {
  requests: T[];
  /** The request's motif, as the proposals table shows it. */
  issueOf: (row: T) => string;
  onView: (row: T) => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations("DirectRequests");
  const locale = useLocale();
  const tag = locale === "en" ? "en-CA" : "fr-CA";
  const [answer, setAnswer] = useState<{ row: T; mode: "accept" | "decline" } | null>(null);
  const [reason, setReason] = useState<DirectRequestDeclineReason>("slot_unavailable");
  const [note, setNote] = useState("");
  const [address, setAddress] = useState("");
  const [saveOffice, setSaveOffice] = useState(true);
  const [hasSavedOffice, setHasSavedOffice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0 && !answer) return null;

  // Days and times are Montréal wall-clock values: formatted in UTC so the
  // viewer's own time zone never shifts them. The deadline is an instant.
  const slotLabel = (dayKey: string, time: string) => {
    const at = new Date(`${dayKey}T${time}:00Z`);
    const day = new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(at);
    const clock = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(at);
    return `${day}, ${clock}`;
  };
  const deadlineLabel = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Toronto",
    }).format(new Date(iso));

  const open = (row: T, mode: "accept" | "decline") => {
    setAnswer({ row, mode });
    setReason("slot_unavailable");
    setNote("");
    setError(null);
    setAddress("");
    setSaveOffice(true);
    setHasSavedOffice(false);
    if (mode === "accept" && row.type === "in-person") {
      // Prefill from the saved office, so it is typed once.
      apiClient
        .get<{ officeAddress?: { street?: string; suite?: string; city?: string; postalCode?: string } }>("/profile")
        .then((profile) => {
          const a = profile?.officeAddress;
          const line = [
            [a?.street, a?.suite].filter(Boolean).join(", "),
            [a?.city, a?.postalCode].filter(Boolean).join(" "),
          ]
            .filter(Boolean)
            .join(", ");
          if (line) {
            setAddress(line);
            setHasSavedOffice(true);
          }
        })
        .catch(() => undefined);
    }
  };

  const submit = async () => {
    if (!answer) return;
    setSubmitting(true);
    setError(null);
    try {
      if (answer.mode === "accept") {
        const inPerson = answer.row.type === "in-person";
        await apiClient.post(
          `/appointments/${answer.row._id}/accept-direct`,
          inPerson ? { location: address.trim(), saveAsDefaultOffice: saveOffice && !hasSavedOffice } : {},
        );
      } else {
        await apiClient.post(`/appointments/${answer.row._id}/decline-direct`, {
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      setAnswer(null);
      await onChanged();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      setError(
        code && (KNOWN_ERRORS as readonly string[]).includes(code) ? t(`errors.${code}`) : t("errors.generic"),
      );
      if (code === "DIRECT_REQUEST_CLOSED" || code === "DIRECT_REQUEST_EXPIRED") await onChanged();
    } finally {
      setSubmitting(false);
    }
  };

  const answering = answer?.row;
  const inPersonAccept = answer?.mode === "accept" && answering?.type === "in-person";

  return (
    <section aria-labelledby="direct-requests-title" className="mb-6 space-y-3">
      {requests.length > 0 ? (
        <>
          <div>
            <h2 id="direct-requests-title" className="text-lg font-medium text-foreground">
              {t("card.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("card.description")}</p>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {requests.map((row) => {
              const request = row.directRequest;
              if (!request) return null;
              return (
                <li
                  key={row._id}
                  className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700/60 dark:bg-amber-950/20"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {row.clientId.firstName} {row.clientId.lastName}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 break-all">
                          <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {row.clientId.email}
                        </span>
                        {row.clientId.phone ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" aria-hidden="true" />
                            {row.clientId.phone}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      {request.service === "quick" ? <Zap className="h-3 w-3" aria-hidden="true" /> : null}
                      {t(`services.${request.service}`)}
                    </span>
                  </div>

                  <dl className="mt-3 grid gap-1 text-sm">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">{t("card.slot")}</dt>
                      <dd className="font-medium text-foreground">
                        {slotLabel(request.dayKey, request.time)} · {t("card.minutes", { minutes: row.duration ?? 60 })}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">{t("card.modality")}</dt>
                      <dd className="text-foreground">{t(`modalities.${row.type}`)}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">{t("card.reason")}</dt>
                      <dd className="text-foreground">{issueOf(row)}</dd>
                    </div>
                    {row.bookingFor === "loved-one" && row.lovedOneInfo ? (
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("card.for")}</dt>
                        <dd className="text-foreground">
                          {row.lovedOneInfo.firstName} ({row.lovedOneInfo.relationship})
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {row.notes ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-foreground/80">{row.notes}</p>
                  ) : null}

                  <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-900 dark:text-amber-300">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("card.answerBy", { time: deadlineLabel(request.respondBy) })}
                  </p>
                  {request.fallbackToGeneral ? (
                    <p className="mt-1 text-xs text-muted-foreground" data-direct-fallback-note="">
                      {t("card.fallback")}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onView(row)} aria-label={t("card.view")}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open(row, "decline")}
                      className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                      {t("card.decline")}
                    </Button>
                    <Button size="sm" onClick={() => open(row, "accept")} className="gap-1">
                      <Check className="h-4 w-4" />
                      {t("card.accept")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <Dialog
        open={answer !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !submitting) setAnswer(null);
        }}
      >
        <DialogContent>
          {answer && answering?.directRequest ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {answer.mode === "accept" ? t("answer.acceptTitle") : t("answer.declineTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    answer.mode === "accept"
                      ? "answer.acceptBody"
                      : answering.directRequest.fallbackToGeneral
                        ? "answer.declineBodyHandedOn"
                        : "answer.declineBody",
                    {
                      name: `${answering.clientId.firstName} ${answering.clientId.lastName}`,
                      slot: slotLabel(answering.directRequest.dayKey, answering.directRequest.time),
                    },
                  )}
                </DialogDescription>
              </DialogHeader>

              {inPersonAccept ? (
                <div className="space-y-2">
                  <Label htmlFor="direct-request-address">{t("answer.address")}</Label>
                  <Input
                    id="direct-request-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder={t("answer.addressPlaceholder")}
                  />
                  {!hasSavedOffice ? (
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={saveOffice} onCheckedChange={(value) => setSaveOffice(value === true)} />
                      {t("answer.saveOffice")}
                    </label>
                  ) : null}
                </div>
              ) : null}

              {answer.mode === "accept" ? (
                <p className="text-sm text-muted-foreground">{t("answer.acceptWhatNext")}</p>
              ) : (
                <div className="space-y-4">
                  <RadioGroup
                    value={reason}
                    onValueChange={(value) => setReason(value as DirectRequestDeclineReason)}
                    className="gap-2"
                  >
                    {DIRECT_REQUEST_DECLINE_REASONS.map((value) => (
                      <label key={value} htmlFor={`direct-reason-${value}`} className="flex items-center gap-2 text-sm text-foreground">
                        <RadioGroupItem value={value} id={`direct-reason-${value}`} />
                        {t(`reasons.${value}`)}
                      </label>
                    ))}
                  </RadioGroup>
                  <div className="space-y-1">
                    <Label htmlFor="direct-request-note">{t("answer.note")}</Label>
                    <Textarea
                      id="direct-request-note"
                      value={note}
                      maxLength={DIRECT_REQUEST_DECLINE_NOTE_MAX}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">{t("answer.noteHelp")}</p>
                  </div>
                </div>
              )}

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <DialogFooter>
                <Button variant="outline" onClick={() => setAnswer(null)} disabled={submitting}>
                  {t("answer.cancel")}
                </Button>
                <Button
                  onClick={() => void submit()}
                  disabled={submitting || (inPersonAccept && !address.trim())}
                  variant={answer.mode === "decline" ? "destructive" : "default"}
                  className="gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {answer.mode === "accept" ? t("answer.confirmAccept") : t("answer.confirmDecline")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
