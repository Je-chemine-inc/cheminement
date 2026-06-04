"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IProfile } from "@/models/Profile";
import { profileAPI } from "@/lib/api-client";

export interface DayAvailability {
  day: string;
  isWorkDay: boolean;
  startTime: string;
  endTime: string;
}

const TIME_OPTIONS: string[] = [];
for (let hour = 0; hour < 24; hour++) {
  for (let minute = 0; minute < 60; minute += 15) {
    const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    TIME_OPTIONS.push(time);
  }
}
interface AvailabilityScheduleProps {
  profile: IProfile | null;
  setProfile: (profile: IProfile) => void;
  isEditable?: boolean;
  onSaveOverride?: (data: Partial<IProfile>) => Promise<IProfile | null>;
}

const WEEK_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const DEFAULT_DAYS: DayAvailability[] = [
  { day: "Monday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Tuesday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Wednesday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Thursday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Friday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Saturday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
  { day: "Sunday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
];

/**
 * Always return all 7 days in canonical order. Legacy saves persisted ONLY
 * working days (non-working days were filtered out before saving), which made
 * Saturday/Sunday — and any unchecked weekday — disappear from the editor with
 * no checkbox to re-enable them. A day absent from a non-empty saved set was
 * deliberately unchecked, so it comes back as a day off (isWorkDay:false);
 * a completely empty set falls back to the Mon–Fri default. Editing then saves
 * the full 7-day array, healing the stored data.
 */
function normalizeWeek(persisted?: DayAvailability[]): DayAvailability[] {
  if (!persisted || persisted.length === 0) return DEFAULT_DAYS;
  return WEEK_ORDER.map(
    (dayName) =>
      persisted.find((d) => d.day === dayName) ?? {
        day: dayName,
        isWorkDay: false,
        startTime: "09:00",
        endTime: "17:00",
      },
  );
}

const AvailabilitySchedule = ({
  profile,
  setProfile,
  isEditable = false,
  onSaveOverride,
}: AvailabilityScheduleProps) => {
  const t = useTranslations("Dashboard.profile");
  const tSchedule = useTranslations("Dashboard.schedule");

  const [sessionDuration, setSessionDuration] = useState("60");
  const [breakBetweenSessions, setBreakBetweenSessions] = useState("15");
  const [isScheduleEditable, setIsScheduleEditable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile?.availability) {
      setSessionDuration(
        profile.availability.sessionDurationMinutes?.toString() || "60",
      );
      setBreakBetweenSessions(
        profile.availability.breakDurationMinutes?.toString() || "15",
      );
    }
  }, [profile]);

  // Always work with all 7 days so weekends (and any previously-unchecked day)
  // are editable — the legacy filter-on-save dropped non-working days.
  const currentSchedule = normalizeWeek(profile?.availability?.days);

  const firstDayIndex = WEEK_ORDER.indexOf(
    profile?.availability?.firstDayOfWeek || "Monday",
  );
  const orderedDays = [
    ...WEEK_ORDER.slice(firstDayIndex),
    ...WEEK_ORDER.slice(0, firstDayIndex),
  ];

  const toggleDay = (dayIndex: number) => {
    if (!profile) return;
    const newDays = [...currentSchedule];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      isWorkDay: !newDays[dayIndex].isWorkDay,
    };
    const updatedProfile = {
      ...profile,
      availability: {
        ...profile.availability,
        days: newDays,
      },
    } as IProfile;
    setProfile(updatedProfile);
  };

  const updateTime = (
    dayIndex: number,
    field: "startTime" | "endTime",
    value: string,
  ) => {
    if (!profile) return;
    const newDays = [...currentSchedule];
    newDays[dayIndex] = {
      ...newDays[dayIndex],
      [field]: value,
    };
    const updatedProfile = {
      ...profile,
      availability: {
        ...profile.availability,
        days: newDays,
      },
    } as IProfile;
    setProfile(updatedProfile);
  };

  const copyToAllDays = (sourceIndex: number) => {
    if (!profile) return;
    const sourceDay = currentSchedule[sourceIndex];
    const newDays = currentSchedule.map((day) => ({
      ...day,
      isWorkDay: sourceDay.isWorkDay,
      startTime: sourceDay.startTime,
      endTime: sourceDay.endTime,
    }));
    const updatedProfile = {
      ...profile,
      availability: {
        ...profile.availability,
        days: newDays,
      },
    } as IProfile;
    setProfile(updatedProfile);
  };

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const availability = {
        days: currentSchedule,
        sessionDurationMinutes: parseInt(sessionDuration),
        breakDurationMinutes: parseInt(breakBetweenSessions),
        firstDayOfWeek: profile.availability?.firstDayOfWeek || "Monday",
      };
      if (onSaveOverride) {
        const updated = await onSaveOverride({ availability });
        if (updated) {
          setProfile(updated);
        } else {
          // If no profile returned but no error thrown, we assume success and update locally
          setProfile({ ...profile, availability } as IProfile);
        }
      } else {
        // Use the server's full updated doc as the source of truth. Rebuilding
        // from a stale local `profile` spread could push an outdated value of a
        // sibling-owned field (e.g. acceptingNewClients, just toggled elsewhere)
        // back into shared page state and visually revert it. Fall back to the
        // local spread only if the PUT returns nothing.
        const updated = await profileAPI.update({ availability });
        setProfile(
          (updated as IProfile) ?? ({ ...profile, availability } as IProfile),
        );
      }
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-serif font-light text-foreground">
          {tSchedule("title")}
        </h2>
        {isEditable && (
          <Button
            onClick={async () => {
              if (isScheduleEditable) {
                await handleSave();
              }
              setIsScheduleEditable(!isScheduleEditable);
            }}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="text-sm"
          >
            {isSaving
              ? t("saving")
              : isScheduleEditable
                ? t("save")
                : t("edit")}
          </Button>
        )}
      </div>

      {/* Session Settings */}
      <div className="mb-6">
        <h3 className="text-base font-serif font-light text-foreground mb-4">
          {tSchedule("sessionSettings")}
        </h3>
        {isScheduleEditable ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="sessionDuration" className="font-light mb-2">
                {tSchedule("defaultDuration")}
              </Label>
              <Select
                value={sessionDuration}
                onValueChange={setSessionDuration}
                disabled={!isScheduleEditable}
              >
                <SelectTrigger className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="45">45 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="60">60 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="90">90 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="120">
                    120 {tSchedule("minutes")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="breakBetweenSessions" className="font-light mb-2">
                {tSchedule("breakBetween")}
              </Label>
              <Select
                value={breakBetweenSessions}
                onValueChange={setBreakBetweenSessions}
                disabled={!isScheduleEditable}
              >
                <SelectTrigger className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{tSchedule("noBreak")}</SelectItem>
                  <SelectItem value="5">5 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="10">10 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="15">15 {tSchedule("minutes")}</SelectItem>
                  <SelectItem value="30">30 {tSchedule("minutes")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="firstDayOfWeek" className="font-light mb-2">
                {tSchedule("firstDayOfWeek")}
              </Label>
              <Select
                value={profile?.availability?.firstDayOfWeek || "Monday"}
                onValueChange={(value) => {
                  if (!profile) return;
                  const updatedProfile = {
                    ...profile,
                    availability: {
                      ...profile.availability,
                      firstDayOfWeek: value,
                    },
                  } as IProfile;
                  setProfile(updatedProfile);
                }}
                disabled={!isScheduleEditable}
              >
                <SelectTrigger className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Monday">
                    {tSchedule("days.monday")}
                  </SelectItem>
                  <SelectItem value="Tuesday">
                    {tSchedule("days.tuesday")}
                  </SelectItem>
                  <SelectItem value="Wednesday">
                    {tSchedule("days.wednesday")}
                  </SelectItem>
                  <SelectItem value="Thursday">
                    {tSchedule("days.thursday")}
                  </SelectItem>
                  <SelectItem value="Friday">
                    {tSchedule("days.friday")}
                  </SelectItem>
                  <SelectItem value="Saturday">
                    {tSchedule("days.saturday")}
                  </SelectItem>
                  <SelectItem value="Sunday">
                    {tSchedule("days.sunday")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <Label className="font-light mb-2 block">
                {tSchedule("defaultDuration")}
              </Label>
              <p className="text-foreground text-sm">
                {sessionDuration} {tSchedule("minutes")}
              </p>
            </div>

            <div>
              <Label className="font-light mb-2 block">
                {tSchedule("breakBetween")}
              </Label>
              <p className="text-foreground text-sm">
                {breakBetweenSessions === "0"
                  ? tSchedule("noBreak")
                  : `${breakBetweenSessions} ${tSchedule("minutes")}`}
              </p>
            </div>

            <div>
              <Label className="font-light mb-2 block">
                {tSchedule("firstDayOfWeek")}
              </Label>
              <p className="text-foreground text-sm capitalize">
                {tSchedule(
                  `days.${(profile?.availability?.firstDayOfWeek || "Monday").toLowerCase()}`,
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Weekly Schedule */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-serif font-light text-foreground">
            {tSchedule("weeklySchedule")}
          </h3>
          {isScheduleEditable && (
            <p className="text-sm text-muted-foreground font-light">
              {tSchedule("setHours")}
            </p>
          )}
        </div>

        {isScheduleEditable ? (
          <div className="space-y-3">
            {orderedDays.map((dayName) => {
              const day = currentSchedule.find((d) => d.day === dayName);
              if (!day) return null;
              const dayIndex = currentSchedule.indexOf(day);
              return (
                <div
                  key={day.day}
                  className={`rounded-lg p-3 transition-colors ${
                    day.isWorkDay ? "bg-muted/30" : "bg-muted/10 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center pt-2">
                      <input
                        type="checkbox"
                        id={day.day}
                        checked={day.isWorkDay}
                        onChange={() => toggleDay(dayIndex)}
                        disabled={!isScheduleEditable}
                        className="h-4 w-4 text-primary focus:ring-primary border-border/20 rounded"
                      />
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <Label
                          htmlFor={day.day}
                          className="font-light text-sm text-foreground cursor-pointer"
                        >
                          {tSchedule(`days.${day.day.toLowerCase()}`)}
                        </Label>
                        {day.isWorkDay && isScheduleEditable && (
                          <button
                            onClick={() => copyToAllDays(dayIndex)}
                            className="text-xs text-primary hover:text-primary/80 font-light"
                          >
                            {tSchedule("copyToAll")}
                          </button>
                        )}
                      </div>

                      {day.isWorkDay && (
                        <div className="flex items-center gap-2 bg-background/50 rounded-lg p-2">
                          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />

                          <div className="flex items-center gap-2 flex-1">
                            <Select
                              value={day.startTime}
                              onValueChange={(value) =>
                                updateTime(dayIndex, "startTime", value)
                              }
                              disabled={!isScheduleEditable}
                            >
                              <SelectTrigger className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TIME_OPTIONS.map((time) => (
                                  <SelectItem key={time} value={time}>
                                    {time}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <span className="text-muted-foreground text-xs">
                              {tSchedule("to")}
                            </span>

                            <Select
                              value={day.endTime}
                              onValueChange={(value) =>
                                updateTime(dayIndex, "endTime", value)
                              }
                              disabled={!isScheduleEditable}
                            >
                              <SelectTrigger className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TIME_OPTIONS.map((time) => (
                                  <SelectItem key={time} value={time}>
                                    {time}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {!day.isWorkDay && (
                        <p className="text-xs text-muted-foreground font-light">
                          {tSchedule("unavailable")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {orderedDays.map((dayName) => {
              const day = currentSchedule.find((d) => d.day === dayName);
              if (!day) return null;
              return (
                <div
                  key={day.day}
                  className={`rounded-lg p-4 transition-colors ${
                    day.isWorkDay
                      ? "bg-primary/5 border border-primary/10"
                      : "bg-muted/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">
                      {tSchedule(`days.${day.day.toLowerCase()}`)}
                    </span>
                    {day.isWorkDay ? (
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Clock className="h-4 w-4 text-primary" />
                        <span>
                          {day.startTime} {tSchedule("to")} {day.endTime}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground font-light italic">
                        {tSchedule("unavailable")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AvailabilitySchedule;
