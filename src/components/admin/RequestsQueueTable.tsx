"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Loader2,
  RefreshCw,
  Trash2,
  UserCheck,
  CalendarPlus,
  Flag,
  Zap,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useTranslations } from "next-intl";
import { AvailabilitySlots } from "@/components/appointments/AvailabilitySlots";
import { useMotifs, buildMotifLabelResolver } from "@/hooks/useMotifs";

const DURATION_OPTIONS = [30, 50, 60, 90];
const SCHEDULE_TYPE_OPTIONS = ["video", "in-person", "phone"] as const;

interface ProfessionalOption {
  id: string;
  name: string;
  email: string;
  acceptingNewClients?: boolean;
  acceptingEmergencyConsultations?: boolean;
}

interface ServiceRequestRow {
  id: string;
  createdAt: string;
  issueType?: string;
  notes?: string;
  type: string;
  therapyType: string;
  bookingFor: string;
  routingStatus: string;
  cascadeAttempts?: number;
  isReturningClient?: boolean;
  isEmergency?: boolean;
  preferredAvailability?: string[];
  clientName: string;
  clientEmail: string;
  professionalId?: string | null;
  professionalName?: string | null;
  matchedAt?: string | null;
  referral?: {
    referrerName?: string;
    referralReason?: string;
    documentUrl?: string;
    documentName?: string;
  } | null;
}

/**
 * Shared admin request queue. Drives BOTH the "Demande de service" tab (all
 * pending requests) and the "Pool Général" tab (only general-pool requests):
 * identical columns and actions (assign / re-match / send-to-general / delete /
 * loved-one approve), differing only by data source + heading. All actions hit
 * the same /api/admin/service-requests/[id]/* endpoints, which operate on any
 * pending appointment regardless of which list surfaced it.
 */
// How often the open queue silently re-pulls so newly-arrived requests (and
// awaiting_admin returns) surface near-real-time without a manual refresh.
const POLL_INTERVAL_MS = 30_000;

// Filter-chip order: most actionable first ("À jumeler" returns before fresh
// prospects), so the admin's eye lands on dossiers needing a manual decision.
const STATUS_FILTER_ORDER = [
  "awaiting_admin",
  "pending",
  "proposed",
  "accepted",
  "general",
  "refused",
];

export default function RequestsQueueTable({
  fetchUrl,
  titleKey,
  subtitleKey,
  enableStatusFilter = false,
}: {
  fetchUrl: string;
  titleKey: string;
  subtitleKey: string;
  /** Show routing-status filter chips (used on Demande de service to isolate the
   *  awaiting_admin returns from fresh bookings). */
  enableStatusFilter?: boolean;
}) {
  const t = useTranslations("AdminServiceRequests");
  // Reuse the booking-modal field labels for the "Fixer un RDV" dialog.
  const tBook = useTranslations("Dashboard.bookAppointmentModal");
  const locale = useLocale();
  const { motifs } = useMotifs();
  // Problématique labels are stored in the locale the client booked in;
  // normalize them to the admin's active locale for display.
  const resolveMotifLabel = useMemo(
    () => buildMotifLabelResolver(motifs, locale),
    [motifs, locale],
  );
  // Marker(s) appended to a pro's name in the assign dropdowns when they opted
  // out of intake relevant to THIS request: "new clients" always, and
  // "emergency consultations" only for urgent (isEmergency) rows.
  const proOptionLabel = (p: ProfessionalOption, isEmergency?: boolean) => {
    const markers: string[] = [];
    if (p.acceptingNewClients === false) markers.push(t("notAcceptingMarker"));
    if (isEmergency && p.acceptingEmergencyConsultations === false)
      markers.push(t("notAcceptingEmergencyMarker"));
    return markers.length ? `${p.name} — ${markers.join(" · ")}` : p.name;
  };
  const [requests, setRequests] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceRequestRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [emergencyTogglingId, setEmergencyTogglingId] = useState<string | null>(
    null,
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // "Fixer un rendez-vous" (§4) — direct in-place scheduling modal state.
  const [scheduleTarget, setScheduleTarget] =
    useState<ServiceRequestRow | null>(null);
  const [schProId, setSchProId] = useState("");
  const [schDate, setSchDate] = useState("");
  const [schTime, setSchTime] = useState("");
  const [schType, setSchType] =
    useState<(typeof SCHEDULE_TYPE_OPTIONS)[number]>("video");
  const [schDuration, setSchDuration] = useState<number>(50);
  const [schReason, setSchReason] = useState("");
  const [schLocation, setSchLocation] = useState("");
  const [schNotes, setSchNotes] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Count rows per routing status (drives the filter chips + their badges).
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of requests) {
      counts[r.routingStatus] = (counts[r.routingStatus] ?? 0) + 1;
    }
    return counts;
  }, [requests]);

  const filteredRequests = useMemo(
    () =>
      statusFilter === "all"
        ? requests
        : requests.filter((r) => r.routingStatus === statusFilter),
    [requests, statusFilter],
  );

  // If a refresh removes every row of the selected status, fall back to "all"
  // so the table never shows an empty list with a stale chip selected.
  useEffect(() => {
    if (statusFilter !== "all" && !statusCounts[statusFilter]) {
      setStatusFilter("all");
    }
  }, [statusFilter, statusCounts]);

  const modalityLabel = (type: string) => {
    switch (type) {
      case "video":
        return t("typeVideo");
      case "in-person":
        return t("typeInPerson");
      case "phone":
        return t("typePhone");
      case "both":
        return t("typeBoth");
      default:
        return type;
    }
  };

  const bookingForLabel = (bf: string) => {
    switch (bf) {
      case "self":
        return t("self");
      case "patient":
        return t("patient");
      case "loved-one":
        return t("lovedOne");
      default:
        return bf;
    }
  };

  const routingStatusLabel = (status: string) => {
    switch (status) {
      case "pending":
        return { label: t("routingPending"), color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" };
      case "proposed":
        return { label: t("routingProposed"), color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
      case "accepted":
        return { label: t("routingAccepted"), color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
      case "general":
        return { label: t("routingGeneral"), color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" };
      case "awaiting_admin":
        return { label: t("routingAwaitingAdmin"), color: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300" };
      case "refused":
        return { label: t("routingRefused"), color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
      default:
        return { label: status, color: "bg-muted text-muted-foreground" };
    }
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        throw new Error("Failed to load");
      }
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [fetchUrl]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setError(null);
      const res = await fetch(`/api/admin/service-requests/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to delete");
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setDeleting(false);
    }
  };

  const approve = async (id: string, target: "requester" | "loved-one") => {
    try {
      setApprovingId(id);
      setError(null);
      const res = await fetch(`/api/admin/service-requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to approve");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  // Background auto-refresh: keep the queue live so new requests and dossiers
  // returned to the admin (awaiting_admin) appear without a manual reload.
  // Updates the list IN PLACE (no spinner, unlike the Refresh button), guards
  // against overlapping polls, swallows transient errors (the banner is for
  // explicit loads only), and pauses while the tab is hidden.
  const isPollingRef = useRef(false);
  const silentRefresh = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      // transient poll failure — ignore; next tick or manual Refresh recovers
    } finally {
      isPollingRef.current = false;
    }
  }, [fetchUrl]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval === null) {
        interval = setInterval(silentRefresh, POLL_INTERVAL_MS);
      }
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        silentRefresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [silentRefresh]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/professionals?status=active&limit=200");
        if (!res.ok) return;
        const json = await res.json();
        setProfessionals(json.professionals ?? []);
      } catch (err) {
        console.error("Failed to load professionals list:", err);
      }
    })();
  }, []);

  const assignProfessional = async (requestId: string) => {
    const value = assignDraft[requestId];
    if (!value) return;
    try {
      setAssigningId(requestId);
      setError(null);
      // Special options re-route instead of proposing to one pro:
      //   __auto__    → re-run automatic matching
      //   __general__ → drop into the public general pool (self-assign)
      const body =
        value === "__auto__"
          ? { mode: "auto" }
          : value === "__general__"
            ? { mode: "general" }
            : { professionalId: value };
      const res = await fetch(
        `/api/admin/service-requests/${requestId}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to assign");
      }
      setAssignDraft((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setAssigningId(null);
    }
  };

  // §4 "Définir comme Consultation ponctuelle rapide": one-click toggle of the
  // urgent flag straight from the queue (no popup). Drives the Urgence badge,
  // top-sort, and the 12h accept SLA; toggling off reverts to a standard request.
  const toggleEmergency = async (r: ServiceRequestRow) => {
    try {
      setEmergencyTogglingId(r.id);
      setError(null);
      const res = await fetch(
        `/api/admin/service-requests/${r.id}/emergency`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isEmergency: !r.isEmergency }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to update");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setEmergencyTogglingId(null);
    }
  };

  const openSchedule = (r: ServiceRequestRow) => {
    setScheduleTarget(r);
    setSchProId(r.professionalId ?? "");
    setSchDate("");
    setSchTime("");
    setSchType(
      (["video", "in-person", "phone"].includes(r.type)
        ? r.type
        : "video") as (typeof SCHEDULE_TYPE_OPTIONS)[number],
    );
    setSchDuration(50);
    setSchReason("");
    setSchLocation("");
    setSchNotes("");
    setScheduleError(null);
  };

  const handleSchedule = async () => {
    if (!scheduleTarget || !schProId || !schDate || !schTime) return;
    try {
      setScheduling(true);
      setScheduleError(null);
      const res = await fetch(
        `/api/admin/service-requests/${scheduleTarget.id}/schedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            professionalId: schProId,
            date: schDate,
            time: schTime,
            type: schType,
            duration: schDuration,
            // §4: reason is optional — never blocks the action.
            motif: schReason.trim() || undefined,
            notes: schNotes.trim() || undefined,
            location:
              schType === "in-person"
                ? schLocation.trim() || undefined
                : undefined,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to schedule");
      }
      setScheduleTarget(null);
      await load();
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Error");
    } finally {
      setScheduling(false);
    }
  };

  const canSchedule =
    Boolean(schProId) && Boolean(schDate) && Boolean(schTime) && !scheduling;

  const chipClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-muted-foreground hover:bg-muted"
    }`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t(titleKey)}
          </h1>
          <p className="text-muted-foreground font-light mt-2">{t(subtitleKey)}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {enableStatusFilter && requests.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={chipClass(statusFilter === "all")}
          >
            {t("filterAll")} ({requests.length})
          </button>
          {STATUS_FILTER_ORDER.filter((s) => statusCounts[s]).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setStatusFilter(s)}
              className={chipClass(statusFilter === s)}
            >
              {routingStatusLabel(s).label} ({statusCounts[s]})
            </button>
          ))}
        </div>
      )}

      {loading && requests.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <p className="text-muted-foreground py-8">{t("empty")}</p>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("created")}</TableHead>
                <TableHead>{t("client")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("motif")}</TableHead>
                <TableHead>{t("modality")}</TableHead>
                <TableHead>{t("bookingFor")}</TableHead>
                <TableHead>{t("routing")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.map((r) => (
                <TableRow
                  key={r.id}
                  className={
                    r.isEmergency
                      ? "bg-red-50/70 hover:bg-red-50 dark:bg-red-950/20"
                      : undefined
                  }
                >
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{r.clientName}</span>
                      {r.isEmergency ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                          title={t("emergencyHint")}
                        >
                          {t("emergency")}
                        </span>
                      ) : null}
                      {r.isReturningClient ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                          title={t("returningClientHint")}
                        >
                          {t("returningClient")}
                        </span>
                      ) : null}
                      {/* §3.1: dossier refused/ignored by 2 pros (cascade
                          exhausted) — flag the admin to re-verify the request. */}
                      {typeof r.cascadeAttempts === "number" &&
                      r.cascadeAttempts >= 2 ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white dark:bg-red-700"
                          title={t("refusedTwiceHint")}
                        >
                          <Flag className="h-3 w-3" />
                          {t("refusedTwiceFlag")}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {r.clientEmail}
                  </TableCell>
                  <TableCell
                    className="max-w-[240px] text-sm align-top"
                    title={
                      r.issueType ? resolveMotifLabel(r.issueType) : undefined
                    }
                  >
                    <div className="truncate">
                      {r.issueType ? resolveMotifLabel(r.issueType) : "—"}
                    </div>
                    {r.preferredAvailability?.length ? (
                      <div className="mt-1">
                        <AvailabilitySlots
                          slots={r.preferredAvailability}
                          max={3}
                        />
                      </div>
                    ) : null}
                    {r.referral?.documentUrl ? (
                      <a
                        href={r.referral.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        title={r.referral.referralReason || undefined}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate max-w-[180px]">
                          {r.referral.documentName || t("referralDocument")}
                        </span>
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {modalityLabel(r.type)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {bookingForLabel(r.bookingFor)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const { label, color } = routingStatusLabel(r.routingStatus);
                      return (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                          {label}
                        </span>
                      );
                    })()}
                    {typeof r.cascadeAttempts === "number" &&
                    r.cascadeAttempts > 0 ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("attemptsLabel", { n: r.cascadeAttempts })}
                      </div>
                    ) : null}
                    {r.professionalName && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("assignedToLabel")}: {r.professionalName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm align-top">
                    <div className="flex flex-col gap-2 min-w-[260px]">
                      <div className="flex flex-wrap gap-2">
                        {r.bookingFor === "loved-one" && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => approve(r.id, "requester")}
                              disabled={loading || approvingId === r.id}
                              className="whitespace-nowrap"
                            >
                              {t("sendToRequester")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => approve(r.id, "loved-one")}
                              disabled={loading || approvingId === r.id}
                              className="whitespace-nowrap"
                            >
                              {t("sendToLovedOne")}
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openSchedule(r)}
                          disabled={loading}
                          className="whitespace-nowrap"
                        >
                          <CalendarPlus className="h-4 w-4 mr-1" />
                          {t("scheduleAction")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleEmergency(r)}
                          disabled={loading || emergencyTogglingId === r.id}
                          title={
                            r.isEmergency
                              ? t("unmarkEmergencyHint")
                              : t("markEmergencyHint")
                          }
                          className={`whitespace-nowrap ${
                            r.isEmergency
                              ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
                              : ""
                          }`}
                        >
                          {emergencyTogglingId === r.id ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4 mr-1" />
                          )}
                          {r.isEmergency
                            ? t("unmarkEmergency")
                            : t("markEmergency")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeleteTarget(r)}
                          disabled={loading || approvingId === r.id}
                          className="whitespace-nowrap"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          {t("delete")}
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/30">
                        <Select
                          value={assignDraft[r.id] || undefined}
                          onValueChange={(v) =>
                            setAssignDraft((prev) => ({ ...prev, [r.id]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 w-52 text-xs">
                            <SelectValue placeholder={t("assignPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__auto__">
                              {t("assignAutoMatch")}
                            </SelectItem>
                            <SelectItem value="__general__">
                              {t("assignGeneralPool")}
                            </SelectItem>
                            {professionals.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                {t("assignNoProfessionals")}
                              </div>
                            ) : (
                              professionals.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {proOptionLabel(p, r.isEmergency)}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => assignProfessional(r.id)}
                          disabled={
                            !assignDraft[r.id] ||
                            assigningId === r.id ||
                            loading
                          }
                          className="h-8 text-xs gap-1 whitespace-nowrap"
                        >
                          {assigningId === r.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <UserCheck className="h-3 w-3" />
                          )}
                          {r.professionalName
                            ? t("reassignAction")
                            : t("assignAction")}
                        </Button>
                      </div>
                      {professionals.find(
                        (p) => p.id === assignDraft[r.id],
                      )?.acceptingNewClients === false && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {t("notAcceptingWarning")}
                        </p>
                      )}
                      {r.isEmergency &&
                        professionals.find(
                          (p) => p.id === assignDraft[r.id],
                        )?.acceptingEmergencyConsultations === false && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            {t("notAcceptingEmergencyWarning")}
                          </p>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirmDesc", {
                client: deleteTarget?.clientName ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fixer un rendez-vous — direct in-place scheduling (§4) */}
      <Dialog
        open={scheduleTarget !== null}
        onOpenChange={(open) => {
          if (!open && !scheduling) setScheduleTarget(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("scheduleTitle")}</DialogTitle>
            <DialogDescription>
              {scheduleTarget
                ? t("scheduleDesc", { client: scheduleTarget.clientName })
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
            {/* Professional */}
            <div className="space-y-2">
              <Label>{tBook("professionalLabel")}</Label>
              <Select value={schProId || undefined} onValueChange={setSchProId}>
                <SelectTrigger>
                  <SelectValue placeholder={tBook("professionalPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {professionals.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {tBook("noProfessionals")}
                    </div>
                  ) : (
                    professionals.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {proOptionLabel(p, scheduleTarget?.isEmergency)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{tBook("dateLabel")}</Label>
                <Input
                  type="date"
                  value={schDate}
                  onChange={(e) => setSchDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
              <div className="space-y-2">
                <Label>{tBook("timeLabel")}</Label>
                <Input
                  type="time"
                  value={schTime}
                  onChange={(e) => setSchTime(e.target.value)}
                />
              </div>
            </div>

            {/* Duration + Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{tBook("durationLabel")}</Label>
                <Select
                  value={String(schDuration)}
                  onValueChange={(v) => setSchDuration(parseInt(v, 10))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {tBook("minutesValue", { count: d })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tBook("typeLabel")}</Label>
                <Select
                  value={schType}
                  onValueChange={(v) =>
                    setSchType(v as (typeof SCHEDULE_TYPE_OPTIONS)[number])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_TYPE_OPTIONS.map((tp) => (
                      <SelectItem key={tp} value={tp}>
                        {tBook(`types.${tp}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Location (in-person only) */}
            {schType === "in-person" && (
              <div className="space-y-2">
                <Label>{tBook("locationLabel")}</Label>
                <Input
                  value={schLocation}
                  onChange={(e) => setSchLocation(e.target.value)}
                  placeholder={tBook("locationPlaceholder")}
                />
              </div>
            )}

            {/* Reason — strictly optional (§4) */}
            <div className="space-y-2">
              <Label>{t("scheduleReason")}</Label>
              <Input
                value={schReason}
                onChange={(e) => setSchReason(e.target.value)}
                placeholder={t("scheduleReasonPlaceholder")}
              />
            </div>

            {/* Notes (optional) */}
            <div className="space-y-2">
              <Label>{tBook("notesLabel")}</Label>
              <Textarea
                value={schNotes}
                onChange={(e) => setSchNotes(e.target.value)}
                placeholder={tBook("notesPlaceholder")}
                className="min-h-[70px]"
                maxLength={1000}
              />
            </div>

            {scheduleError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {scheduleError}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleTarget(null)}
              disabled={scheduling}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSchedule}
              disabled={!canSchedule}
            >
              {scheduling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("scheduleSubmit")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
