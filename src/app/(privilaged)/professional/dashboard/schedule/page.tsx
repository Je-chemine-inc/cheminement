"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  User,
  Filter,
  Loader2,
  Video,
  MapPin,
  Phone,
  CalendarPlus,
  Link as LinkIcon,
} from "lucide-react";
import { appointmentsAPI, clientsAPI } from "@/lib/api-client";
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
import {
  ProfessionalBookAppointmentModal,
  type BookableClient,
} from "@/components/appointments/ProfessionalBookAppointmentModal";
import { AppointmentEditDialog } from "@/components/appointments/AppointmentEditDialog";
import { CalendarSyncDialog } from "@/components/appointments/CalendarSyncDialog";
import { appointmentStatusColor } from "@/lib/appointment-colors";
import { AppointmentResponse } from "@/types/api";

export default function SchedulePage() {
  const t = useTranslations("Dashboard.scheduleCalendar");
  const locale = useLocale();
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

  // Direct-click scheduling + in-agenda edit (client feedback 1.2).
  const [clients, setClients] = useState<BookableClient[]>([]);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDefaults, setBookDefaults] = useState<{
    date?: string;
    time?: string;
  }>({});
  const [editApt, setEditApt] = useState<AppointmentResponse | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Anchor the window to UTC midnight of the LOCAL date so it includes
      // appointments stored at UTC midnight (e.g. 2026-05-13T00:00:00Z),
      // regardless of the user's timezone offset. Otherwise day view in
      // a UTC-4/-5 timezone produces $gte 2026-05-13T04:00:00Z and excludes
      // appointments at 00:00Z — which is why day view appeared empty.
      const y = currentDate.getFullYear();
      const m = currentDate.getMonth();
      const d = currentDate.getDate();
      const dow = currentDate.getDay();

      let startDate: Date;
      let endDate: Date;
      if (view === "week") {
        startDate = new Date(Date.UTC(y, m, d - dow));
        endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 7);
      } else if (view === "month") {
        startDate = new Date(Date.UTC(y, m, 1));
        endDate = new Date(startDate);
        endDate.setUTCMonth(startDate.getUTCMonth() + 1);
      } else {
        startDate = new Date(Date.UTC(y, m, d));
        endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 1);
      }

      const appointmentsData = await appointmentsAPI.list({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
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

  useEffect(() => {
    clientsAPI
      .list()
      .then((data) =>
        setClients(
          (data as Array<{ id: string; name: string; email?: string }>).map(
            (c) => ({ id: c.id, name: c.name, email: c.email }),
          ),
        ),
      )
      .catch(() => {});
  }, []);

  // Locale-aware date labels — render in the active language (FR/EN) instead of
  // hardcoded English. Recreating the formatters per render is cheap.
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const dowFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const fullDateFmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const monthYearFmt = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  });
  // Short weekday labels indexed by getDay() (0 = Sunday). Sept 1 2024 is a
  // Sunday, so the 7 days from it give Sun→Sat in the current locale.
  const dayNames = Array.from({ length: 7 }, (_, i) =>
    cap(dowFmt.format(new Date(2024, 8, 1 + i))),
  );

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

  const hours = Array.from({ length: 16 }, (_, i) => i + 8); // 8:00 → 23:00
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSameMonth = (date: Date) => {
    return date.getMonth() === currentDate.getMonth();
  };

  const formatDate = (date: Date) => fullDateFmt.format(date);

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

  // Build a local-date key (avoid UTC shift from toISOString)
  const localDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Get appointments for a specific date and hour
  const getAppointmentsForSlot = (date: Date, hour: number) => {
    const dateStr = localDateKey(date);
    return appointments.filter((apt) => {
      const aptDate = localDateKey(new Date(apt.date));
      const aptHour = parseInt(apt.time.split(":")[0]);
      return aptDate === dateStr && aptHour === hour;
    });
  };

  // Get appointments scheduled on the day currently being viewed
  const getDayAppointments = (date: Date) => {
    const target = localDateKey(date);
    return appointments.filter((apt) => {
      const aptDate = localDateKey(new Date(apt.date));
      return aptDate === target && apt.status === "scheduled";
    });
  };

  // Get pending requests on the day currently being viewed
  const getDayPendingRequests = (date: Date) => {
    const target = localDateKey(date);
    return appointments.filter((apt) => {
      const aptDate = localDateKey(new Date(apt.date));
      return aptDate === target && apt.status === "pending";
    });
  };

  const handleAddMeetingLink = (appointment: AppointmentResponse) => {
    setSelectedAppointment(appointment);
    setMeetingLink(appointment.meetingLink || "");
    setMeetingLinkDialogOpen(true);
  };

  const handleAppointmentClick = (appointment: AppointmentResponse) => {
    setEditApt(appointment);
  };

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const openBookForSlot = (date: Date, hour?: number) => {
    setBookDefaults({
      date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      time: typeof hour === "number" ? `${pad2(hour)}:00` : undefined,
    });
    setBookOpen(true);
  };

  // Drag-and-drop reschedule (week view): drop a dragged appointment onto an
  // empty hour cell to move it there. Notifies the client via the PATCH route.
  const handleDropToSlot = async (date: Date, hour: number) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const newDate = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const newTime = `${pad2(hour)}:00`;
    try {
      const res = await fetch(`/api/professional/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, time: newTime }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error("Error moving appointment:", err);
    }
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
      alert(t("alerts.updateLinkFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartSession = async (appointment: AppointmentResponse) => {
    if (appointment.type === "video" && !appointment.meetingLink) {
      alert(t("alerts.addLinkFirst"));
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
      alert(t("alerts.startFailed"));
    }
  };

  return (
    <div className="w-full p-6">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
            <CalendarSyncDialog />
            <Button
              className="gap-2"
              onClick={() => {
                setBookDefaults({});
                setBookOpen(true);
              }}
            >
              <CalendarPlus className="h-4 w-4" />
              {t("addAppointment")}
            </Button>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigateDate("prev")}
                className="p-2 rounded-full hover:bg-muted transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="text-xl font-serif font-light text-foreground sm:min-w-[200px] text-center">
                {view === "day" && formatDate(currentDate)}
                {view === "week" &&
                  `${t("weekOf")} ${formatDate(getWeekDays()[0])}`}
                {view === "month" && cap(monthYearFmt.format(currentDate))}
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
                            className="bg-card p-2 min-h-[60px] relative group"
                            onDragOver={(e) => {
                              if (draggingId) e.preventDefault();
                            }}
                            onDrop={() => handleDropToSlot(day, hour)}
                          >
                            {/* Empty-slot booking target, behind the chips. */}
                            <button
                              type="button"
                              aria-label={t("addAppointment")}
                              title={t("slotHint")}
                              onClick={() => openBookForSlot(day, hour)}
                              className="absolute inset-0 z-0 w-full h-full hover:bg-primary/5 transition-colors"
                            />
                            {!showRequests &&
                              dayAppointments.map((appointment, aptIdx) => {
                                // Span the block over its duration: each hour row
                                // is 61px tall (60px cell + 1px grid gap), so a
                                // 90-min RDV covers ~1.5 rows and a 120-min one
                                // ~2 rows. Absolutely positioned (z-20) over the
                                // hour cells below; the start cell holds no
                                // in-flow content so every row stays exactly 60px.
                                const spanHeight = Math.max(
                                  24,
                                  Math.round((appointment.duration / 60) * 61) -
                                    4,
                                );
                                // Side-by-side split if two RDV share a start hour
                                // (rare double-booking) so neither is hidden.
                                const count = dayAppointments.length;
                                const multi = count > 1;
                                return (
                                  <button
                                    type="button"
                                    key={appointment._id}
                                    draggable
                                    onDragStart={() =>
                                      setDraggingId(appointment._id)
                                    }
                                    onDragEnd={() => setDraggingId(null)}
                                    onClick={() =>
                                      handleAppointmentClick(appointment)
                                    }
                                    style={{
                                      height: `${spanHeight}px`,
                                      left: multi
                                        ? `calc(${(100 / count) * aptIdx}% + 2px)`
                                        : undefined,
                                      width: multi
                                        ? `calc(${100 / count}% - 3px)`
                                        : undefined,
                                    }}
                                    className={`absolute top-1 z-20 overflow-hidden text-left border rounded p-2 hover:brightness-95 transition-colors cursor-pointer ${multi ? "" : "left-1 right-1"} ${appointmentStatusColor(appointment.status)}`}
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
                                );
                              })}
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
            <div className="overflow-x-auto">
              <div className="grid grid-cols-7 gap-px bg-border/40 border border-border/40 rounded-lg overflow-hidden min-w-[640px]">
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
                  className={`bg-card p-3 min-h-[100px] relative group ${
                    !isSameMonth(day) ? "opacity-40" : ""
                  } ${isToday(day) ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}
                >
                  {/* Empty-day booking target, behind the chips. */}
                  <button
                    type="button"
                    aria-label={t("addAppointment")}
                    title={t("slotHint")}
                    onClick={() => openBookForSlot(day)}
                    className="absolute inset-0 z-0 w-full h-full hover:bg-primary/5 transition-colors"
                  />
                  <div
                    className={`text-sm font-light mb-2 ${isToday(day) ? "text-primary font-medium" : "text-foreground"}`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-1 relative z-10">
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
                            className={`w-full text-left rounded px-2 py-1 text-xs font-light truncate border cursor-pointer hover:brightness-95 ${appointmentStatusColor(appointment.status)}`}
                          >
                            {appointment.time} {appointment.clientId.firstName}{" "}
                            {appointment.clientId.lastName}
                          </button>
                        ))}
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : view === "day" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                <div className="rounded-lg bg-muted/30 p-4">
                  <div className="text-sm font-light text-muted-foreground mb-1">
                    {t("totalSessions")}
                  </div>
                  <div className="text-2xl font-serif font-light text-foreground">
                    {getDayAppointments(currentDate).length}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-4">
                  <div className="text-sm font-light text-muted-foreground mb-1">
                    {t("pendingRequests")}
                  </div>
                  <div className="text-2xl font-serif font-light text-foreground">
                    {getDayPendingRequests(currentDate).length}
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
                            className={`w-full text-left border rounded-lg p-3 hover:brightness-95 transition-colors cursor-pointer ${appointmentStatusColor(appointment.status)}`}
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
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleStartSession(appointment);
                                        }}
                                        className="px-4 py-2 bg-primary text-primary-foreground rounded-full font-light text-sm hover:scale-105 transition-transform"
                                      >
                                        {appointment.status === "ongoing"
                                          ? t("joinSession")
                                          : t("startSession")}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAddMeetingLink(appointment);
                                        }}
                                        className="p-2 rounded-full hover:bg-muted transition-colors"
                                        title={t("meetingLink.titleUpdate")}
                                      >
                                        <LinkIcon className="h-4 w-4 text-primary" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAddMeetingLink(appointment);
                                      }}
                                      className="px-4 py-2 bg-muted text-foreground rounded-full font-light text-sm hover:bg-muted/80 transition-colors flex items-center gap-2"
                                    >
                                      <LinkIcon className="h-4 w-4" />
                                      {t("addLink")}
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

      {/* Direct-click scheduling: book a client into the selected slot. */}
      <ProfessionalBookAppointmentModal
        open={bookOpen}
        onOpenChange={setBookOpen}
        clients={clients}
        defaultDate={bookDefaults.date}
        defaultTime={bookDefaults.time}
        onCreated={() => {
          setBookOpen(false);
          fetchData();
        }}
      />

      {/* In-agenda edit / reschedule / cancel. */}
      {editApt && (
        <AppointmentEditDialog
          key={editApt._id}
          appointment={editApt}
          apiBase="/api/professional/appointments"
          sessionHref={`/professional/dashboard/sessions/${editApt._id}`}
          onClose={() => setEditApt(null)}
          onSaved={() => {
            setEditApt(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
