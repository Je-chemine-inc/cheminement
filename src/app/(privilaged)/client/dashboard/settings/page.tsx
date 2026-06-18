"use client";

import { useState } from "react";
import {
  Settings,
  Bell,
  Globe,
  AlertTriangle,
  Save,
  CheckCircle,
  Trash2,
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
  const [saved, setSaved] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionSubmitting, setDeletionSubmitting] = useState(false);
  const [deletionError, setDeletionError] = useState(false);
  const [deletionSent, setDeletionSent] = useState(false);

  // Permanent deletion is NOT performed in-app: this submits a request that
  // notifies admins (email + in-app inbox). The actual erasure is handled by
  // the team, preserving invoices/financial data per legal retention rules.
  const handleRequestDeletion = async () => {
    setDeletionSubmitting(true);
    setDeletionError(false);
    try {
      const res = await fetch("/api/users/me/request-deletion", {
        method: "POST",
      });
      if (!res.ok) throw new Error("request failed");
      setDeletionSent(true);
      setDeletionOpen(false);
    } catch {
      setDeletionError(true);
    } finally {
      setDeletionSubmitting(false);
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

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

        {/* Right to be forgotten — permanent deletion request */}
        <div className="mt-8 border-t border-red-200/40 pt-6">
          <h3 className="font-medium text-foreground">
            {t("deleteSectionTitle")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("deleteLegalMention")}{" "}
            <a
              href="mailto:support@jechemine.ca"
              className="font-medium text-primary underline"
            >
              support@jechemine.ca
            </a>
            .
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("deleteRetentionNotice")}
          </p>
          {deletionSent ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{t("deleteSuccessTitle")}</p>
                <p>{t("deleteSuccessDesc")}</p>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setDeletionError(false);
                setDeletionOpen(true);
              }}
              className="mt-4 gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
              {t("deleteRequestButton")}
            </Button>
          )}
        </div>
      </section>

      {/* Permanent deletion request confirmation dialog */}
      <Dialog
        open={deletionOpen}
        onOpenChange={(open) => {
          if (!deletionSubmitting) setDeletionOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirmDesc")}</DialogDescription>
          </DialogHeader>
          {deletionError && (
            <p className="text-sm text-red-600">{t("deleteError")}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletionOpen(false)}
              disabled={deletionSubmitting}
            >
              {t("deleteCancel")}
            </Button>
            <Button
              onClick={handleRequestDeletion}
              disabled={deletionSubmitting}
              className="gap-2 bg-red-600 text-white hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" />
              {deletionSubmitting ? t("deleteSubmitting") : t("deleteConfirmCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <Button onClick={handleSave} className="gap-2 rounded-full px-8 py-5 text-base font-medium">
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
