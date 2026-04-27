"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  User,
  Filter,
  Loader2,
  Video,
  MapPin,
  Phone,
  Link as LinkIcon,
} from "lucide-react";
import { appointmentsAPI } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { AppointmentResponse } from "@/types/api";

export default function SchedulePage() {
  const t = useTranslations("Dashboard.scheduleCalendar");
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [showRequests, setShowRequests] = useState(false);
  const [appointments, setAppointments] = useState<AppointmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentResponse | null>(null);
  const [meetingLinkDialogOpen, setMeetingLinkDialogOpen] = useState(false);
  const [meetingLink, setMeetingLink] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Get appointments for current view
      const startDate = new Date(currentDate);
      if (view === "week") {
        startDate.setDate(currentDate.getDate() - currentDate.getDay());
      } else if (view === "month") {
        startDate.setDate(1);
      }
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      if (view === "day") {
        endDate.setDate(startDate.getDate() + 1);
      } else if (view === "week") {
        endDate.setDate(startDate.getDate() + 7);
      } else {
        endDate.setMonth(startDate.getMonth() + 1);
      }

      const appointmentsData = await appointmentsAPI.list({
        startDate: startDate.toISOString(),
        endDate: endDate.toDateString(),
      });
      setAppointments(appointmentsData);
    } catch (err: unknown) {
      console.error("Error fetching schedule data:", err);
    } finally {
      setLoading(false);
    }
  }, [currentDate, view]);

  useEffect(() => {
    fetchData();
  }, [currentDate, fetchData]);

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const navigateDate = (direction: "prev" | "next") => {
    const newDate = new Date(currentDate);
    if (view === "day") {
      newDate.setDate(currentDate.getDate() + (direction === "next" ? 1 : -1));
    } else if (view === "week") {
      newDate.setDate(currentDate.getDate() + (direction === "next" ? 7 : -7));
    } else {
      newDate.setMonth(
        currentDate.getMonth() + (direction === "next" ? 1 : -1),
      );
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getWeekDays = () => {
    const start = new Date(currentDate);
    start.setDate(currentDate.getDate() - currentDate.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  };

  const getMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const days = [];
    const current = new Date(startDate);

    while (days.length < 42) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  const hours = Array.from({ length: 13 }, (_, i) => i + 8);
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSameMonth = (date: Date) => {
    return date.getMonth() === currentDate.getMonth();
  };

  const formatDate = (date: Date) => {
    return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  };

  // Color-code time slots based on time of day
  const getTimeSlotColor = (time: string) => {
    const hour = parseInt(time.split(":")[0], 10);

    // Early morning
    if (hour >= 6 && hour < 10) {
      return "bg-emerald-50/80 border-emerald-200 text-emerald-900";
    }

    // Late morning / midday
    if (hour >= 10 && hour < 14) {
      return "bg-sky-50/80 border-sky-200 text-sky-900";
    }

    // Afternoon
    if (hour >= 14 && hour < 18) {
      return "bg-amber-50/80 border-amber-200 text-amber-900";
    }

    // Evening
    if (hour >= 18 && hour < 22) {
      return "bg-violet-50/80 border-violet-200 text-violet-900";
    }

    // Night / fallback
    return "bg-slate-50/80 border-slate-200 text-slate-900";
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4" />;
      case "in-person":
        return <MapPin className="h-4 w-4" />;
      case "phone":
        return <Phone className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  // Get appointments for a specific date and hour
  const getAppointmentsForSlot = (date: Date, hour: number) => {
    const dateStr = date.toISOString().split("T")[0];
    return appointments.filter((apt) => {
      const aptDate = new Date(apt.date).toISOString().split("T")[0];
      const aptHour = parseInt(apt.time.split(":")[0]);
      return aptDate === dateStr && aptHour === hour;
    });
  };

  // Get today's appointments
  const getTodayAppointments = () => {
    const today = new Date().toISOString().split("T")[0];
    return appointments.filter((apt) => {
      const aptDate = new Date(apt.date).toISOString().split("T")[0];
      return aptDate === today && apt.status === "scheduled";
    });
  };

  const handleAddMeetingLink = (appointment: AppointmentResponse) => {
    setSelectedAppointment(appointment);
    setMeetingLink(appointment.meetingLink || "");
    setMeetingLinkDialogOpen(true);
  };

  const handleAppointmentClick = (appointment: AppointmentResponse) => {
    router.push(`/professional/dashboard/sessions/${appointment._id}`);
  };

  const handleSaveMeetingLink = async () => {
    if (!selectedAppointment || !meetingLink) return;

    try {
      setIsSubmitting(true);
      const response = await fetch(
        `/api/appointments/${selectedAppointment._id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            meetingLink: meetingLink,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to update meeting link");
      }

      // Update the local state
      setAppointments((prevAppointments) =>
        prevAppointments.map((apt) =>
          apt._id === selectedAppointment._id
            ? { ...apt, meetingLink: meetingLink }
            : apt,
        ),
      );

      // Close dialog and reset state
      setMeetingLinkDialogOpen(false);
      setMeetingLink("");
      setSelectedAppointment(null);
    } catch (error) {
      console.error("Error updating meeting link:", error);
      alert("Failed to update meeting link. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartSession = async (appointment: AppointmentResponse) => {
    if (appointment.type === "video" && !appointment.meetingLink) {
      alert("Please add a meeting link before starting the session.");
      handleAddMeetingLink(appointment);
      return;
    }

    try {
      const response = await appointmentsAPI.update(appointment._id, {
        status: "ongoing",
      });

      // Update the local state
      setAppointments((prevAppointments) =>
        prevAppointments.map((apt) =>
          apt._id === appointment._id ? { ...response } : apt,
        ),
      );

      // Open meeting link in new tab for video appointments
      if (appointment.type === "video" && appointment.meetingLink) {
        window.open(appointment.meetingLink, "_blank");
      }
    } catch (error) {
      console.error("Error starting session:", error);
      alert("Failed to start session. Please try again.");
    }
  };

  return (
    <div className="w-full p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-light text-foreground">
              {t("title")}
            </h1>
            <p className="text-muted-foreground font-light mt-1">
              {t("subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowRequests(!showRequests)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-light text-sm transition-colors ${
                showRequests
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              <Filter className="h-4 w-4" />
              {showRequests ? t("showSessions") : t("showRequests")}
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigateDate("prev")}
                className="p-2 rounded-full hover:bg-muted transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="text-xl font-serif font-light text-foreground min-w-[200px] text-center">
                {view === "day" && formatDate(currentDate)}
                {view === "week" &&
                  `${t("weekOf")} ${formatDate(getWeekDays()[0])}`}
                {view === "month" &&
                  `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
              </h2>
              <button
                onClick={() => navigateDate("next")}
                className="p-2 rounded-full hover:bg-muted transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={goToToday}
                className="px-4 py-2 text-sm font-light text-primary hover:bg-primary/10 rounded-full transition-colors"
              >
                {t("today")}
              </button>
              <div className="flex items-center gap-1 bg-muted rounded-full p-1">
                <button
                  onClick={() => setView("day")}
                  className={`px-3 py-1 text-sm font-light rounded-full transition-colors ${
                    view === "day"
                      ? "bg-background text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {t("day")}
                </button>
                <button
                  onClick={() => setView("week")}
                  className={`px-3 py-1 text-sm font-light rounded-full transition-colors ${
                    view === "week"
                      ? "bg-background text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {t("week")}
                </button>
                <button
                  onClick={() => setView("month")}
                  className={`px-3 py-1 text-sm font-light rounded-full transition-colors ${
                    view === "month"
                      ? "bg-background text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {t("month")}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : view === "week" ? (
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                <div className="grid grid-cols-8 gap-px bg-border/40 border border-border/40 rounded-lg overflow-hidden">
                  <div className="bg-muted/30 p-2"></div>
                  {getWeekDays().map((day, idx) => (
                    <div
                      key={idx}
                      className={`bg-card p-3 text-center ${
                        isToday(day) ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="text-xs font-light text-muted-foreground mb-1">
                        {dayNames[day.getDay()]}
                      </div>
                      <div
                        className={`text-sm font-light ${
                          isToday(day)
                            ? "text-primary font-medium"
                            : "text-foreground"
                        }`}
                      >
                        {day.getDate()}
                      </div>
                    </div>
                  ))}

                  {hours.map((hour) => (
                    <React.Fragment key={hour}>
                      <div className="bg-muted/30 p-2 text-xs font-light text-muted-foreground text-right">
                        {hour}:00
                      </div>
                      {getWeekDays().map((day, idx) => {
                        const dayAppointments = getAppointmentsForSlot(
                          day,
                          hour,
                        );
                        return (
                          <div
                            key={`day-${day}-${hour}-${idx}`}
                            className="bg-card p-2 min-h-[60px] relative"
                          >
                            {!showRequests &&
                              dayAppointments.map((appointment) => (
                                <button
                                  type="button"
                                  key={appointment._id}
                                  onClick={() =>
                                    handleAppointmentClick(appointment)
                                  }
                                  className={`w-full text-left border rounded p-2 mb-1 hover:brightness-95 transition-colors cursor-pointer ${getTimeSlotColor(appointment.time)}`}
                                >
                                  <div className="flex items-center gap-1 text-xs font-light">
                                    {getTypeIcon(appointment.type)}
                                    <span className="text-foreground ml-1">
                                      {appointment.clientId.firstName}{" "}
                                      {appointment.clientId.lastName}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground font-light mt-1">
                                    {appointment.time} ({appointment.duration}m)
                                  </div>
                                </button>
                              ))}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {view === "month" && (
            <div className="grid grid-cols-7 gap-px bg-border/40 border border-border/40 rounded-lg overflow-hidden">
              {dayNames.map((day) => (
                <div
                  key={day}
                  className="bg-muted/30 p-3 text-center text-sm font-light text-muted-foreground"
                >
                  {day}
                </div>
              ))}
              {getMonthDays().map((day, idx) => (
                <div
                  key={idx}
                  className={`bg-card p-3 min-h-[100px] ${
                    !isSameMonth(day) ? "opacity-40" : ""
                  } ${isToday(day) ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}
                >
                  <div
                    className={`text-sm font-light mb-2 ${isToday(day) ? "text-primary font-medium" : "text-foreground"}`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-1">
                    {!showRequests &&
                      appointments
                        .filter((apt) => {
                          const aptDate = new Date(apt.date);
                          return (
                            aptDate.getDate() === day.getDate() &&
                            aptDate.getMonth() === day.getMonth() &&
                            aptDate.getFullYear() === day.getFullYear()
                          );
                        })
                        .slice(0, 2)
                        .map((appointment) => (
                          <button
                            type="button"
                            key={appointment._id}
                            onClick={() => handleAppointmentClick(appointment)}
                            className={`w-full text-left rounded px-2 py-1 text-xs font-light truncate border cursor-pointer hover:brightness-95 ${getTimeSlotColor(appointment.time)}`}
                          >
                            {appointment.time} {appointment.clientId.firstName}{" "}
                            {appointment.clientId.lastName}
                          </button>
                        ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : view === "day" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="rounded-lg bg-muted/30 p-4">
                  <div className="text-sm font-light text-muted-foreground mb-1">
                    {t("totalSessions")}
                  </div>
                  <div className="text-2xl font-serif font-light text-foreground">
                    {getTodayAppointments().length}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-4">
                  <div className="text-sm font-light text-muted-foreground mb-1">
                    {t("pendingRequests")}
                  </div>
                </div>
              </div>

              {hours.map((hour) => {
                const hourAppointments = getAppointmentsForSlot(
                  currentDate,
                  hour,
                );
                return (
                  <div key={hour} className="flex gap-4">
                    <div className="w-20 text-sm font-light text-muted-foreground pt-2">
                      {hour}:00
                    </div>
                    <div className="flex-1 min-h-[60px] border-l border-border/40 pl-4 space-y-2">
                      {!showRequests &&
                        hourAppointments.map((appointment) => (
                          <button
                            type="button"
                            key={appointment._id}
                            onClick={() => handleAppointmentClick(appointment)}
                            className={`w-full text-left border rounded-lg p-3 hover:brightness-95 transition-colors cursor-pointer ${getTimeSlotColor(appointment.time)}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="text-xl">
                                  {getTypeIcon(appointment.type)}
                                </span>
                                <div>
                                  <div className="font-light text-foreground">
                                    {appointment.clientId.firstName}{" "}
                                    {appointment.clientId.lastName}
                                  </div>
                                  <div className="text-sm text-muted-foreground font-light">
                                    {appointment.time} - {appointment.duration}{" "}
                                    minutes
                                    {appointment.issueType &&
                                      ` • ${appointment.issueType}`}
                                  </div>
                                </div>
                              </div>
                              {appointment.type === "video" && (
                                <>
                                  {appointment.meetingLink ? (
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() =>
                                          handleStartSession(appointment)
                                        }
                                        className="px-4 py-2 bg-primary text-primary-foreground rounded-full font-light text-sm hover:scale-105 transition-transform"
                                      >
                                        {appointment.status === "ongoing"
                                          ? "Join Session"
                                          : t("startSession")}
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleAddMeetingLink(appointment)
                                        }
                                        className="p-2 rounded-full hover:bg-muted transition-colors"
                                        title="Update Meeting Link"
                                      >
                                        <LinkIcon className="h-4 w-4 text-primary" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        handleAddMeetingLink(appointment)
                                      }
                                      className="px-4 py-2 bg-muted text-foreground rounded-full font-light text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
                                    >
                                      <LinkIcon className="h-4 w-4" />
                                      Add Link
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Meeting Link Dialog */}
      <Dialog
        open={meetingLinkDialogOpen}
        onOpenChange={setMeetingLinkDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              {selectedAppointment?.meetingLink
                ? t("meetingLink.titleUpdate")
                : t("meetingLink.titleAdd")}
            </DialogTitle>
            <DialogDescription>
              {t("meetingLink.desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="meeting-link" className="text-sm font-light">
                {t("meetingLink.urlLabel")}
              </Label>
              <Input
                id="meeting-link"
                type="url"
                placeholder={t("meetingLink.urlPlaceholder")}
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                className="font-light"
              />
            </div>
            {selectedAppointment && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <p className="text-xs text-muted-foreground font-light">
                  {t("meetingLink.appointmentDetails")}
                </p>
                <p className="text-sm font-light">
                  {selectedAppointment.clientId.firstName}{" "}
                  {selectedAppointment.clientId.lastName}
                </p>
                <p className="text-xs text-muted-foreground font-light">
                  {new Date(selectedAppointment.date).toLocaleDateString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}{" "}
                  {t("meetingLink.at")} {selectedAppointment.time}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground font-light">
                    {t("meetingLink.payment")}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      selectedAppointment.payment?.status === "paid"
                        ? "bg-green-100 text-green-700"
                        : selectedAppointment.payment?.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : selectedAppointment.payment?.status === "refunded"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {t(`paymentStatus.${selectedAppointment.payment?.status ?? "pending"}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ${selectedAppointment.payment?.price?.toFixed(2) || "0.00"}{" "}
                    CAD
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMeetingLinkDialogOpen(false);
                setMeetingLink("");
                setSelectedAppointment(null);
              }}
              disabled={isSubmitting}
            >
              {t("meetingLink.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSaveMeetingLink}
              disabled={!meetingLink || isSubmitting}
            >
              {isSubmitting ? t("meetingLink.saving") : t("meetingLink.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
