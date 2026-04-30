"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Settings,
  Save,
  RefreshCw,
  AlertCircle,
  DollarSign,
  Clock,
  Percent,
  Mail,
  Palette,
  Bell,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface EmailTemplateConfig {
  enabled: boolean;
  subject: string;
}

interface EmailBranding {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  companyName: string;
  footerText: string;
}

interface EmailSettings {
  enabled: boolean;
  smtpConfigured: boolean;
  branding: EmailBranding;
  templates: Record<string, EmailTemplateConfig>;
}

interface PlatformSettings {
  _id: string;
  defaultPricing: {
    solo: number;
    couple: number;
    group: number;
  };
  platformFeePercentage: number;
  currency: string;
  cancellationPolicy: {
    clientCancellationHours: number;
    clientRefundPercentage: number;
    professionalCancellationHours: number;
  };
  emailSettings: EmailSettings;
  createdAt: string;
  updatedAt: string;
}

// Email template display names and descriptions (French)
const EMAIL_TEMPLATE_INFO: Record<
  string,
  { name: string; description: string; category: string }
> = {
  welcome: {
    name: "Courriel de bienvenue",
    description: "Envoyé lors de la création d'un nouveau compte",
    category: "Authentification",
  },
  email_verification: {
    name: "Vérification du courriel",
    description: "Envoyé pour confirmer l'adresse courriel de l'utilisateur",
    category: "Authentification",
  },
  password_reset: {
    name: "Réinitialisation du mot de passe",
    description: "Envoyé lorsqu'un utilisateur demande une réinitialisation",
    category: "Authentification",
  },
  appointment_confirmation: {
    name: "Confirmation de rendez-vous",
    description: "Envoyé au client lorsque le rendez-vous est confirmé",
    category: "Rendez-vous",
  },
  appointment_professional_notification: {
    name: "Notification professionnel",
    description: "Envoyé au professionnel pour les nouvelles demandes de rendez-vous",
    category: "Rendez-vous",
  },
  appointment_reminder: {
    name: "Rappel de rendez-vous",
    description: "Envoyé avant les rendez-vous planifiés",
    category: "Rendez-vous",
  },
  appointment_cancellation: {
    name: "Avis d'annulation",
    description: "Envoyé lorsqu'un rendez-vous est annulé",
    category: "Rendez-vous",
  },
  guest_booking_confirmation: {
    name: "Confirmation réservation (invité)",
    description: "Envoyé aux invités lors de la soumission d'une demande de réservation",
    category: "Réservation invité",
  },
  guest_payment_confirmation: {
    name: "Demande de paiement (invité)",
    description: "Envoyé aux invités lorsque le paiement est requis",
    category: "Réservation invité",
  },
  guest_payment_complete: {
    name: "Paiement complété (invité)",
    description: "Envoyé aux invités après un paiement réussi",
    category: "Réservation invité",
  },
  payment_failed: {
    name: "Échec de paiement",
    description: "Envoyé lorsqu'une tentative de paiement échoue",
    category: "Paiements",
  },
  payment_refund: {
    name: "Confirmation de remboursement",
    description: "Envoyé lorsqu'un remboursement est traité",
    category: "Paiements",
  },
  meeting_link: {
    name: "Lien de réunion",
    description: "Envoyé lorsque le lien de réunion est ajouté au rendez-vous",
    category: "Rendez-vous",
  },
  professional_approval: {
    name: "Approbation professionnel",
    description: "Envoyé lorsque la candidature d'un professionnel est approuvée",
    category: "Professionnels",
  },
  professional_rejection: {
    name: "Refus de candidature professionnel",
    description: "Envoyé lorsque la candidature d'un professionnel est refusée",
    category: "Professionnels",
  },
};

const TEMPLATE_CATEGORIES = [
  "Authentification",
  "Rendez-vous",
  "Réservation invité",
  "Paiements",
  "Professionnels",
];

export default function SettingsPage() {
  const t = useTranslations("AdminDashboard.settings");
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["Authentification", "Rendez-vous"]),
  );

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/admin/settings");
      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }
      const data = await response.json();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defaultPricing: settings.defaultPricing,
          platformFeePercentage: settings.platformFeePercentage,
          currency: settings.currency,
          cancellationPolicy: settings.cancellationPolicy,
          emailSettings: settings.emailSettings,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save settings");
      }

      const updatedSettings = await response.json();
      setSettings(updatedSettings);
      setSuccessMessage("Settings saved successfully!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const updateSettings = (
    field: string,
    value: number | string | boolean,
    nested?: string,
  ) => {
    if (!settings) return;

    setSettings((prev) => {
      if (!prev) return prev;

      if (nested) {
        return {
          ...prev,
          [nested]: {
            ...(prev[nested as keyof PlatformSettings] as Record<
              string,
              unknown
            >),
            [field]: value,
          },
        };
      }

      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const updateEmailBranding = (field: string, value: string) => {
    if (!settings) return;

    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        emailSettings: {
          ...prev.emailSettings,
          branding: {
            ...prev.emailSettings.branding,
            [field]: value,
          },
        },
      };
    });
  };

  const updateEmailTemplate = (
    templateKey: string,
    field: "enabled" | "subject",
    value: boolean | string,
  ) => {
    if (!settings) return;

    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        emailSettings: {
          ...prev.emailSettings,
          templates: {
            ...prev.emailSettings.templates,
            [templateKey]: {
              ...prev.emailSettings.templates[templateKey],
              [field]: value,
            },
          },
        },
      };
    });
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getTemplatesByCategory = (category: string) => {
    return Object.entries(EMAIL_TEMPLATE_INFO).filter(
      ([, info]) => info.category === category,
    );
  };

  const toggleAllInCategory = (category: string, enabled: boolean) => {
    if (!settings) return;

    const templatesInCategory = getTemplatesByCategory(category);
    setSettings((prev) => {
      if (!prev) return prev;

      const updatedTemplates = { ...prev.emailSettings.templates };
      templatesInCategory.forEach(([key]) => {
        if (updatedTemplates[key]) {
          updatedTemplates[key] = {
            ...updatedTemplates[key],
            enabled,
          };
        }
      });

      return {
        ...prev,
        emailSettings: {
          ...prev.emailSettings,
          templates: updatedTemplates,
        },
      };
    });
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

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="animate-pulse space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <div className="h-6 bg-muted rounded w-32 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-10 bg-muted rounded"></div>
                  <div className="h-10 bg-muted rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !settings) {
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

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-light text-foreground mb-2">
                {t("failedLoad")}
              </h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <button
                onClick={fetchSettings}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                {t("tryAgain")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchSettings}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className={`h-4 w-4 ${saving ? "animate-pulse" : ""}`} />
            {saving ? t("saving") : t("saveChanges")}
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle className="h-5 w-5" />
            <p className="font-light">{successMessage}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle className="h-5 w-5" />
            <p className="font-light">{error}</p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Default Pricing Section */}
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center gap-2 mb-6">
            <DollarSign className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("defaultPricing")}
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("soloSession")} ({settings.currency})
              </label>
              <input
                type="number"
                value={settings.defaultPricing.solo}
                onChange={(e) =>
                  updateSettings(
                    "solo",
                    parseFloat(e.target.value),
                    "defaultPricing",
                  )
                }
                min="0"
                step="0.01"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Default price for individual sessions
              </p>
            </div>

            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("coupleSession")} ({settings.currency})
              </label>
              <input
                type="number"
                value={settings.defaultPricing.couple}
                onChange={(e) =>
                  updateSettings(
                    "couple",
                    parseFloat(e.target.value),
                    "defaultPricing",
                  )
                }
                min="0"
                step="0.01"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Default price for couple sessions
              </p>
            </div>

            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("groupSession")} ({settings.currency})
              </label>
              <input
                type="number"
                value={settings.defaultPricing.group}
                onChange={(e) =>
                  updateSettings(
                    "group",
                    parseFloat(e.target.value),
                    "defaultPricing",
                  )
                }
                min="0"
                step="0.01"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Default price per person in group sessions
              </p>
            </div>
          </div>
        </div>

        {/* Platform Fee Section */}
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center gap-2 mb-6">
            <Percent className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("platformFee")}
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("platformFeePct")}
              </label>
              <input
                type="number"
                value={settings.platformFeePercentage}
                onChange={(e) =>
                  updateSettings(
                    "platformFeePercentage",
                    parseFloat(e.target.value),
                  )
                }
                min="0"
                max="100"
                step="0.1"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Percentage of session fee taken by platform (0-100%)
              </p>
            </div>

            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("currency")}
              </label>
              <input
                type="text"
                value={settings.currency}
                onChange={(e) => updateSettings("currency", e.target.value)}
                maxLength={3}
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Currency code (e.g., CAD, USD, EUR)
              </p>
            </div>
          </div>
        </div>

        {/* Cancellation Policy Section */}
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center gap-2 mb-6">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("cancellationPolicy")}
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("clientCancelHours")}
              </label>
              <input
                type="number"
                value={settings.cancellationPolicy.clientCancellationHours}
                onChange={(e) =>
                  updateSettings(
                    "clientCancellationHours",
                    parseInt(e.target.value),
                    "cancellationPolicy",
                  )
                }
                min="0"
                step="1"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Hours before session client can cancel
              </p>
            </div>

            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("clientRefundPct")}
              </label>
              <input
                type="number"
                value={settings.cancellationPolicy.clientRefundPercentage}
                onChange={(e) =>
                  updateSettings(
                    "clientRefundPercentage",
                    parseInt(e.target.value),
                    "cancellationPolicy",
                  )
                }
                min="0"
                max="100"
                step="1"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Refund percentage for client cancellations
              </p>
            </div>

            <div>
              <label className="block text-sm font-light text-muted-foreground mb-2">
                {t("profCancelHours")}
              </label>
              <input
                type="number"
                value={
                  settings.cancellationPolicy.professionalCancellationHours
                }
                onChange={(e) =>
                  updateSettings(
                    "professionalCancellationHours",
                    parseInt(e.target.value),
                    "cancellationPolicy",
                  )
                }
                min="0"
                step="1"
                className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Hours before session professional must cancel
              </p>
            </div>
          </div>
        </div>

        {/* Email Notifications Section */}
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-serif font-light text-foreground">
                {t("emailNotif")}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {settings.emailSettings?.enabled
                  ? t("enabled")
                  : t("disabled")}
              </span>
              <button
                onClick={() =>
                  setSettings((prev) =>
                    prev
                      ? {
                          ...prev,
                          emailSettings: {
                            ...prev.emailSettings,
                            enabled: !prev.emailSettings?.enabled,
                          },
                        }
                      : prev,
                  )
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.emailSettings?.enabled
                    ? "bg-primary"
                    : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.emailSettings?.enabled
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {!settings.emailSettings?.enabled && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-6">
              <div className="flex items-center gap-2 text-yellow-800">
                <AlertCircle className="h-5 w-5" />
                <p className="font-light">
                  {t("emailWarning")}
                </p>
              </div>
            </div>
          )}

          {/* Email Branding */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-lg font-light text-foreground">{t("branding")}</h3>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-sm font-light text-muted-foreground mb-2">
                  {t("companyName")}
                </label>
                <input
                  type="text"
                  value={settings.emailSettings?.branding?.companyName || ""}
                  onChange={(e) =>
                    updateEmailBranding("companyName", e.target.value)
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="JeChemine"
                />
              </div>

              <div>
                <label className="block text-sm font-light text-muted-foreground mb-2">
                  {t("primaryColor")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={
                      settings.emailSettings?.branding?.primaryColor ||
                      "#8B7355"
                    }
                    onChange={(e) =>
                      updateEmailBranding("primaryColor", e.target.value)
                    }
                    className="h-10 w-14 rounded-lg border border-border/40 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={
                      settings.emailSettings?.branding?.primaryColor ||
                      "#8B7355"
                    }
                    onChange={(e) =>
                      updateEmailBranding("primaryColor", e.target.value)
                    }
                    className="flex-1 px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="#8B7355"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-light text-muted-foreground mb-2">
                  {t("secondaryColor")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={
                      settings.emailSettings?.branding?.secondaryColor ||
                      "#6B5344"
                    }
                    onChange={(e) =>
                      updateEmailBranding("secondaryColor", e.target.value)
                    }
                    className="h-10 w-14 rounded-lg border border-border/40 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={
                      settings.emailSettings?.branding?.secondaryColor ||
                      "#6B5344"
                    }
                    onChange={(e) =>
                      updateEmailBranding("secondaryColor", e.target.value)
                    }
                    className="flex-1 px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="#6B5344"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-light text-muted-foreground mb-2">
                  Logo URL (optional)
                </label>
                <input
                  type="url"
                  value={settings.emailSettings?.branding?.logoUrl || ""}
                  onChange={(e) =>
                    updateEmailBranding("logoUrl", e.target.value)
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="https://example.com/logo.png"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-light text-muted-foreground mb-2">
                  Footer Text
                </label>
                <input
                  type="text"
                  value={settings.emailSettings?.branding?.footerText || ""}
                  onChange={(e) =>
                    updateEmailBranding("footerText", e.target.value)
                  }
                  className="w-full px-4 py-2 rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Your journey to wellness starts here."
                />
              </div>
            </div>
          </div>

          {/* Email Templates */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-lg font-light text-foreground">
                Email Templates
              </h3>
            </div>

            <div className="space-y-4">
              {TEMPLATE_CATEGORIES.map((category) => {
                const templates = getTemplatesByCategory(category);
                const isExpanded = expandedCategories.has(category);
                const enabledCount = templates.filter(
                  ([key]) => settings.emailSettings?.templates?.[key]?.enabled,
                ).length;

                return (
                  <div
                    key={category}
                    className="border border-border/40 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-light text-foreground">
                          {category}
                        </span>
                        <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
                          {enabledCount}/{templates.length} enabled
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="p-4 space-y-4">
                        <div className="flex gap-2 mb-4">
                          <button
                            onClick={() => toggleAllInCategory(category, true)}
                            className="text-xs px-3 py-1 rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                          >
                            Enable All
                          </button>
                          <button
                            onClick={() => toggleAllInCategory(category, false)}
                            className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                          >
                            Disable All
                          </button>
                        </div>

                        {templates.map(([key, info]) => {
                          const template =
                            settings.emailSettings?.templates?.[key];
                          const isEnabled = template?.enabled ?? true;

                          return (
                            <div
                              key={key}
                              className={`p-4 rounded-lg border transition-colors ${
                                isEnabled
                                  ? "border-border/40 bg-background"
                                  : "border-border/20 bg-muted/30"
                              }`}
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    {isEnabled ? (
                                      <CheckCircle className="h-4 w-4 text-green-500" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <span className="font-medium text-foreground">
                                      {info.name}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {info.description}
                                  </p>
                                </div>
                                <button
                                  onClick={() =>
                                    updateEmailTemplate(
                                      key,
                                      "enabled",
                                      !isEnabled,
                                    )
                                  }
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                    isEnabled
                                      ? "bg-primary"
                                      : "bg-muted-foreground/30"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                      isEnabled
                                        ? "translate-x-5"
                                        : "translate-x-1"
                                    }`}
                                  />
                                </button>
                              </div>

                              {isEnabled && (
                                <div>
                                  <label className="block text-xs font-light text-muted-foreground mb-1">
                                    Subject Line
                                  </label>
                                  <input
                                    type="text"
                                    value={template?.subject || ""}
                                    onChange={(e) =>
                                      updateEmailTemplate(
                                        key,
                                        "subject",
                                        e.target.value,
                                      )
                                    }
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Email subject..."
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <h2 className="text-xl font-serif font-light text-foreground mb-4">
            <Settings className="h-5 w-5 inline mr-2" />
            Metadata
          </h2>
          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <div>
              <span className="text-muted-foreground">Last Updated:</span>
              <span className="ml-2 text-foreground">
                {new Date(settings.updatedAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>
              <span className="ml-2 text-foreground">
                {new Date(settings.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
