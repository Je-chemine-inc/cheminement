"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Search,
  Filter,
  Calendar,
  Clock,
  Video,
  MapPin,
  ChevronDown,
  ChevronUp,
  Eye,
  MessageSquare,
  Link as LinkIcon,
} from "lucide-react";
import { appointmentsAPI } from "@/lib/api-client";
import { getAppointmentBeneficiary } from "@/lib/appointment-beneficiary";

interface ApiAppointment {
  _id: string;
  clientId: {
    _id: string;
    firstName: string;
    lastName: string;
  };
  date: string;
  time: string;
  duration: number;
  type: "video" | "in-person" | "phone";
  status: string;
  payment: {
    // price + platformFee are stripped by the API for professional callers.
    professionalPayout: number;
    status:
      | "pending"
      | "processing"
      | "paid"
      | "failed"
      | "refunded"
      | "cancelled";
    stripePaymentIntentId?: string;
    stripePaymentMethodId?: string;
    paidAt?: string;
  };
  issueType?: string;
  notes?: string;
  meetingLink?: string;
  bookingFor?: "self" | "patient" | "loved-one";
  lovedOneInfo?: {
    firstName?: string;
    lastName?: string;
    relationship?: string;
  } | null;
  referralInfo?: {
    patientFirstName?: string;
    patientLastName?: string;
  } | null;
}

interface Session {
  id: string;
  clientName: string;
  clientId: string;
  date: Date;
  time: string;
  duration: number;
  type: "in-person" | "video" | "phone";
  status:
    | "scheduled"
    | "completed"
    | "cancelled"
    | "no-show"
    | "pending"
    | "ongoing";
  paymentStatus: "paid" | "pending";
  amount: number;
  issueType?: string;
  notes?: string;
  meetingLink?: string;
  /** Who the session is for, when different from the account holder (clientId). */
  beneficiary?: { name: string; relationship?: string } | null;
}

export default function SessionsPage() {
  const router = useRouter();
  const t = useTranslations("Dashboard.sessions");
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [meetingLinkDialogOpen, setMeetingLinkDialogOpen] = useState(false);
  const [meetingLink, setMeetingLink] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch("/api/appointments");
        if (!response.ok) {
          throw new Error("Failed to fetch sessions");
        }
        const data = await response.json();
        const list: ApiAppointment[] = Array.isArray(data) ? data : [];
        const transformedSessions: Session[] = list
          // The sessions view is date-driven (toISOString() in the memos below).
          // Skip rows that would break it: matched-but-unscheduled requests have
          // no date yet (they live in the proposals "À planifier" tab), and an
          // orphan appointment can have a null client. Either one previously
          // crashed the whole page to a white screen.
          .filter(
            (appointment) =>
              appointment?.clientId &&
              appointment.date &&
              !Number.isNaN(new Date(appointment.date).getTime()),
          )
          .map((appointment: ApiAppointment) => {
            // Pros see only Paid vs Pending; anything non-paid collapses to pending.
            const paymentStatus: "paid" | "pending" =
              appointment.payment?.status === "paid" ? "paid" : "pending";

            return {
              id: appointment._id,
              clientName: `${appointment.clientId.firstName} ${appointment.clientId.lastName}`,
              clientId: appointment.clientId._id,
              date: new Date(appointment.date),
              time: appointment.time,
              duration: appointment.duration,
              type: appointment.type,
              status: appointment.status as Session["status"],
              paymentStatus,
              amount: appointment.payment?.professionalPayout || 0,
              issueType: appointment.issueType,
              notes: appointment.notes,
              meetingLink: appointment.meetingLink,
              beneficiary: getAppointmentBeneficiary(appointment),
            };
          },
        );
        setSessions(transformedSessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, []);

  // Categorize sessions
  const todaysSessions = useMemo(() => {
    return sessions
      .filter((session) => {
        return (
          session.date.toDateString() === today.toDateString() &&
          session.status === "scheduled"
        );
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [sessions, today]);

  const nextSession = useMemo(() => {
    const upcoming = sessions
      .filter((session) => {
        const sessionDateTime = new Date(
          `${session.date.toISOString().split("T")[0]}T${session.time}`,
        );
        return sessionDateTime > today && session.status === "scheduled";
      })
      .sort((a, b) => {
        const dateA = new Date(
          `${a.date.toISOString().split("T")[0]}T${a.time}`,
        );
        const dateB = new Date(
          `${b.date.toISOString().split("T")[0]}T${b.time}`,
        );
        return dateA.getTime() - dateB.getTime();
      });
    return upcoming[0] || null;
  }, [sessions, today]);

  const upcomingSessions = useMemo(() => {
    return sessions
      .filter((session) => {
        const sessionDateTime = new Date(
          `${session.date.toISOString().split("T")[0]}T${session.time}`,
        );
        return (
          sessionDateTime > today &&
          session.status === "scheduled" &&
          session.id !== nextSession?.id
        );
      })
      .sort((a, b) => {
        const dateA = new Date(
          `${a.date.toISOString().split("T")[0]}T${a.time}`,
        );
        const dateB = new Date(
          `${b.date.toISOString().split("T")[0]}T${b.time}`,
        );
        return dateA.getTime() - dateB.getTime();
      })
      .slice(0, 5);
  }, [sessions, nextSession, today]);

  // Filter all sessions
  const filteredSessions = useMemo(() => {
    return sessions
      .filter((session) => {
        const matchesSearch =
          session.clientName
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          (session.issueType &&
            session.issueType
              .toLowerCase()
              .includes(searchQuery.toLowerCase()));

        const matchesStatus =
          statusFilter === "all" || session.status === statusFilter;

        const matchesType = typeFilter === "all" || session.type === typeFilter;

        const matchesPayment =
          paymentFilter === "all" || session.paymentStatus === paymentFilter;

        return matchesSearch && matchesStatus && matchesType && matchesPayment;
      })
      .sort((a, b) => {
        const dateA = new Date(
          `${a.date.toISOString().split("T")[0]}T${a.time}`,
        );
        const dateB = new Date(
          `${b.date.toISOString().split("T")[0]}T${b.time}`,
        );
        return dateB.getTime() - dateA.getTime();
      });
  }, [sessions, searchQuery, statusFilter, typeFilter, paymentFilter]);

  const stats = useMemo(() => {
    return {
      today: todaysSessions.length,
      upcoming: sessions.filter(
        (s) => s.date > today && s.status === "scheduled",
      ).length,
      completed: sessions.filter((s) => s.status === "completed").length,
      revenue: sessions
        .filter((s) => s.paymentStatus === "paid")
        .reduce((sum, s) => sum + s.amount, 0),
    };
  }, [sessions, todaysSessions, today]);

  const getStatusBadge = (status: Session["status"]) => {
    const styles = {
      scheduled: "bg-blue-100 text-blue-700",
      completed: "bg-green-100 text-green-700",
      cancelled: "bg-red-100 text-red-700",
      "no-show": "bg-orange-100 text-orange-700",
      pending: "bg-yellow-100 text-yellow-700",
      ongoing: "bg-purple-100 text-purple-700",
    };

    const labels = {
      scheduled: t("scheduled"),
      completed: t("completed"),
      cancelled: t("cancelled"),
      "no-show": t("noShow"),
      pending: t("pending"),
      ongoing: t("ongoing"),
    };

    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-light ${styles[status]}`}
      >
        {labels[status]}
      </span>
    );
  };

  const getPaymentStatusBadge = (paymentStatus: Session["paymentStatus"]) => {
    const styles = {
      paid: "bg-green-100 text-green-700",
      pending: "bg-yellow-100 text-yellow-700",
    };

    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-light ${styles[paymentStatus]}`}
      >
        {t(paymentStatus)}
      </span>
    );
  };

  const getTypeIcon = (type: Session["type"]) => {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4" />;
      case "in-person":
        return <MapPin className="h-4 w-4" />;
      case "phone":
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    if (locale === "fr") {
        return `${hour}h${minutes}`;
    }
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatFullDate = (date: Date) => {
    return date.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleAddMeetingLink = (session: Session) => {
    setSelectedSession(session);
    setMeetingLink(session.meetingLink || "");
    setMeetingLinkDialogOpen(true);
  };

  const handleSaveMeetingLink = async () => {
    if (!selectedSession || !meetingLink) return;

    try {
      setIsSubmitting(true);
      await appointmentsAPI.update(selectedSession.id, {
        meetingLink,
      });

      // Update the local state
      setSessions((prevSessions) =>
        prevSessions.map((session) =>
          session.id === selectedSession.id
            ? { ...session, meetingLink: meetingLink }
            : session,
        ),
      );

      // Close dialog and reset state
      setMeetingLinkDialogOpen(false);
      setMeetingLink("");
      setSelectedSession(null);
    } catch (error) {
      console.error("Error updating meeting link:", error);
      alert(t("failedUpdateMeetingLink"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartSession = async (session: Session) => {
    if (session.type === "video" && !session.meetingLink) {
      alert(t("addMeetingLinkFirst"));
      handleAddMeetingLink(session);
      return;
    }

    try {
      await appointmentsAPI.update(session.id, {
        status: "ongoing",
      });

      // Update the local state
      setSessions((prevSessions) =>
        prevSessions.map((s) =>
          s.id === session.id ? { ...s, status: "ongoing" } : s,
        ),
      );

      // Open meeting link in new tab for video appointments
      if (session.type === "video" && session.meetingLink) {
        window.open(session.meetingLink, "_blank");
      }
    } catch (error) {
      console.error("Error starting session:", error);
      alert(t("failedStartSession"));
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex justify-center items-center h-64">
          <p>{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex justify-center items-center h-64">
          <p className="text-red-500">
            {t("errorPrefix")} {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="text-muted-foreground font-light mt-2">{t("subtitle")}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("todaySchedule")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {stats.today}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("upcomingTitle")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {stats.upcoming}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("completed")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {stats.completed}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("earnings")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            ${stats.revenue.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Next Session Highlight */}
      {nextSession && (
        <div className="rounded-xl bg-linear-to-r from-primary/10 via-primary/5 to-transparent p-6 border border-primary/20">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-serif font-light text-foreground">
                  {t("nextSession")}
                </h2>
              </div>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-2xl font-serif font-light text-foreground mb-2">
                    {nextSession.clientName}
                  </p>
                  {nextSession.beneficiary && (
                    <p className="text-sm font-medium text-primary mb-2">
                      {t("forLabel")}: {nextSession.beneficiary.name}
                      {nextSession.beneficiary.relationship
                        ? ` (${nextSession.beneficiary.relationship})`
                        : ""}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground font-light">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>{formatFullDate(nextSession.date)}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-light">
                      {formatTime(nextSession.time)} ({nextSession.duration}{" "}
                      {t("minutes")})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getTypeIcon(nextSession.type)}
                    <span className="text-sm font-light capitalize">
                      {t(nextSession.type)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPaymentStatusBadge(nextSession.paymentStatus)}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  router.push(
                    `/professional/dashboard/sessions/${nextSession.id}`,
                  )
                }
                className="px-6 py-2.5 bg-muted text-foreground rounded-full font-light tracking-wide transition-all duration-300 hover:bg-muted/80"
              >
                {t("viewDetails")}
              </button>
              <button
                onClick={() => handleStartSession(nextSession)}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg"
              >
                {t("startSession")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Today's Sessions */}
      {todaysSessions.length > 0 && (
        <div className="rounded-xl bg-card p-6">
          <h2 className="text-xl font-serif font-light text-foreground mb-4">
            {t("todaySchedule")}
          </h2>
          <div className="space-y-3">
            {todaysSessions.map((session) => (
              <div
                key={session.id}
                className="rounded-lg bg-muted/30 p-4 flex items-center justify-between gap-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="text-center min-w-[60px]">
                    <p className="text-sm font-light text-muted-foreground">
                      {formatTime(session.time)}
                    </p>
                    <p className="text-xs text-muted-foreground font-light">
                      {session.duration} {t("minutes")}
                    </p>
                  </div>
                  <div className="w-px h-12 bg-border/40" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground mb-1">
                      {session.clientName}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground font-light">
                      <div className="flex items-center gap-1">
                        {getTypeIcon(session.type)}
                        <span className="capitalize">
                          {t(session.type)}
                        </span>
                      </div>
                      <span>•</span>
                      <span>{session.issueType}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPaymentStatusBadge(session.paymentStatus)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      router.push(
                        `/professional/dashboard/sessions/${session.id}`,
                      )
                    }
                    className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                    title={t("viewDetails")}
                  >
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => handleStartSession(session)}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-full font-light text-sm transition-all duration-300 hover:scale-105"
                  >
                    {t("startSession")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Sessions Preview */}
      {upcomingSessions.length > 0 && (
        <div className="rounded-xl bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("upcomingTitle")}
            </h2>
            <span className="text-sm text-muted-foreground font-light">
              {t("noUpcoming")}
            </span>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingSessions.map((session) => (
              <div
                key={session.id}
                className="rounded-lg bg-muted/30 p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {getTypeIcon(session.type)}
                    <p className="text-sm font-medium text-foreground">
                      {session.clientName}
                    </p>
                  </div>
                  {getPaymentStatusBadge(session.paymentStatus)}
                </div>
                <div className="space-y-2 text-xs text-muted-foreground font-light">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(session.date)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatTime(session.time)} • {session.duration}{" "}
                      {t("minutes")}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="rounded-xl bg-card overflow-hidden">
        <div className="p-6 pb-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Filter className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-serif font-light text-foreground">
                {t("filters")}
              </h2>
              {isFilterExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {(searchQuery ||
              statusFilter !== "all" ||
              typeFilter !== "all" ||
              paymentFilter !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setTypeFilter("all");
                  setPaymentFilter("all");
                }}
                className="text-sm text-primary hover:text-primary/80 font-light transition-colors"
              >
                {t("hideFilters")}
              </button>
            )}
          </div>

          {!isFilterExpanded &&
            (searchQuery ||
              statusFilter !== "all" ||
              typeFilter !== "all" ||
              paymentFilter !== "all") && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {searchQuery && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("searchPrefix")} {searchQuery}
                  </span>
                )}
                {statusFilter !== "all" && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("statusPrefix")} {statusFilter}
                  </span>
                )}
                {typeFilter !== "all" && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("typePrefix")} {typeFilter}
                  </span>
                )}
                {paymentFilter !== "all" && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("paymentPrefix")} {paymentFilter}
                  </span>
                )}
              </div>
            )}
        </div>

        {isFilterExpanded && (
          <div className="px-6 pb-6 space-y-6 border-t border-border/40 pt-6">
            <div>
              <label className="text-sm font-light text-muted-foreground mb-2 block">
                {t("allSessions")}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-light text-muted-foreground mb-2 block">
                  {t("status")}
                </label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-light">{t("all")}</span>
                    </SelectItem>
                    <SelectItem value="scheduled">
                      <span className="font-light">{t("scheduled")}</span>
                    </SelectItem>
                    <SelectItem value="completed">
                      <span className="font-light">{t("completed")}</span>
                    </SelectItem>
                    <SelectItem value="cancelled">
                      <span className="font-light">{t("cancelled")}</span>
                    </SelectItem>
                    <SelectItem value="no-show">
                      <span className="font-light">{t("noShow")}</span>
                    </SelectItem>
                    <SelectItem value="pending">
                      <span className="font-light">{t("pending")}</span>
                    </SelectItem>
                    <SelectItem value="ongoing">
                      <span className="font-light">{t("ongoing")}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-light text-muted-foreground mb-2 block">
                  {t("type")}
                </label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("type")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-light">{t("all")}</span>
                    </SelectItem>
                    <SelectItem value="video">
                      <span className="font-light">{t("video")}</span>
                    </SelectItem>
                    <SelectItem value="in-person">
                      <span className="font-light">{t("inPerson")}</span>
                    </SelectItem>
                    <SelectItem value="phone">
                      <span className="font-light">{t("phone")}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-light text-muted-foreground mb-2 block">
                  {t("payment")}
                </label>
                <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("payment")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-light">{t("all")}</span>
                    </SelectItem>
                    <SelectItem value="paid">
                      <span className="font-light">{t("paid")}</span>
                    </SelectItem>
                    <SelectItem value="pending">
                      <span className="font-light">{t("pending")}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-4 border-t border-border/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-light">
                  <span className="font-medium text-foreground">
                    {filteredSessions.length}
                  </span>
                  <span>
                    {sessions.length} {t("allSessions")}
                  </span>
                </div>
                {filteredSessions.length !== sessions.length && (
                  <span className="text-xs text-primary font-light">
                    {t("showFilters")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* All Sessions Table */}
      <div className="rounded-xl bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/40">
          <h2 className="text-lg font-serif font-light text-foreground">
            {t("allSessions")}
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-light">{t("client")}</TableHead>
              <TableHead className="font-light">{t("dateTime")}</TableHead>
              <TableHead className="font-light">{t("type")}</TableHead>
              <TableHead className="font-light">{t("duration")}</TableHead>
              <TableHead className="font-light">{t("status")}</TableHead>
              <TableHead className="font-light">{t("payment")}</TableHead>
              <TableHead className="font-light">{t("earnings")}</TableHead>
              <TableHead className="font-light">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSessions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground font-light"
                >
                  {t("noSessions")}
                </TableCell>
              </TableRow>
            ) : (
              filteredSessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-light">
                    <div>
                      <p className="font-medium text-foreground">
                        {session.clientName}
                      </p>
                      {session.beneficiary && (
                        <p className="text-xs font-medium text-primary">
                          {t("forLabel")}: {session.beneficiary.name}
                          {session.beneficiary.relationship
                            ? ` (${session.beneficiary.relationship})`
                            : ""}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {session.issueType}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="font-light">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span>{formatDate(session.date)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-sm">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span>{formatTime(session.time)}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-light">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(session.type)}
                      <span className="text-sm capitalize">
                        {t(session.type)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-light">
                    <span className="text-sm">
                      {session.duration} {t("minutes")}
                    </span>
                  </TableCell>
                  <TableCell>{getStatusBadge(session.status)}</TableCell>
                  <TableCell>
                    {getPaymentStatusBadge(session.paymentStatus)}
                  </TableCell>
                  <TableCell className="font-light">
                    <span className="text-sm font-medium">
                      ${session.amount.toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          router.push(
                            `/professional/dashboard/sessions/${session.id}`,
                          )
                        }
                        className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                        title={t("viewDetails")}
                      >
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </button>
                      {session.type === "video" &&
                        session.status === "scheduled" && (
                          <button
                            onClick={() => handleAddMeetingLink(session)}
                            className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                            title={
                              session.meetingLink
                                ? t("updateMeetingLink")
                                : t("addMeetingLink")
                            }
                          >
                            <LinkIcon
                              className={`h-4 w-4 ${session.meetingLink ? "text-primary" : "text-muted-foreground"}`}
                            />
                          </button>
                        )}
                      {(session.status === "scheduled" ||
                        session.status === "ongoing") && (
                        <button
                          onClick={() => handleStartSession(session)}
                          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-full font-light text-xs transition-all duration-300 hover:scale-105"
                        >
                          {session.status === "ongoing"
                            ? t("joinSession")
                            : t("startSession")}
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
              {selectedSession?.meetingLink
                ? t("updateMeetingLink")
                : t("addMeetingLink")}
            </DialogTitle>
            <DialogDescription>
              {t("meetingLinkDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="meeting-link" className="text-sm font-light">
                {t("meetingLinkUrl")}
              </Label>
              <Input
                id="meeting-link"
                type="url"
                placeholder={t("urlPlaceholder")}
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                className="font-light"
              />
            </div>
            {selectedSession && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground font-light">
                  {t("appointmentDetails")}
                </p>
                <p className="text-sm font-light">
                  {selectedSession.clientName}
                </p>
                <p className="text-xs text-muted-foreground font-light">
                  {formatDate(selectedSession.date)} {t("at")}{" "}
                  {formatTime(selectedSession.time)}
                </p>
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
                setSelectedSession(null);
              }}
              disabled={isSubmitting}
            >
              {t("cancelAction")}
            </Button>
            <Button
              type="button"
              onClick={handleSaveMeetingLink}
              disabled={!meetingLink || isSubmitting}
            >
              {isSubmitting ? t("savingAction") : t("saveLinkAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
