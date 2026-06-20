"use client";

import React, { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Edit,
  FileText,
  Loader2,
  MapPin,
  Phone,
  User,
  Video,
  Wallet,
} from "lucide-react";
import { appointmentsAPI } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ProfessionalBookAppointmentModal,
  type BookableClient,
  type BookableProfessional,
} from "@/components/appointments/ProfessionalBookAppointmentModal";
import { AppointmentEditDialog } from "@/components/appointments/AppointmentEditDialog";
import {
  ManualInvoiceModal,
  type ManualInvoiceContext,
} from "@/components/billing/ManualInvoiceModal";
import { RecordPayoutModal } from "@/components/billing/RecordPayoutModal";
import type { AppointmentResponse } from "@/types/api";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
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
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 8:00 → 23:00

const pad2 = (n: number) => String(n).padStart(2, "0");
// Local-date key — mirrors the professional calendar so both views place an
// appointment on the same cell for the same data.
const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export default function AdminProfessionalSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("AdminDashboard.professionalSchedule");

  const [professionalName, setProfessionalName] = useState("");
  const [clients, setClients] = useState<BookableClient[]>([]);
  const [appointments, setAppointments] = useState<AppointmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"day" | "week" | "month">("week");

  const [bookOpen, setBookOpen] = useState(false);
  const [bookDefaults, setBookDefaults] = useState<{
    date?: string;
    time?: string;
  }>({});

  const [editApt, setEditApt] = useState<AppointmentResponse | null>(null);

  // Manual invoice/receipt generator (admin-only), launched from a slot or an
  // existing appointment via the calendar action menu.
  const [manualInvoiceCtx, setManualInvoiceCtx] =
    useState<ManualInvoiceContext | null>(null);

  // Record an external payment made to this pro (Interac/bank, outside the
  // platform) — surfaces in the pro's "Historique des paiements".
  const [payoutOpen, setPayoutOpen] = useState(false);

  const professionals: BookableProfessional[] = useMemo(
    () => [{ id, name: professionalName || id }],
    [id, professionalName],
  );

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
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
      const data = await appointmentsAPI.list({
        professionalId: id,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      setAppointments(data);
    } catch (err) {
      console.error("Error fetching professional schedule:", err);
    } finally {
      setLoading(false);
    }
  }, [id, currentDate, view]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${id}`);
        if (res.ok) {
          const json = await res.json();
          const u = json?.user;
          if (u) {
            setProfessionalName(`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
          }
        }
      } catch {
        /* non-blocking */
      }
    })();
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/patients?limit=200");
        if (res.ok) {
          const json = await res.json();
          const list: BookableClient[] = (json?.patients ?? []).map(
            (p: { id: string; name: string; email?: string }) => ({
              id: p.id,
              name: p.name,
              email: p.email,
            }),
          );
          setClients(list);
        }
      } catch {
        /* non-blocking */
      }
    })();
  }, []);

  const navigateDate = (dir: "prev" | "next") => {
    const next = new Date(currentDate);
    if (view === "day")
      next.setDate(currentDate.getDate() + (dir === "next" ? 1 : -1));
    else if (view === "week")
      next.setDate(currentDate.getDate() + (dir === "next" ? 7 : -7));
    else next.setMonth(currentDate.getMonth() + (dir === "next" ? 1 : -1));
    setCurrentDate(next);
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
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    start.setDate(start.getDate() - start.getDay());
    const days: Date[] = [];
    const cur = new Date(start);
    while (days.length < 42) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  };

  const visibleAppointments = useMemo(
    () => appointments.filter((a) => a.status !== "cancelled"),
    [appointments],
  );

  const slotAppointments = (date: Date, hour: number) => {
    const key = localDateKey(date);
    return visibleAppointments.filter((a) => {
      const aKey = localDateKey(new Date(a.date));
      const aHour = parseInt(a.time?.split(":")[0] ?? "-1", 10);
      return aKey === key && aHour === hour;
    });
  };

  const dayAppointments = (date: Date) => {
    const key = localDateKey(date);
    return visibleAppointments
      .filter((a) => localDateKey(new Date(a.date)) === key)
      .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  };

  const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
  const isSameMonth = (d: Date) => d.getMonth() === currentDate.getMonth();
  const formatDate = (d: Date) =>
    `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  const typeIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-3.5 w-3.5" />;
      case "in-person":
        return <MapPin className="h-3.5 w-3.5" />;
      case "phone":
        return <Phone className="h-3.5 w-3.5" />;
      default:
        return <User className="h-3.5 w-3.5" />;
    }
  };

  const aptColor = (a: AppointmentResponse) => {
    if (a.status === "pending")
      return "bg-amber-50 border-amber-200 text-amber-900";
    if (a.status === "completed")
      return "bg-slate-50 border-slate-200 text-slate-700";
    if (a.status === "ongoing")
      return "bg-violet-50 border-violet-200 text-violet-900";
    return "bg-sky-50 border-sky-200 text-sky-900";
  };

  const openBookForSlot = (date: Date, hour?: number) => {
    setBookDefaults({
      date: localDateKey(date),
      time: typeof hour === "number" ? `${pad2(hour)}:00` : undefined,
    });
    setBookOpen(true);
  };

  const openManualInvoiceForSlot = (date: Date, hour?: number) => {
    setManualInvoiceCtx({
      date: localDateKey(date),
      time: typeof hour === "number" ? `${pad2(hour)}:00` : undefined,
    });
  };

  const openManualInvoiceForApt = (a: AppointmentResponse) => {
    setManualInvoiceCtx({ appointment: a });
  };

  // Existing appointment → action menu (view/edit OR generate a manual invoice).
  const renderAptChip = (a: AppointmentResponse, compact = false) => (
    <DropdownMenu key={a._id}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`w-full text-left border rounded p-1.5 mb-1 hover:brightness-95 transition ${aptColor(a)}`}
        >
          <div className="flex items-center gap-1 text-xs font-medium">
            {typeIcon(a.type)}
            <span className="truncate">
              {a.clientId?.firstName} {a.clientId?.lastName}
            </span>
          </div>
          {!compact && (
            <div className="text-[11px] opacity-80">
              {a.time} · {a.duration}m
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => setEditApt(a)}>
          <Edit className="h-4 w-4" />
          {t("viewEdit")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openManualInvoiceForApt(a)}>
          <FileText className="h-4 w-4" />
          {t("generateManualInvoice")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Empty slot → action menu (book OR generate a manual invoice).
  const renderSlotMenuItems = (date: Date, hour?: number) => (
    <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
      <DropdownMenuItem onClick={() => openBookForSlot(date, hour)}>
        <CalendarPlus className="h-4 w-4" />
        {t("bookAppointment")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openManualInvoiceForSlot(date, hour)}>
        <FileText className="h-4 w-4" />
        {t("generateManualInvoice")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <div className="w-full p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Link
            href={`/admin/dashboard/professionals/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition mb-1"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("heading")}
          </h1>
          <p className="text-muted-foreground font-light mt-1">
            {t("subtitle", { name: professionalName || "…" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setManualInvoiceCtx({})}
          >
            <FileText className="h-4 w-4" />
            {t("createInvoice")}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setPayoutOpen(true)}
          >
            <Wallet className="h-4 w-4" />
            {t("recordPayout")}
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              setBookDefaults({});
              setBookOpen(true);
            }}
          >
            <CalendarPlus className="h-4 w-4" />
            {t("bookAppointment")}
          </Button>
        </div>
      </div>

      <div className="rounded-xl bg-card p-6 border border-border/40">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigateDate("prev")}
              className="p-2 rounded-full hover:bg-muted transition"
              aria-label="Previous"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-serif font-light min-w-[180px] text-center">
              {view === "day" && formatDate(currentDate)}
              {view === "week" && `${t("weekOf")} ${formatDate(getWeekDays()[0])}`}
              {view === "month" &&
                `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
            </h2>
            <button
              onClick={() => navigateDate("next")}
              className="p-2 rounded-full hover:bg-muted transition"
              aria-label="Next"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-4 py-2 text-sm font-light text-primary hover:bg-primary/10 rounded-full transition"
            >
              {t("today")}
            </button>
            <div className="flex items-center gap-1 bg-muted rounded-full p-1">
              {(["day", "week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1 text-sm font-light rounded-full transition ${
                    view === v
                      ? "bg-background text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {t(v)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : view === "week" ? (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-8 gap-px bg-border/40 border border-border/40 rounded-lg overflow-hidden">
                <div className="bg-muted/30 p-2" />
                {getWeekDays().map((day, idx) => (
                  <div
                    key={idx}
                    className={`bg-card p-3 text-center ${isToday(day) ? "bg-primary/10" : ""}`}
                  >
                    <div className="text-xs font-light text-muted-foreground mb-1">
                      {DAY_NAMES[day.getDay()]}
                    </div>
                    <div
                      className={`text-sm ${isToday(day) ? "text-primary font-medium" : "text-foreground font-light"}`}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                ))}
                {HOURS.map((hour) => (
                  <React.Fragment key={hour}>
                    <div className="bg-muted/30 p-2 text-xs font-light text-muted-foreground text-right">
                      {hour}:00
                    </div>
                    {getWeekDays().map((day, idx) => {
                      const slot = slotAppointments(day, hour);
                      return (
                        <div
                          key={`${idx}-${hour}`}
                          className="bg-card p-1.5 min-h-[60px] flex flex-col"
                        >
                          {slot.map((a) => renderAptChip(a))}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={t("slotActions")}
                                className="flex-1 min-h-[20px] rounded hover:bg-primary/5 transition group relative"
                              >
                                {slot.length === 0 && (
                                  <CalendarPlus className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/50 absolute top-0.5 right-0.5 transition" />
                                )}
                              </button>
                            </DropdownMenuTrigger>
                            {renderSlotMenuItems(day, hour)}
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ) : view === "month" ? (
          <div className="grid grid-cols-7 gap-px bg-border/40 border border-border/40 rounded-lg overflow-hidden">
            {DAY_NAMES.map((d) => (
              <div
                key={d}
                className="bg-muted/30 p-2 text-center text-xs font-light text-muted-foreground"
              >
                {d}
              </div>
            ))}
            {getMonthDays().map((day, idx) => (
              <div
                key={idx}
                className={`bg-card p-2 min-h-[96px] flex flex-col ${
                  !isSameMonth(day) ? "opacity-40" : ""
                } ${isToday(day) ? "ring-1 ring-primary/30" : ""}`}
              >
                <div
                  className={`text-xs mb-1 ${isToday(day) ? "text-primary font-medium" : "text-foreground font-light"}`}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-1">
                  {dayAppointments(day)
                    .slice(0, 3)
                    .map((a) => renderAptChip(a, true))}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("slotActions")}
                      className="flex-1 min-h-[16px] rounded hover:bg-primary/5 transition"
                    />
                  </DropdownMenuTrigger>
                  {renderSlotMenuItems(day)}
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {HOURS.map((hour) => {
              const slot = slotAppointments(currentDate, hour);
              return (
                <div key={hour} className="flex gap-4">
                  <div className="w-16 text-sm font-light text-muted-foreground pt-2">
                    {hour}:00
                  </div>
                  <div className="flex-1 min-h-[56px] border-l border-border/40 pl-4 py-1 flex flex-col">
                    {slot.map((a) => renderAptChip(a))}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("slotActions")}
                          className="flex-1 min-h-[24px] rounded hover:bg-primary/5 transition"
                        />
                      </DropdownMenuTrigger>
                      {renderSlotMenuItems(currentDate, hour)}
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProfessionalBookAppointmentModal
        open={bookOpen}
        onOpenChange={setBookOpen}
        clients={clients}
        professionals={professionals}
        defaultProfessionalId={id}
        defaultDate={bookDefaults.date}
        defaultTime={bookDefaults.time}
        onCreated={() => {
          setBookOpen(false);
          fetchAppointments();
        }}
      />

      {editApt && (
        <AppointmentEditDialog
          key={editApt._id}
          appointment={editApt}
          apiBase="/api/admin/appointments"
          onClose={() => setEditApt(null)}
          onSaved={() => {
            setEditApt(null);
            fetchAppointments();
          }}
        />
      )}

      <ManualInvoiceModal
        key={
          manualInvoiceCtx
            ? (manualInvoiceCtx.appointment?._id ??
              `${manualInvoiceCtx.date ?? ""}-${manualInvoiceCtx.time ?? ""}`)
            : "closed"
        }
        open={manualInvoiceCtx !== null}
        onOpenChange={(o) => {
          if (!o) setManualInvoiceCtx(null);
        }}
        professionalId={id}
        professionalName={professionalName}
        clients={clients}
        context={manualInvoiceCtx}
        onGenerated={() => {
          setManualInvoiceCtx(null);
          fetchAppointments();
        }}
      />

      <RecordPayoutModal
        open={payoutOpen}
        onOpenChange={setPayoutOpen}
        professionalId={id}
        professionalName={professionalName}
        onRecorded={() => setPayoutOpen(false)}
      />
    </div>
  );
}
