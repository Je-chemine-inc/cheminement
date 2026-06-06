"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Zap, Loader2 } from "lucide-react";
import { IProfile } from "@/models/Profile";
import { profileAPI } from "@/lib/api-client";

interface AcceptingEmergencyConsultationsCardProps {
  profile?: IProfile | null;
  setProfile?: (profile: IProfile) => void;
}

/**
 * Toggle on the professional's profile page letting them opt in/out of
 * "Consultations ponctuelles rapides" (urgent / isEmergency requests). When off,
 * the matcher skips them for emergency requests and they aren't emailed — but
 * they can still self-claim such requests from the general pool. Independent of
 * the "new clients" toggle. Saves immediately (optimistic) via PUT /api/profile.
 * Legacy profiles lack the field → treat anything but an explicit `false` as
 * accepting.
 */
export default function AcceptingEmergencyConsultationsCard({
  profile,
  setProfile,
}: AcceptingEmergencyConsultationsCardProps) {
  const t = useTranslations("Dashboard.profile");

  const [accepting, setAccepting] = useState(
    profile?.acceptingEmergencyConsultations !== false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // Sync once the profile finishes loading on the parent page.
  useEffect(() => {
    if (profile) setAccepting(profile.acceptingEmergencyConsultations !== false);
  }, [profile]);

  const toggle = async () => {
    if (saving) return;
    const next = !accepting;
    setAccepting(next); // optimistic
    setSaving(true);
    setError(false);
    try {
      const updated = (await profileAPI.update({
        acceptingEmergencyConsultations: next,
      })) as IProfile;
      if (setProfile && updated) setProfile(updated);
    } catch {
      setAccepting(!next); // revert on failure
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              accepting
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("acceptingEmergencyTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground font-light">
              {accepting
                ? t("acceptingEmergencyOnDesc")
                : t("acceptingEmergencyOffDesc")}
            </p>
            {error && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {t("acceptingEmergencyError")}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saving && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <button
            type="button"
            role="switch"
            aria-checked={accepting}
            aria-label={t("acceptingEmergencyLabel")}
            disabled={saving}
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
              accepting ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                accepting ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
