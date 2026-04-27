"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Phone,
  User,
  MoreVertical,
  Loader2,
  AlertCircle,
  Star,
  Lock,
  RefreshCw,
  Mail,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { appointmentsAPI, apiClient } from "@/lib/api-client";
import { CancelAppointmentDialog, ReviewDialog } from "@/components/appointments";
import Link from "next/link";
import type { AppointmentResponse } from "@/types/api";

export default function ClientAppointmentsPage() {
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");
  const [appointments, setAppointments] = useState<AppointmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [appointmentToCancel, setAppointmentToCancel] =
    useState<AppointmentResponse | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [appointmentToReview, setAppointmentToReview] =
    useState<AppointmentResponse | null>(null);
  const [managedAccountName, setManagedAccountName] = useState<string | null>(null);
  const [rescheduleInfoId, setRescheduleInfoId] = useState<string | null>(null);
  const t = useTranslations("Client.appointments");
  const tManaged = useTranslations("managedAccounts");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  useEffect(() => {
    fetchAppointments();
    if (accountId) {
      fetchManagedAccountInfo();
    }
  }, [accountId]);

  const fetchManagedAccountInfo = async () => {
    try {
      const response = await apiClient.get<{ managedAccounts: Array<{ _id: string; firstName: string; lastName: string }> }>(
        "/users/guardian?action=managed",
      );
      const account = response.managedAccounts?.find((acc) => acc._id === accountId);
      if (account) {
        setManagedAccountName(`${account.firstName} ${account.lastName}`);
      }
    } catch (err) {
      console.error("Error fetching managed account info:", err);
    }
  };

  const fetchAppointments = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await appointmentsAPI.list(
        accountId ? { accountId } : undefined
      );
      setAppointments(data);
    } catch (err) {
      console.error("Error fetching appointments:", err);
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setLoading(false);
    }
  };

  const openCancelDialog = (appointment: AppointmentResponse) => {
    setAppointmentToCancel(appointment);
    setShowCancelDialog(true);
  };

  const closeCancelDialog = () => {
    setShowCancelDialog(false);
    setAppointmentToCancel(null);
  };

  const handleCancelSuccess = () => {
    fetchAppointments();
    closeCancelDialog();
  };

  // Join when meeting link exists and either session is paid OR a payment method
  // is on file (Stripe) to confirm the booking — charge happens after completion.
  const canJoinSession = (appointment: AppointmentResponse): boolean => {
    const hasPaymentSecured =
      appointment.payment.status === "paid" ||
      Boolean(appointment.payment.stripePaymentMethodId);

    if (!appointment.meetingLink || !hasPaymentSecured) {
      return false;
    }

    if (appointment.status === "ongoing") {
      return true;
    }

    if (appointment.status === "scheduled" && appointment.date && appointment.time) {
      const [hours, minutes] = appointment.time.split(":").map(Number);
      const sessionStart = new Date(appointment.date);
      sessionStart.setHours(hours, minutes, 0, 0);
      
      const now = new Date();
      const minutesUntilSession = (sessionStart.getTime() - now.getTime()) / (1000 * 60);
      
      // Allow joining 15 minutes before session starts
      return minutesUntilSession <= 15 && minutesUntilSession >= -appointment.duration;
    }

    return false;
  };

  const canModifyAppointment = (appointment: AppointmentResponse): boolean => {
    if (!appointment.date || !appointment.time) return false;
    const [hours, minutes] = appointment.time.split(":").map(Number);
    const sessionStart = new Date(appointment.date);
    sessionStart.setHours(hours, minutes, 0, 0);
    const hoursUntil = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntil > 48;
  };

  const openReviewDialog = (appointment: AppointmentResponse) => {
    setAppointmentToReview(appointment);
    setShowReviewDialog(true);
  };

  const closeReviewDialog = () => {
    setShowReviewDialog(false);
    setAppointmentToReview(null);
  };

  const handleReviewSuccess = () => {
    fetchAppointments();
    closeReviewDialog();
  };

  const handleJoinSession = (appointment: AppointmentResponse) => {
    if (canJoinSession(appointment)) {
      window.open(appointment.meetingLink, "_blank");
    }
  };

  // Filter appointments into upcoming and past
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingAppointments = appointments.filter((apt) => {
    const aptDate = apt.date ? new Date(apt.date) : today;
    return (
      aptDate >= today &&
      ["scheduled", "pending", "ongoing"].includes(apt.status)
    );
  });

  const pastAppointments = appointments.filter((apt) => {
    const aptDate = apt.date ? new Date(apt.date) : today;
    return (
      aptDate < today ||
      ["completed", "cancelled", "no-show"].includes(apt.status)
    );
  });

  const currentAppointments =
    activeTab === "upcoming" ? upcomingAppointments : pastAppointments;

  const getModalityIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4" />;
      case "in-person":
        return <MapPin className="h-4 w-4" />;
      case "phone":
        return <Phone className="h-4 w-4" />;
      default:
        return <Calendar className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "bg-primary/15 text-primary";
      case "completed":
        return "bg-green-500/15 text-green-700 dark:text-green-400";
      case "cancelled":
        return "bg-red-500/15 text-red-700 dark:text-red-400";
      case "no-show":
        return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const appointmentStatusLabel = (status: string) => {
    const key = status === "no-show" ? "noShow" : status;
    const statusKeys = new Set([
      "scheduled",
      "completed",
      "cancelled",
      "noShow",
      "pending",
      "ongoing",
    ]);
    if (!statusKeys.has(key)) return status;
    return t(`status.${key}` as "status.scheduled");
  };

  const appointmentModalityLabel = (type: string) => {
    if (type === "in-person") return t("modality.inPerson");
    if (type === "video") return t("modality.video");
    if (type === "phone") return t("modality.phone");
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-light text-foreground">
              {t("title")}
            </h1>
            {accountId && managedAccountName && (
              <span className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                {tManaged("viewing")} {managedAccountName}
              </span>
            )}
          </div>
          <p className="mt-2 text-muted-foreground">
            {accountId && managedAccountName
              ? tManaged("appointmentsFor", { name: managedAccountName })
              : t("subtitle")}
          </p>
        </div>
        <Button asChild className="gap-2 rounded-full">
          <Link href="/appointment">
            <Calendar className="h-4 w-4" />
            {t("requestNew")}
          </Link>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border/40">
        <button
          onClick={() => setActiveTab("upcoming")}
          className={`rounded-t-lg px-6 py-3 font-medium transition ${
            activeTab === "upcoming"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("upcoming")}
        </button>
        <button
          onClick={() => setActiveTab("past")}
          className={`rounded-t-lg px-6 py-3 font-medium transition ${
            activeTab === "past"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("past")}
        </button>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 font-serif text-xl text-red-700">{t("error")}</h3>
          <p className="mt-2 text-red-600">{error}</p>
          <Button
            onClick={fetchAppointments}
            variant="outline"
            className="mt-4"
          >
            {t("retry")}
          </Button>
        </div>
      ) : currentAppointments.length === 0 ? (
        <div className="rounded-3xl border border-border/20 bg-card/80 p-12 text-center shadow-lg">
          <Calendar className="mx-auto h-16 w-16 text-muted-foreground/50" />
          <h3 className="mt-4 font-serif text-xl text-foreground">
            {activeTab === "upcoming" ? t("noUpcoming") : t("noPast")}
          </h3>
          {activeTab === "upcoming" && (
            <Button
              onClick={() => router.push("/appointment")}
              className="mt-6 gap-2 rounded-full"
            >
              <Calendar className="h-4 w-4" />
              {t("requestNew")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {currentAppointments.map((appointment) => (
            <div
              key={appointment._id}
              className="rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg transition hover:shadow-xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-4">
                  {/* Date and Time */}
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl bg-primary/10 p-4">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-light text-foreground">
                        {appointment.date
                          ? formatDate(appointment.date)
                          : t("toBeScheduled")}
                      </h3>
                      <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {appointment.time}
                        </span>
                        <span>
                          {appointment.duration} {t("minutes")}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${getStatusColor(
                            appointment.status,
                          )}`}
                        >
                          {appointmentStatusLabel(appointment.status)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Professional Info */}
                  {appointment.professionalId && (
                    <div className="flex items-center gap-3 rounded-2xl bg-muted/30 p-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {appointment.professionalId.firstName}{" "}
                          {appointment.professionalId.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {appointment.professionalId.email}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Details Grid */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {getModalityIcon(appointment.type)}
                      <span>{appointmentModalityLabel(appointment.type)}</span>
                    </div>
                    {appointment.issueType && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-medium">{t("concernLabel")}:</span>
                        <span>{appointment.issueType}</span>
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  {appointment.notes && (
                    <div className="rounded-2xl border border-border/20 bg-card/70 p-4">
                      <p className="text-sm font-medium text-foreground">
                        {t("details.notes")}:
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {appointment.notes}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {activeTab === "upcoming" &&
                        appointment.status === "scheduled" &&
                        canModifyAppointment(appointment) && (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => openCancelDialog(appointment)}
                              className="gap-2 rounded-full text-red-600 hover:text-red-700"
                            >
                              {t("actions.cancel")}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() =>
                                setRescheduleInfoId(
                                  rescheduleInfoId === appointment._id
                                    ? null
                                    : appointment._id,
                                )
                              }
                              className="gap-2 rounded-full"
                            >
                              <RefreshCw className="h-4 w-4" />
                              {t("actions.reschedule")}
                            </Button>
                          </>
                        )}
                      {activeTab === "upcoming" &&
                        appointment.type === "video" &&
                        canJoinSession(appointment) && (
                          <Button
                            onClick={() => handleJoinSession(appointment)}
                            className="gap-2 rounded-full"
                          >
                            <Video className="h-4 w-4" />
                            {t("actions.joinSession")}
                          </Button>
                        )}
                      {activeTab === "past" &&
                        appointment.status === "completed" && (
                          <Button
                            variant="outline"
                            onClick={() => openReviewDialog(appointment)}
                            className="gap-2 rounded-full"
                          >
                            <Star className="h-4 w-4" />
                            {t("actions.review")}
                          </Button>
                        )}
                    </div>

                    {/* 48h lock alert */}
                    {activeTab === "upcoming" &&
                      appointment.status === "scheduled" &&
                      !canModifyAppointment(appointment) && (
                        <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800/40 dark:bg-orange-950/20">
                          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                              {t("lateChange.title")}
                            </p>
                            <p className="text-sm text-orange-700 dark:text-orange-300">
                              {t("lateChange.message")}
                            </p>
                            <a
                              href="mailto:contact@monimpression.com"
                              className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 underline hover:text-orange-900 dark:text-orange-300"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              {t("lateChange.emailUs")}
                            </a>
                          </div>
                        </div>
                      )}

                    {/* Reschedule contact info panel */}
                    {rescheduleInfoId === appointment._id && (
                      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/40 dark:bg-blue-950/20">
                        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            {t("rescheduleInfo.title")}
                          </p>
                          <p className="text-sm text-blue-700 dark:text-blue-300">
                            {t("rescheduleInfo.message")}
                          </p>
                          <a
                            href="mailto:contact@monimpression.com"
                            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 dark:text-blue-300"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {t("rescheduleInfo.emailUs")}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* More Options */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {appointment.type === "in-person" &&
                      appointment.location && (
                        <DropdownMenuItem>
                          <MapPin className="mr-2 h-4 w-4" />
                          {appointment.location}
                        </DropdownMenuItem>
                      )}
                    {appointment.type === "video" &&
                      canJoinSession(appointment) && (
                        <DropdownMenuItem
                          onClick={() => handleJoinSession(appointment)}
                        >
                          <Video className="mr-2 h-4 w-4" />
                          {t("actions.openMeetingLink")}
                        </DropdownMenuItem>
                      )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancel Appointment Dialog */}
      {appointmentToCancel && (
        <CancelAppointmentDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          appointmentId={appointmentToCancel._id}
          appointmentDate={appointmentToCancel.date}
          appointmentTime={appointmentToCancel.time}
          amount={appointmentToCancel.payment.price}
          isPaid={appointmentToCancel.payment.status === "paid"}
          onSuccess={handleCancelSuccess}
        />
      )}

      {/* Review Dialog */}
      {appointmentToReview && (
        <ReviewDialog
          open={showReviewDialog}
          onOpenChange={setShowReviewDialog}
          appointmentId={appointmentToReview._id}
          professionalName={`${appointmentToReview.professionalId?.firstName} ${appointmentToReview.professionalId?.lastName}`}
          onSuccess={handleReviewSuccess}
        />
      )}
    </div>
  );
}
