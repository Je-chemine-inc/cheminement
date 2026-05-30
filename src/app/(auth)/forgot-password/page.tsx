"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KeyRound, Mail, ArrowRight, ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AuthContainer,
  AuthHeader,
  AuthCard,
  AuthFooter,
} from "@/components/auth";

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth.forgotPassword");
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email"));
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Ref guard (not just the `submitting` state) so two synchronous clicks in the
  // same tick can't both fire — a second request would mint a new token and
  // invalidate the first email's link.
  const inFlight = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      // Fire the reset request. We always advance to the confirmation screen
      // regardless of the outcome so the UI never reveals whether the email is
      // registered (the endpoint is intentionally non-revealing too).
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Network error — still show the same confirmation; the user can resend.
    }
    // The form unmounts on the confirmation screen, so we intentionally leave
    // `inFlight` latched to block any further submits.
    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <AuthContainer>
        <AuthHeader
          icon={<Mail className="w-8 h-8 text-primary" />}
          title={t("checkEmailTitle")}
          description={t("checkEmailDescription")}
        />

        <AuthCard>
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <p className="text-muted-foreground font-light">
              {t("checkEmailMessage", { email: email || "" })}
            </p>
            <p className="text-sm text-muted-foreground font-light">
              {t("checkEmailSpam")}
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <Link
              href="/login"
              className="group w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-base font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <span>{t("backToLogin")}</span>
            </Link>
            <button
              onClick={() => {
                inFlight.current = false;
                setSubmitting(false);
                setIsSubmitted(false);
              }}
              className="w-full px-6 py-3 text-primary hover:text-primary/80 rounded-full text-base font-light tracking-wide transition-colors"
            >
              {t("resendEmail")}
            </button>
          </div>
        </AuthCard>

        <AuthFooter>
          <Link
            href="/"
            className="text-sm text-muted-foreground font-light hover:text-foreground transition-colors"
          >
            {t("backToHome")}
          </Link>
        </AuthFooter>
      </AuthContainer>
    );
  }

  return (
    <AuthContainer>
      <AuthHeader
        icon={<KeyRound className="w-8 h-8 text-primary" />}
        title={t("title")}
        description={t("description")}
      />

      <AuthCard>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email Field */}
          <div>
            <Label htmlFor="email" className="font-light mb-2">
              {t("email")}
            </Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email || ""}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 h-10"
                placeholder={t("emailPlaceholder")}
              />
            </div>
            <p className="mt-2 text-sm text-muted-foreground font-light">
              {t("emailHint")}
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="group w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-base font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <span>{t("sendResetLink")}</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        {/* Back to Login */}
        <div className="mt-6">
          <Link
            href="/login"
            className="group w-full flex items-center justify-center gap-2 px-6 py-3 border border-border/20 text-foreground rounded-full text-base font-light tracking-wide transition-all duration-300 hover:border-primary hover:text-primary"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span>{t("backToLogin")}</span>
          </Link>
        </div>
      </AuthCard>

      <AuthFooter>
        <p className="text-sm text-muted-foreground font-light">
          {t("noAccount")}{" "}
          <Link
            href="/signup"
            className="text-primary hover:text-primary/80 transition-colors"
          >
            {t("signUp")}
          </Link>
        </p>
      </AuthFooter>

      <AuthFooter>
        <Link
          href="/"
          className="text-sm text-muted-foreground font-light hover:text-foreground transition-colors"
        >
          {t("backToHome")}
        </Link>
      </AuthFooter>
    </AuthContainer>
  );
}
