"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { X, UserPlus, Mail, Phone, MapPin, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { authAPI } from "@/lib/api-client";

interface AddPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddPatientModal({
  isOpen,
  onClose,
  onSuccess,
}: AddPatientModalProps) {
  // `t` (legal copy reused from member signup) + `tm` (this modal's labels).
  const t = useTranslations("Auth.memberSignup");
  const tm = useTranslations("AdminAddUserModal");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    phone: "",
    location: "",
  });
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [acceptPrivacyPolicy, setAcceptPrivacyPolicy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await authAPI.signup({
        ...formData,
        role: "client",
        agreeToTerms,
        acceptPrivacyPolicy,
        provisionedByAdmin: true,
      });

      onSuccess();
      onClose();
      setFormData({
        email: "",
        password: "",
        firstName: "",
        lastName: "",
        phone: "",
        location: "",
      });
      setAgreeToTerms(false);
      setAcceptPrivacyPolicy(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tm("errCreatePatient"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
      setFormData({
        email: "",
        password: "",
        firstName: "",
        lastName: "",
        phone: "",
        location: "",
      });
      setAgreeToTerms(false);
      setAcceptPrivacyPolicy(false);
      setError(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl m-4">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-light text-foreground">
                {tm("addPatientTitle")}
              </h2>
              <p className="text-sm text-muted-foreground font-light">
                {tm("addPatientSubtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="p-2 rounded-full hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <p className="text-sm text-red-600 font-light">{error}</p>
            </div>
          )}

          {/* Basic Information */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName" className="font-light">
                  {tm("firstName")} *
                </Label>
                <Input
                  id="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={(e) =>
                    handleInputChange("firstName", e.target.value)
                  }
                  required
                  disabled={isLoading}
                  className="font-light"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className="font-light">
                  {tm("lastName")} *
                </Label>
                <Input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) =>
                    handleInputChange("lastName", e.target.value)
                  }
                  required
                  disabled={isLoading}
                  className="font-light"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="font-light">
                {tm("email")} *
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  required
                  disabled={isLoading}
                  className="pl-10 font-light"
                  placeholder="patient@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="font-light">
                {tm("password")} *
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    handleInputChange("password", e.target.value)
                  }
                  required
                  disabled={isLoading}
                  className="pl-10 font-light"
                  placeholder={tm("passwordPlaceholder")}
                  minLength={8}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="font-light">
                {tm("phone")}
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  disabled={isLoading}
                  className="pl-10 font-light"
                  placeholder="+1 (555) 123-4567"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location" className="font-light">
                {tm("location")}
              </Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="location"
                  type="text"
                  value={formData.location}
                  onChange={(e) =>
                    handleInputChange("location", e.target.value)
                  }
                  disabled={isLoading}
                  className="pl-10 font-light"
                  placeholder={tm("locationPlaceholder")}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-border/40">
            <div className="flex items-start gap-3">
              <Checkbox
                id="addPatient-terms"
                checked={agreeToTerms}
                onCheckedChange={(c) => setAgreeToTerms(c === true)}
                disabled={isLoading}
              />
              <label
                htmlFor="addPatient-terms"
                className="text-sm font-light leading-relaxed cursor-pointer"
              >
                {t("termsAcceptBefore")}
                <Link href="/terms" className="text-primary hover:underline">
                  {t("termsOfService")}
                </Link>
                {t("termsAcceptAfter")}
              </label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="addPatient-privacy"
                checked={acceptPrivacyPolicy}
                onCheckedChange={(c) => setAcceptPrivacyPolicy(c === true)}
                disabled={isLoading}
              />
              <div className="space-y-1">
                <label
                  htmlFor="addPatient-privacy"
                  className="text-sm font-light leading-relaxed cursor-pointer block"
                >
                  {t("privacyAcceptBefore")}
                  <Link href="/privacy" className="text-primary hover:underline">
                    {t("privacyPolicy")}
                  </Link>
                  {t("privacyAcceptAfter")}
                </label>
                <p className="text-xs text-muted-foreground font-light">
                  {t("privacyConsentClinicalNote")}
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-6 border-t border-border/40">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
              className="font-light"
            >
              {tm("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                isLoading || !agreeToTerms || !acceptPrivacyPolicy
              }
              className="font-light tracking-wide transition-all duration-300 hover:scale-105"
            >
              {isLoading ? tm("creating") : tm("createPatient")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
