"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Bell,
  Globe,
  Shield,
  AlertTriangle,
  Save,
  CheckCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function SettingsPage() {
  const t = useTranslations("Dashboard.settings");

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [language, setLanguage] = useState("fr");
  const [profileVisible, setProfileVisible] = useState(true);
  const [showRating, setShowRating] = useState(true);
  const [visibleToProfessionals, setVisibleToProfessionals] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState(false);

  const handleDeactivate = async () => {
    setDeactivating(true);
    setDeactivateError(false);
    try {
      const res = await fetch("/api/users/me/deactivate", { method: "POST" });
      if (!res.ok) throw new Error("deactivate failed");
      await signOut({ callbackUrl: "/login" });
    } catch {
      setDeactivateError(true);
      setDeactivating(false);
    }
  };

  // Load current privacy preferences from the professional's profile.
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        if (typeof p.profileVisible === "boolean")
          setProfileVisible(p.profileVisible);
        if (typeof p.showRating === "boolean") setShowRating(p.showRating);
        // Legacy profiles lack the field → treat anything but explicit false as visible.
        setVisibleToProfessionals(p.visibleToProfessionals !== false);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileVisible,
          showRating,
          visibleToProfessionals,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // keep the form state; the save simply did not persist
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="rounded-3xl border border-border/20 bg-linear-to-br from-card via-card/80 to-card/30 p-8 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Settings className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground/70">
              {t("badge")}
            </p>
            <h1 className="font-serif text-3xl font-light text-foreground">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              {t("notifications")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("notificationsDesc")}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <ToggleRow
            label={t("emailNotifications")}
            description={t("emailNotificationsDesc")}
            checked={emailNotifications}
            onChange={setEmailNotifications}
          />
          <ToggleRow
            label={t("smsNotifications")}
            description={t("smsNotificationsDesc")}
            checked={smsNotifications}
            onChange={setSmsNotifications}
          />
        </div>
      </section>

      {/* Language */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <Globe className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              {t("language")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("languageDesc")}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setLanguage("fr")}
            className={`rounded-full border px-5 py-2.5 text-sm font-medium transition ${
              language === "fr"
                ? "border-primary bg-primary text-primary-foreground shadow-lg"
                : "border-border/40 bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {t("french")}
          </button>
          <button
            onClick={() => setLanguage("en")}
            className={`rounded-full border px-5 py-2.5 text-sm font-medium transition ${
              language === "en"
                ? "border-primary bg-primary text-primary-foreground shadow-lg"
                : "border-border/40 bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {t("english")}
          </button>
        </div>
      </section>

      {/* Privacy */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              {t("privacy")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("privacyDesc")}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <ToggleRow
            label={t("profileVisible")}
            description={t("profileVisibleDesc")}
            checked={profileVisible}
            onChange={setProfileVisible}
          />
          <ToggleRow
            label={t("showRating")}
            description={t("showRatingDesc")}
            checked={showRating}
            onChange={setShowRating}
          />
          <ToggleRow
            label={t("visibleToPros")}
            description={t("visibleToProsDesc")}
            checked={visibleToProfessionals}
            onChange={setVisibleToProfessionals}
          />
        </div>
      </section>

      {/* Danger Zone */}
      <section className="rounded-3xl border border-red-200/40 bg-card/80 p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <div>
            <h2 className="font-serif text-xl font-medium text-red-600">
              {t("danger")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dangerDesc")}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setDeactivateError(false);
            setDeactivateOpen(true);
          }}
          className="gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <AlertTriangle className="h-4 w-4" />
          {t("deactivate")}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("deactivateDesc")}
        </p>
      </section>

      {/* Deactivate confirmation dialog */}
      <Dialog
        open={deactivateOpen}
        onOpenChange={(open) => {
          if (!deactivating) setDeactivateOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deactivateConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("deactivateConfirmDesc")}
            </DialogDescription>
          </DialogHeader>
          {deactivateError && (
            <p className="text-sm text-red-600">{t("deactivateError")}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeactivateOpen(false)}
              disabled={deactivating}
            >
              {t("deactivateCancel")}
            </Button>
            <Button
              onClick={handleDeactivate}
              disabled={deactivating}
              className="gap-2 bg-red-600 text-white hover:bg-red-700"
            >
              <AlertTriangle className="h-4 w-4" />
              {deactivating ? t("deactivating") : t("deactivateConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            {t("saved")}
          </span>
        )}
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2 rounded-full px-8 py-5 text-base font-medium"
        >
          <Save className="h-4 w-4" />
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/20 bg-card/60 px-5 py-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
