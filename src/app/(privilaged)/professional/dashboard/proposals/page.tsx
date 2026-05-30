"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Eye,
  Phone,
  Mail,
  MapPin,
  Filter,
  Calendar,
  X,
  Check,
  Loader2,
  Heart,
  Stethoscope,
  FileText,
  Users,
  User,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppointmentDetailsModal from "@/components/dashboard/PatientProfileModal";
import { AvailabilitySlots } from "@/components/appointments/AvailabilitySlots";
import { apiClient } from "@/lib/api-client";
import { useMotifs, buildMotifLabelResolver } from "@/hooks/useMotifs";
import { useLocale, useTranslations } from "next-intl";

interface ClientInfo {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
}

interface LovedOneInfo {
  firstName: string;
  lastName: string;
  relationship: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

interface ReferralInfo {
  referrerType: string;
  referrerName: string;
  referrerLicense?: string;
  referrerPhone?: string;
  referrerEmail?: string;
  referralReason?: string;
  documentUrl?: string;
  documentName?: string;
}

interface ProposedAppointment {
  _id: string;
  clientId: ClientInfo;
  type: "video" | "in-person" | "phone";
  therapyType: "solo" | "couple" | "group";
  status: string;
  issueType?: string;
  notes?: string;
  bookingFor: "self" | "patient" | "loved-one";
  lovedOneInfo?: LovedOneInfo;
  referralInfo?: ReferralInfo;
  routingStatus: string;
  preferredAvailability?: string[];
  createdAt: string;
}

interface AvailableSlot {
  time: string;
  available: boolean;
}

interface AvailabilityData {
  date: string;
  available: boolean;
  slots: AvailableSlot[];
  workingHours: {
    start: string;
    end: string;
  };
}

export default function ProposalsPage() {
  const t = useTranslations("Professional.proposals");
  const locale = useLocale();
  const { motifs } = useMotifs();
  // Stored issueType values are persisted in whatever locale the client booked
  // in, so normalize every displayed/filtered label back to the active locale.
  const resolveMotifLabel = useMemo(
    () => buildMotifLabelResolver(motifs, locale),
    [motifs, locale],
  );
  const [activeTab, setActiveTab] = useState<
    "proposed" | "general" | "awaiting"
  >("proposed");
  const [proposedAppointments, setProposedAppointments] = useState<
    ProposedAppointment[]
  >([]);
  const [generalAppointments, setGeneralAppointments] = useState<
    ProposedAppointment[]
  >([]);
  const [awaitingAppointments, setAwaitingAppointments] = useState<
    ProposedAppointment[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAppointment, setSelectedAppointment] =
    useState<ProposedAppointment | null>(null);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);

  // Filters
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>("all");
  const [bookingForFilter, setBookingForFilter] = useState<string>("all");

  // Action states
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [refusingId, setRefusingId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  // Scheduling modal state
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [schedulingAppointment, setSchedulingAppointment] =
    useState<ProposedAppointment | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);

  const fetchProposedAppointments = useCallback(async () => {
    try {
      const data = await apiClient.get<ProposedAppointment[]>(
        "/appointments/proposed",
      );
      setProposedAppointments(data);
    } catch (err) {
      console.error("Error fetching proposed appointments:", err);
    }
  }, []);

  const fetchGeneralAppointments = useCallback(async () => {
    try {
      const data = await apiClient.get<ProposedAppointment[]>(
        "/appointments/general",
      );
      setGeneralAppointments(data);
    } catch (err) {
      console.error("Error fetching general appointments:", err);
    }
  }, []);

  const fetchAwaitingAppointments = useCallback(async () => {
    try {
      const data = await apiClient.get<ProposedAppointment[]>(
        "/appointments/awaiting-schedule",
      );
      setAwaitingAppointments(data);
    } catch (err) {
      console.error("Error fetching awaiting-schedule appointments:", err);
    }
  }, []);

  const fetchAllAppointments = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchProposedAppointments(),
        fetchGeneralAppointments(),
        fetchAwaitingAppointments(),
      ]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("errors.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [
    fetchProposedAppointments,
    fetchGeneralAppointments,
    fetchAwaitingAppointments,
    t,
  ]);

  useEffect(() => {
    fetchAllAppointments();
  }, [fetchAllAppointments]);

  // Get unique issue types for filter
  const issueTypes = useMemo(() => {
    const allAppointments = [
      ...proposedAppointments,
      ...generalAppointments,
      ...awaitingAppointments,
    ];
    const types = new Set<string>();
    allAppointments.forEach((apt) => {
      if (apt.issueType) types.add(resolveMotifLabel(apt.issueType));
    });
    return Array.from(types).sort((a, b) => a.localeCompare(b, locale));
  }, [
    proposedAppointments,
    generalAppointments,
    awaitingAppointments,
    resolveMotifLabel,
    locale,
  ]);

  // Filter appointments based on current tab
  const currentAppointments =
    activeTab === "proposed"
      ? proposedAppointments
      : activeTab === "general"
        ? generalAppointments
        : awaitingAppointments;

  const filteredAppointments = useMemo(() => {
    return currentAppointments
      // Drop rows where the populated client doc is missing — guards against
      // any future regression that lets orphan appointments slip through and
      // white-screens the page when we touch clientId.firstName below.
      .filter((appointment) => appointment.clientId != null)
      .filter((appointment) => {
        const clientName = `${appointment.clientId.firstName ?? ""} ${appointment.clientId.lastName ?? ""}`;
        const resolvedIssue = appointment.issueType
          ? resolveMotifLabel(appointment.issueType)
          : "";
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          clientName.toLowerCase().includes(query) ||
          (appointment.clientId.email ?? "").toLowerCase().includes(query) ||
          resolvedIssue.toLowerCase().includes(query);

        const matchesIssueType =
          issueTypeFilter === "all" || resolvedIssue === issueTypeFilter;

        const matchesBookingFor =
          bookingForFilter === "all" ||
          appointment.bookingFor === bookingForFilter;

        return matchesSearch && matchesIssueType && matchesBookingFor;
      });
  }, [
    currentAppointments,
    searchQuery,
    issueTypeFilter,
    bookingForFilter,
    resolveMotifLabel,
  ]);

  const handleAccept = async (appointment: ProposedAppointment) => {
    try {
      setAcceptingId(appointment._id);
      await apiClient.post(`/appointments/${appointment._id}/accept`, {});
      // Refresh appointments
      await fetchAllAppointments();
    } catch (err) {
      console.error("Error accepting appointment:", err);
      setError(
        err instanceof Error ? err.message : t("errors.acceptFailed"),
      );
    } finally {
      setAcceptingId(null);
    }
  };

  // Escape hatch: a pro who accepted (matched) but can't take it releases the
  // request back to the general pool before any date is confirmed.
  const handleRelease = async (appointment: ProposedAppointment) => {
    try {
      setReleasingId(appointment._id);
      await apiClient.post(`/appointments/${appointment._id}/release`, {});
      await fetchAllAppointments();
    } catch (err) {
      console.error("Error releasing appointment:", err);
      setError(err instanceof Error ? err.message : t("errors.refuseFailed"));
    } finally {
      setReleasingId(null);
    }
  };

  const handleRefuse = async (appointment: ProposedAppointment) => {
    try {
      setRefusingId(appointment._id);
      await apiClient.post(`/appointments/${appointment._id}/refuse`, {});
      // Refresh appointments
      await fetchAllAppointments();
    } catch (err) {
      console.error("Error refusing appointment:", err);
      setError(
        err instanceof Error ? err.message : t("errors.refuseFailed"),
      );
    } finally {
      setRefusingId(null);
    }
  };

  const getTypeBadge = (type: ProposedAppointment["type"]) => {
    const styles = {
      video: "bg-blue-100 text-blue-700",
      "in-person": "bg-green-100 text-green-700",
      phone: "bg-purple-100 text-purple-700",
    };

    const label =
      type === "video"
        ? t("sessionType.video")
        : type === "in-person"
          ? t("sessionType.inPerson")
          : t("sessionType.phone");

    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-light ${styles[type]}`}
      >
        {label}
      </span>
    );
  };

  const getTherapyTypeBadge = (type: ProposedAppointment["therapyType"]) => {
    const styles = {
      solo: "bg-indigo-100 text-indigo-700",
      couple: "bg-pink-100 text-pink-700",
      group: "bg-orange-100 text-orange-700",
    };

    const label =
      type === "solo"
        ? t("therapyType.solo")
        : type === "couple"
          ? t("therapyType.couple")
          : t("therapyType.group");

    return (
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-light ${styles[type]}`}
      >
        {label}
      </span>
    );
  };

  const getBookingForBadge = (
    bookingFor: ProposedAppointment["bookingFor"],
  ) => {
    const config = {
      self: {
        icon: User,
        label: t("bookingFor.self"),
        color: "bg-gray-100 text-gray-700",
      },
      patient: {
        icon: Stethoscope,
        label: t("bookingFor.patient"),
        color: "bg-blue-100 text-blue-700",
      },
      "loved-one": {
        icon: Heart,
        label: t("bookingFor.lovedOne"),
        color: "bg-pink-100 text-pink-700",
      },
    };
    const { icon: Icon, label, color } = config[bookingFor];

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-light ${color}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  };

  const handleViewAppointment = (appointment: ProposedAppointment) => {
    setSelectedAppointment(appointment);
    setIsAppointmentModalOpen(true);
  };

  // Schedule modal handlers (similar to requests page)
  const handleOpenScheduleModal = (appointment: ProposedAppointment) => {
    setSchedulingAppointment(appointment);
    setSelectedDate("");
    setSelectedTime("");
    setAvailableSlots([]);
    setIsManualEntry(false);
    setIsScheduleModalOpen(true);
  };

  const handleCloseScheduleModal = () => {
    setIsScheduleModalOpen(false);
    setSchedulingAppointment(null);
    setSelectedDate("");
    setSelectedTime("");
    setAvailableSlots([]);
  };

  const getAvailableDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push({
        value: date.toISOString().split("T")[0],
        label: date.toLocaleDateString(locale, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      });
    }
    return dates;
  };

  const loadAvailableSlots = async (date: string) => {
    try {
      setLoadingSlots(true);
      const response = await apiClient.get<AvailabilityData>(
        `/appointments/available-slots?date=${date}`,
      );
      if (response.available && response.slots) {
        setAvailableSlots(response.slots);
      } else {
        setAvailableSlots([]);
      }
    } catch (err) {
      console.error("Error fetching slots:", err);
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setSelectedTime("");
    if (date) {
      loadAvailableSlots(date);
    } else {
      setAvailableSlots([]);
    }
  };

  // Step 2 of the flow: the pro confirms the FIRST appointment date for a
  // request they already accepted (matched). Hits schedule-first, which flips
  // the request to "scheduled" and sends the 1st-RDV confirmation + payment
  // email. Distinct from acceptance (which only matches + sends jumelage).
  const handleConfirmFirstRdv = async () => {
    if (!schedulingAppointment || !selectedDate || !selectedTime) return;

    try {
      setScheduling(true);
      await apiClient.post(
        `/appointments/${schedulingAppointment._id}/schedule-first`,
        { date: selectedDate, time: selectedTime },
      );
      handleCloseScheduleModal();
      await fetchAllAppointments();
    } catch (err) {
      console.error("Error confirming first appointment:", err);
      setError(
        err instanceof Error ? err.message : t("errors.scheduleFailed"),
      );
    } finally {
      setScheduling(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setIssueTypeFilter("all");
    setBookingForFilter("all");
  };

  const hasActiveFilters =
    searchQuery || issueTypeFilter !== "all" || bookingForFilter !== "all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="text-muted-foreground font-light mt-1">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4">
          <p className="text-red-600 dark:text-red-400">
            {t("errorPrefix")}: {error}
          </p>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          setActiveTab(v as "proposed" | "general" | "awaiting")
        }
      >
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="proposed" className="gap-2">
            <Star className="h-4 w-4" />
            {t("tabProposed")}
            {proposedAppointments.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {proposedAppointments.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-2">
            <Users className="h-4 w-4" />
            {t("tabGeneral")}
            {generalAppointments.length > 0 && (
              <Badge variant="outline" className="ml-1">
                {generalAppointments.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="awaiting" className="gap-2">
            <Calendar className="h-4 w-4" />
            {t("tabAwaiting")}
            {awaitingAppointments.length > 0 && (
              <Badge variant="default" className="ml-1">
                {awaitingAppointments.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Filters */}
        <div className="rounded-xl bg-card p-6 space-y-4 mt-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("filters")}</span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="ml-auto text-xs"
              >
                {t("clearAll")}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                {t("search")}
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 font-light"
                />
              </div>
            </div>

            {/* Issue Type Filter */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                {t("issueType")}
              </Label>
              <Select
                value={issueTypeFilter}
                onValueChange={setIssueTypeFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("allIssues")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allIssues")}</SelectItem>
                  {issueTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Booking For Filter */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                {t("bookingForLabel")}
              </Label>
              <Select
                value={bookingForFilter}
                onValueChange={setBookingForFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("allTypes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTypes")}</SelectItem>
                  <SelectItem value="self">{t("bookingFor.self")}</SelectItem>
                  <SelectItem value="patient">
                    {t("bookingFor.patient")}
                  </SelectItem>
                  <SelectItem value="loved-one">
                    {t("bookingFor.lovedOne")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <TabsContent value="proposed" className="mt-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="rounded-xl bg-card p-12 text-center">
              <Star className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">
                {t("emptyProposedTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("emptyProposedDescription")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="font-light">
                      {t("table.client")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.type")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.issue")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.bookingFor")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.availability")}
                    </TableHead>
                    <TableHead className="font-light text-right">
                      {t("table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAppointments.map((appointment) => (
                    <TableRow key={appointment._id} className="group">
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {appointment.clientId.firstName}{" "}
                            {appointment.clientId.lastName}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {appointment.clientId.email}
                            </span>
                            {appointment.clientId.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {appointment.clientId.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getTypeBadge(appointment.type)}
                          {getTherapyTypeBadge(appointment.therapyType)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {appointment.issueType
                            ? resolveMotifLabel(appointment.issueType)
                            : t("notAvailable")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getBookingForBadge(appointment.bookingFor)}
                          {appointment.bookingFor === "loved-one" &&
                            appointment.lovedOneInfo && (
                              <span className="text-xs text-muted-foreground">
                                {appointment.lovedOneInfo.firstName} (
                                {appointment.lovedOneInfo.relationship})
                              </span>
                            )}
                          {appointment.bookingFor === "patient" &&
                            appointment.referralInfo && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {appointment.referralInfo.referrerName}
                              </span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <AvailabilitySlots
                          slots={appointment.preferredAvailability}
                          max={2}
                          emptyLabel={t("flexible")}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewAppointment(appointment)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRefuse(appointment)}
                            disabled={refusingId === appointment._id}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            {refusingId === appointment._id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <X className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleAccept(appointment)}
                            disabled={acceptingId === appointment._id}
                            className="gap-1"
                          >
                            {acceptingId === appointment._id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4" />
                                {t("accept")}
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="general" className="mt-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="rounded-xl bg-card p-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">
                {t("emptyGeneralTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("emptyGeneralDescription")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="font-light">
                      {t("table.client")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.type")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.issue")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.bookingFor")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.availability")}
                    </TableHead>
                    <TableHead className="font-light text-right">
                      {t("table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAppointments.map((appointment) => (
                    <TableRow key={appointment._id} className="group">
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {appointment.clientId.firstName}{" "}
                            {appointment.clientId.lastName}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {appointment.clientId.email}
                            </span>
                            {appointment.clientId.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {appointment.clientId.location}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getTypeBadge(appointment.type)}
                          {getTherapyTypeBadge(appointment.therapyType)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {appointment.issueType
                            ? resolveMotifLabel(appointment.issueType)
                            : t("notAvailable")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getBookingForBadge(appointment.bookingFor)}
                          {appointment.bookingFor === "loved-one" &&
                            appointment.lovedOneInfo && (
                              <span className="text-xs text-muted-foreground">
                                {appointment.lovedOneInfo.firstName} (
                                {appointment.lovedOneInfo.relationship})
                              </span>
                            )}
                          {appointment.bookingFor === "patient" &&
                            appointment.referralInfo && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {appointment.referralInfo.referrerName}
                              </span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <AvailabilitySlots
                          slots={appointment.preferredAvailability}
                          max={2}
                          emptyLabel={t("flexible")}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewAppointment(appointment)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleAccept(appointment)}
                            disabled={acceptingId === appointment._id}
                            className="gap-1"
                          >
                            {acceptingId === appointment._id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4" />
                                {t("accept")}
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="awaiting" className="mt-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="rounded-xl bg-card p-12 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">
                {t("emptyAwaitingTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t("emptyAwaitingDescription")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="font-light">
                      {t("table.client")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.type")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.issue")}
                    </TableHead>
                    <TableHead className="font-light">
                      {t("table.bookingFor")}
                    </TableHead>
                    <TableHead className="font-light text-right">
                      {t("table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAppointments.map((appointment) => (
                    <TableRow key={appointment._id} className="group">
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {appointment.clientId.firstName}{" "}
                            {appointment.clientId.lastName}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {appointment.clientId.email}
                            </span>
                            {appointment.clientId.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {appointment.clientId.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getTypeBadge(appointment.type)}
                          {getTherapyTypeBadge(appointment.therapyType)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {appointment.issueType
                            ? resolveMotifLabel(appointment.issueType)
                            : t("notAvailable")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getBookingForBadge(appointment.bookingFor)}
                          {appointment.bookingFor === "loved-one" &&
                            appointment.lovedOneInfo && (
                              <span className="text-xs text-muted-foreground">
                                {appointment.lovedOneInfo.firstName} (
                                {appointment.lovedOneInfo.relationship})
                              </span>
                            )}
                          {appointment.bookingFor === "patient" &&
                            appointment.referralInfo && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {appointment.referralInfo.referrerName}
                              </span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewAppointment(appointment)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRelease(appointment)}
                            disabled={releasingId === appointment._id}
                            className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            {releasingId === appointment._id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <X className="h-4 w-4" />
                            )}
                            {t("release")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleOpenScheduleModal(appointment)}
                            className="gap-1"
                          >
                            <Calendar className="h-4 w-4" />
                            {t("confirmFirstRdv")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Schedule Modal */}
      {isScheduleModalOpen && schedulingAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleCloseScheduleModal}
          />
          <div className="relative bg-card rounded-xl border border-border/40 p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium">
                {t("confirmFirstRdvModalTitle")}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseScheduleModal}
                aria-label={t("closeModal")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              {/* Client Info */}
              <div className="p-4 bg-muted/30 rounded-lg">
                <p className="font-medium">
                  {schedulingAppointment.clientId.firstName}{" "}
                  {schedulingAppointment.clientId.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {schedulingAppointment.issueType
                    ? resolveMotifLabel(schedulingAppointment.issueType)
                    : t("notAvailable")}{" "}
                  •{" "}
                  {schedulingAppointment.type === "video"
                    ? t("sessionType.video")
                    : schedulingAppointment.type === "in-person"
                      ? t("sessionType.inPerson")
                      : t("sessionType.phone")}{" "}
                  •{" "}
                  {schedulingAppointment.therapyType === "solo"
                    ? t("therapyType.solo")
                    : schedulingAppointment.therapyType === "couple"
                      ? t("therapyType.couple")
                      : t("therapyType.group")}
                </p>
                {schedulingAppointment.preferredAvailability?.length ? (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("table.availability")}
                    </p>
                    <AvailabilitySlots
                      slots={schedulingAppointment.preferredAvailability}
                    />
                  </div>
                ) : null}
              </div>

              {/* Manual Entry Toggle */}
              <div className="flex items-center space-x-2 pt-2 border-t border-border/10">
                <Checkbox
                  id="manual-entry"
                  checked={isManualEntry}
                  onCheckedChange={(checked) => {
                    setIsManualEntry(!!checked);
                    if (checked) {
                      setAvailableSlots([]);
                    } else if (selectedDate) {
                      loadAvailableSlots(selectedDate);
                    }
                  }}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="manual-entry"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("manualEntry")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("manualEntryDescription")}
                  </p>
                </div>
              </div>

              {/* Date Selection */}
              <div>
                <Label className="text-sm">
                  {isManualEntry ? t("manualDateLabel") : t("selectDate")}
                </Label>
                {isManualEntry ? (
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="mt-1.5"
                    min={new Date().toISOString().split("T")[0]}
                  />
                ) : (
                  <Select value={selectedDate} onValueChange={handleDateChange}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder={t("chooseDate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableDates().map((date) => (
                        <SelectItem key={date.value} value={date.value}>
                          {date.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Time Selection */}
              {(selectedDate || isManualEntry) && (
                <div>
                  <Label className="text-sm">
                    {t("selectTime")}
                  </Label>

                  {!isManualEntry && (
                    <>
                      {loadingSlots ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      ) : availableSlots.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mt-2 mb-3">
                          {availableSlots
                            .filter((slot) => slot.available)
                            .map((slot) => (
                              <Button
                                key={slot.time}
                                variant={
                                  selectedTime === slot.time
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                onClick={() => setSelectedTime(slot.time)}
                                className="h-8 text-xs px-2"
                              >
                                {slot.time}
                              </Button>
                            ))}
                        </div>
                      )}
                      {availableSlots.length === 0 && !loadingSlots && (
                        <p className="text-xs text-muted-foreground mt-2 mb-3 italic">
                          {t("noSlotsForDate")}
                        </p>
                      )}
                    </>
                  )}

                  {/* Native time picker (clock opens it) — same as the date
                      field above. Was a type="text" input with a dead,
                      pointer-events-none clock icon, so the picker never opened. */}
                  <Input
                    type="time"
                    placeholder="HH:MM"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    className="mt-1.5"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {t("manualTimeHint")}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={handleCloseScheduleModal}
                  className="flex-1"
                >
                  {t("cancel")}
                </Button>
                <Button
                  onClick={handleConfirmFirstRdv}
                  disabled={!selectedDate || !selectedTime || scheduling}
                  className="flex-1"
                >
                  {scheduling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Calendar className="h-4 w-4 mr-2" />
                      {t("confirm")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Appointment Details Modal */}
      {selectedAppointment && (
        <AppointmentDetailsModal
          isOpen={isAppointmentModalOpen}
          onClose={() => {
            setIsAppointmentModalOpen(false);
            setSelectedAppointment(null);
          }}
          appointment={
            selectedAppointment as unknown as Parameters<
              typeof AppointmentDetailsModal
            >[0]["appointment"]
          }
        />
      )}
    </div>
  );
}
