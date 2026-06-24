"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UserPlus, Loader2 } from "lucide-react";
import { IProfile } from "@/models/Profile";
import { profileAPI } from "@/lib/api-client";

interface AcceptingNewClientsCardProps {
  profile?: IProfile | null;
  setProfile?: (profile: IProfile) => void;
  /**
   * Override the save call. Defaults to the pro's own PUT /api/profile; an admin
   * managing a pro passes a function that PUTs to the admin endpoint instead.
   */
  onUpdate?: (patch: Partial<IProfile>) => Promise<IProfile>;
}

/**
 * Prominent toggle on the professional's profile page letting them control
 * whether they receive NEW client requests. When off, the matcher, the
 * general-pool broadcast and the general-pool view all skip them — so the pro
 * controls their own intake. Existing proposals/appointments are untouched.
 * Saves immediately (optimistic) via PUT /api/profile — no global Save button
 * on this page. Legacy profiles lack the field → treat anything but an
 * explicit `false` as accepting.
 */
export default function AcceptingNewClientsCard({
  profile,
  setProfile,
  onUpdate,
}: AcceptingNewClientsCardProps) {
  const t = useTranslations("Dashboard.profile");

  const [accepting, setAccepting] = useState(
    profile?.acceptingNewClients !== false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // Sync once the profile finishes loading on the parent page.
  useEffect(() => {
    if (profile) setAccepting(profile.acceptingNewClients !== false);
  }, [profile]);

  const toggle = async () => {
    if (saving) return;
    const next = !accepting;
    setAccepting(next); // optimistic
    setSaving(true);
    setError(false);
    try {
      const updated = onUpdate
        ? await onUpdate({ acceptingNewClients: next })
        : ((await profileAPI.update({
            acceptingNewClients: next,
          })) as IProfile);
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
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("acceptingNewClientsTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground font-light">
              {accepting
                ? t("acceptingNewClientsOnDesc")
                : t("acceptingNewClientsOffDesc")}
            </p>
            {error && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {t("acceptingNewClientsError")}
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
            aria-label={t("acceptingNewClientsLabel")}
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
