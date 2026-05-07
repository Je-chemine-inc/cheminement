"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Calendar,
  Clock,
  Video,
  MapPin,
  Phone,
  User,
  ArrowLeft,
  Save,
  Edit,
  X,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AppointmentResponse } from "@/types/api";
import { appointmentsAPI } from "@/lib/api-client";
import { useTranslations } from "next-intl";
import { EndSessionDialog } from "@/components/appointments/EndSessionDialog";

export default function SessionDetailsPage() {
  const t = useTranslations("Dashboard.sessions");
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;

  const [appointment, setAppointment] = useState<AppointmentResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session notes state
  const [sessionNotes, setSessionNotes] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Status change state
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [newStatus, setNewStatus] =
    useState<AppointmentResponse["status"]>("scheduled");

  // Reschedule state
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");

  const [showEndSessionDialog, setShowEndSessionDialog] = useState(false);

  // Session timer state (counts from scheduledStartAt when ongoing)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchAppointment = async () => {
      try {
        setLoading(true);
        const response = await appointmentsAPI.get(sessionId);
        setAppointment(response);
        setSessionNotes(response.notes || "");
        setNewStatus(response.status);
        setRescheduleDate(response.date.split("T")[0]);
        setRescheduleTime(response.time);

        // Initialize timer if session is already ongoing.
        // Counts from scheduledStartAt (server-derived), capped at session
        // duration so abandoned/forgotten sessions don't show runaway times.
        if (response.status === "ongoing" && !response.sessionCompletedAt) {
          try {
            const startSource = response.scheduledStartAt || response.date;
            const start = new Date(startSource);
            if (!isNaN(start.getTime())) {
              const now = new Date();
              const diffSeconds = Math.max(
                0,
                Math.floor((now.getTime() - start.getTime()) / 1000),
              );
              const durationSeconds = (response.duration || 0) * 60;
              const capped =
                durationSeconds > 0
                  ? Math.min(diffSeconds, durationSeconds)
                  : diffSeconds;
              setElapsedSeconds(capped);
            } else {
              setElapsedSeconds(0);
            }
          } catch {
            setElapsedSeconds(0);
          }
        } else {
          setElapsedSeconds(0);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };
    fetchAppointment();
  }, [sessionId]);

  // Stop timer helper
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Manage timer lifecycle based on appointment status.
  // The timer must stop once the session ends — either explicitly closed
  // (sessionCompletedAt set / status no longer "ongoing") or once the planned
  // duration has elapsed, so the counter doesn't run forever on forgotten sessions.
  useEffect(() => {
    if (!appointment) {
      stopTimer();
      setElapsedSeconds(0);
      return;
    }

    const isLive =
      appointment.status === "ongoing" && !appointment.sessionCompletedAt;

    if (!isLive) {
      stopTimer();
      setElapsedSeconds(0);
      return;
    }

    const durationSeconds = (appointment.duration || 0) * 60;
    const cap = durationSeconds > 0 ? durationSeconds : Infinity;

    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= cap) {
          stopTimer();
          return cap;
        }
        return next;
      });
    }, 1000);

    return () => {
      stopTimer();
    };
  }, [appointment]);

  const handleSaveNotes = async () => {
    if (!appointment) return;

    try {
      setSaving(true);
      const response = await appointmentsAPI.update(sessionId, {
        notes: sessionNotes,
      });

      setAppointment(response);
      setIsEditingNotes(false);
    } catch (err) {
      alert(t("failedSaveNotes"));
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status?: AppointmentResponse["status"]) => {
    if (!appointment) return;

    try {
      setSaving(true);
      const response = await appointmentsAPI.update(appointment._id, {
        status: status ?? newStatus,
      });

      setAppointment(response);
      setShowStatusDialog(false);
    } catch (err) {
      alert(t("failedUpdateStatus"));
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleReschedule = async () => {
    if (!appointment || !rescheduleDate || !rescheduleTime) {
      alert(t("selectDateTime"));
      return;
    }

    try {
      setSaving(true);
      const response = await appointmentsAPI.update(appointment._id, {
        date: new Date(rescheduleDate),
        time: rescheduleTime,
      });

      setAppointment(response);
      setShowRescheduleDialog(false);
    } catch (err) {
      alert(t("failedReschedule"));
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-5 w-5" />;
      case "in-person":
        return <MapPin className="h-5 w-5" />;
      case "phone":
        return <Phone className="h-5 w-5" />;
      default:
        return <User className="h-5 w-5" />;
    }
  };

  const formatElapsedTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [
      hours.toString().padStart(2, "0"),
      minutes.toString().padStart(2, "0"),
      seconds.toString().padStart(2, "0"),
    ];

    return parts.join(":");
  };

  const getStatusBadge = (status: AppointmentResponse["status"]) => {
    const styles = {
      scheduled: "bg-blue-100 text-blue-700",
      completed: "bg-green-100 text-green-700",
      cancelled: "bg-red-100 text-red-700",
      "no-show": "bg-orange-100 text-orange-700",
      pending: "bg-yellow-100 text-yellow-700",
      ongoing: "bg-purple-100 text-purple-700",
    };

    const labels: Record<AppointmentResponse["status"], string> = {
      pending: t("pending"),
      scheduled: t("scheduled"),
      ongoing: t("ongoing"),
      completed: t("completed"),
      cancelled: t("cancelled"),
      "no-show": t("noShow"),
    };

    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-medium ${styles[status]}`}
      >
        {labels[status]}
      </span>
    );
  };

  const getPaymentStatusBadge = (
    paymentStatus: AppointmentResponse["payment"]["status"],
  ) => {
    // Pros only need Paid vs Pending — everything non-paid collapses to pending.
    const isPaid = paymentStatus === "paid";
    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-medium ${
          isPaid
            ? "bg-green-100 text-green-700"
            : "bg-yellow-100 text-yellow-700"
        }`}
      >
        {isPaid ? t("paid") : t("pending")}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    const locale = t("locale") === "fr" ? "fr-CA" : "en-US";
    const date = new Date(dateString);
    return date.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">{t("loadingDetails")}</p>
        </div>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
          <p className="text-red-500">{error || t("appointmentNotFound")}</p>
          <Button onClick={() => router.back()} variant="outline">
            {t("goBack")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-serif font-light text-foreground">
              {t("detailsTitle")}
            </h1>
            <p className="text-muted-foreground font-light mt-1">
              {t("detailsSubtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {appointment.status === "ongoing" && (
            <div className="rounded-full bg-purple-50 px-4 py-1.5 flex items-center gap-2 border border-purple-100">
              <span className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
              <span className="text-xs font-medium text-purple-700 uppercase tracking-wide">
                Live
              </span>
              <span className="text-sm font-mono text-purple-900">
                {formatElapsedTime(elapsedSeconds)}
              </span>
            </div>
          )}
          {appointment.status === "scheduled" && (
            <Button
              onClick={() => handleStatusChange("ongoing")}
              className="gap-2 rounded-full"
            >
              <Video className="h-4 w-4" />
              {t("startSession")}
            </Button>
          )}
          {(appointment.status === "ongoing" ||
            appointment.status === "scheduled") && (
            <Button
              variant="default"
              className="gap-2 rounded-full"
              onClick={() => setShowEndSessionDialog(true)}
            >
              <Check className="h-4 w-4" />
              {t("sessionClosure.cta")}
            </Button>
          )}
          {appointment.status === "ongoing" && (
            <Button
              onClick={() => {
                if (appointment.type === "video" && appointment.meetingLink) {
                  window.open(appointment.meetingLink, "_blank");
                }
              }}
              className="gap-2 rounded-full"
            >
              <Video className="h-4 w-4" />
              {t("joinSession")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Client Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                {t("clientInfo")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-serif">
                  {appointment.clientId.firstName.charAt(0)}
                  {appointment.clientId.lastName.charAt(0)}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-medium text-foreground">
                    {appointment.clientId.firstName}{" "}
                    {appointment.clientId.lastName}
                  </h3>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p>{appointment.clientId.email}</p>
                    {appointment.clientId.phone && (
                      <p>{appointment.clientId.phone}</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Session Notes */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("sessionNotes")}</CardTitle>
                {!isEditingNotes ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingNotes(true)}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    {t("edit")}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSessionNotes(appointment.notes || "");
                        setIsEditingNotes(false);
                      }}
                      className="gap-2"
                    >
                      <X className="h-4 w-4" />
                      {t("cancelAction")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveNotes}
                      disabled={saving}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? t("saving") : t("save")}
                    </Button>
                  </div>
                )}
              </div>
              <CardDescription>
                {t("sessionNotesDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isEditingNotes ? (
                <Textarea
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  placeholder={t("notesPlaceholder")}
                  className="min-h-[300px] font-light"
                />
              ) : (
                <div className="min-h-[200px] rounded-lg bg-muted/30 p-4">
                  {sessionNotes ? (
                    <p className="text-sm text-foreground whitespace-pre-wrap font-light">
                      {sessionNotes}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground font-light italic">
                      {t("noNotesYet")}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Session History */}
          <Card>
            <CardHeader>
              <CardTitle>{t("sessionHistory")}</CardTitle>
              <CardDescription>{t("trackChanges")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-start gap-3 text-sm">
                  <div className="rounded-full bg-primary/10 p-1">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t("sessionCreated")}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(appointment.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <div className="rounded-full bg-primary/10 p-1">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t("lastUpdated")}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(appointment.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Session Details & Actions */}
        <div className="space-y-6">
          {/* Session Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t("detailsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">{t("status")}</Label>
                <div className="mt-1">{getStatusBadge(appointment.status)}</div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">{t("payment")}</Label>
                <div className="mt-1 flex items-center gap-2">
                  {getPaymentStatusBadge(appointment.payment.status)}
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">{t("dateTime").split(" & ")[0]}</Label>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{formatDate(appointment.date)}</span>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">{t("dateTime").split(" & ")[1]}</Label>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {formatTime(appointment.time)} ({appointment.duration} {t("minutes")})
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">{t("type")}</Label>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  {getTypeIcon(appointment.type)}
                  <span className="capitalize">
                    {t(appointment.type)}
                  </span>
                </div>
              </div>

              {appointment.therapyType && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("therapyType")}
                  </Label>
                  <p className="mt-1 text-sm capitalize">
                    {appointment.therapyType}
                  </p>
                </div>
              )}

              {appointment.nextAppointmentAt && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("sessionClosure.nextLabel")}
                  </Label>
                  <p className="mt-1 text-sm">
                    {(() => {
                      const na = new Date(appointment.nextAppointmentAt);
                      const hm = `${na.getHours().toString().padStart(2, "0")}:${na.getMinutes().toString().padStart(2, "0")}`;
                      return `${formatDate(appointment.nextAppointmentAt)} · ${formatTime(hm)}`;
                    })()}
                  </p>
                </div>
              )}

              {appointment.issueType && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("issueType")}
                  </Label>
                  <p className="mt-1 text-sm">{appointment.issueType}</p>
                </div>
              )}

              {appointment.meetingLink && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("meetingLinkUrl")}
                  </Label>
                  <a
                    href={appointment.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 text-sm text-primary hover:underline block break-all"
                  >
                    {appointment.meetingLink}
                  </a>
                </div>
              )}

              {appointment.location && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("location")}
                  </Label>
                  <p className="mt-1 text-sm">{appointment.location}</p>
                </div>
              )}

              <div>
                <Label className="text-xs text-muted-foreground">{t("earnings")}</Label>
                <p className="mt-1 text-sm font-medium">
                  ${appointment.payment.professionalPayout.toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("quickActions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(appointment.status === "ongoing" ||
                appointment.status === "scheduled") && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => setShowEndSessionDialog(true)}
                >
                  <Check className="h-4 w-4" />
                  {t("sessionClosure.cta")}
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => setShowStatusDialog(true)}
              >
                <Edit className="h-4 w-4" />
                {t("changeStatus")}
              </Button>
              {appointment.status === "scheduled" && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => setShowRescheduleDialog(true)}
                >
                  <Calendar className="h-4 w-4" />
                  {t("reschedule")}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Status Change Dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("changeStatusTitle")}</DialogTitle>
            <DialogDescription>
              {t("changeStatusDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="status">{t("newStatus")}</Label>
              <Select
                value={newStatus}
                onValueChange={(value) =>
                  setNewStatus(value as AppointmentResponse["status"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{t("pending")}</SelectItem>
                  <SelectItem value="scheduled">{t("scheduled")}</SelectItem>
                  <SelectItem value="ongoing">{t("ongoing")}</SelectItem>
                  <SelectItem value="completed">{t("completed")}</SelectItem>
                  <SelectItem value="cancelled">{t("cancelled")}</SelectItem>
                  <SelectItem value="no-show">{t("noShow")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                {t("currentStatus")} <strong>{appointment.status}</strong>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusDialog(false)}
              disabled={saving}
            >
              {t("cancelAction")}
            </Button>
            <Button onClick={() => handleStatusChange()} disabled={saving}>
              {saving ? t("updating") : t("updateStatus")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EndSessionDialog
        open={showEndSessionDialog}
        onOpenChange={setShowEndSessionDialog}
        appointmentId={sessionId}
        onCompleted={(apt) => setAppointment(apt)}
      />

      {/* Reschedule Dialog */}
      <Dialog
        open={showRescheduleDialog}
        onOpenChange={setShowRescheduleDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rescheduleTitle")}</DialogTitle>
            <DialogDescription>
              {t("rescheduleDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reschedule-date">{t("dateTime").split(" & ")[0]}</Label>
              <Input
                id="reschedule-date"
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reschedule-time">{t("dateTime").split(" & ")[1]}</Label>
              <Input
                id="reschedule-time"
                type="time"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
              />
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                {t("currentStatus")} {formatDate(appointment.date)} {t("at")}{" "}
                {formatTime(appointment.time)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRescheduleDialog(false)}
              disabled={saving}
            >
              {t("cancelAction")}
            </Button>
            <Button onClick={handleReschedule} disabled={saving}>
              {saving ? t("updating") : t("reschedule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
