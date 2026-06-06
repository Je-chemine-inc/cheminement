"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { IProfile } from "@/models/Profile";
import { profileAPI } from "@/lib/api-client";
import BasicInformation from "@/components/dashboard/BasicInformation";
import ProfessionalProfile from "@/components/dashboard/ProfessionalProfile";
import AcceptingNewClientsCard from "@/components/dashboard/AcceptingNewClientsCard";
import AcceptingEmergencyConsultationsCard from "@/components/dashboard/AcceptingEmergencyConsultationsCard";
import AvailabilitySchedule from "./AvailabilitySchedule";

interface DayAvailability {
  day: string;
  isWorkDay: boolean;
  startTime: string;
  endTime: string;
}

const DEFAULT_DAYS: DayAvailability[] = [
  { day: "Monday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Tuesday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Wednesday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Thursday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Friday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
  { day: "Saturday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
  { day: "Sunday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
];

export default function ProfilePage() {
  const t = useTranslations("Dashboard.profile");

  const [profile, setProfile] = useState<IProfile | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await profileAPI.get();
        if (response) {
          const profileData = response as IProfile;
          // Initialize availability with defaults if missing or incomplete
          if (!profileData.availability || !profileData.availability.days || profileData.availability.days.length === 0) {
            profileData.availability = {
              ...profileData.availability,
              days: DEFAULT_DAYS,
              sessionDurationMinutes: profileData.availability?.sessionDurationMinutes ?? 60,
              breakDurationMinutes: profileData.availability?.breakDurationMinutes ?? 15,
              firstDayOfWeek: profileData.availability?.firstDayOfWeek ?? "Monday",
            };
          }
          setProfile(profileData);
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      }
    };
    fetchProfile();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="text-muted-foreground font-light mt-2">{t("subtitle")}</p>
      </div>

      {/* Accepting new clients — pro controls their own intake */}
      <AcceptingNewClientsCard profile={profile} setProfile={setProfile} />

      {/* Accepting quick one-time (emergency) consultations — separate opt-in */}
      <AcceptingEmergencyConsultationsCard
        profile={profile}
        setProfile={setProfile}
      />

      {/* Basic Information */}
      <BasicInformation isEditable={true} />

      {/* Professional Profile */}
      <ProfessionalProfile
        profile={profile ?? undefined}
        setProfile={setProfile}
        isEditable
      />

      {/* Platform Benefits Reminder */}
      <div className="rounded-xl bg-muted/30 p-6">
        <h3 className="font-serif font-light text-lg text-foreground mb-4">
          {t("accessTitle")}
        </h3>
        <ul className="grid md:grid-cols-2 gap-3 text-sm text-muted-foreground font-light">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{t("benefit1")}</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{t("benefit2")}</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{t("benefit3")}</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{t("benefit4")}</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{t("benefit5")}</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{t("benefit6")}</span>
          </li>
        </ul>
      </div>

      <AvailabilitySchedule
        profile={profile}
        setProfile={setProfile}
        isEditable={true}
      />
    </div>
  );
}
