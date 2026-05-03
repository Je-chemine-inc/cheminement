"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AuthCard,
  AuthContainer,
  AuthFooter,
  AuthHeader,
} from "@/components/auth";

function VerifyAccountInner() {
  const t = useTranslations("Auth.verifyAccount");
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid")?.trim() || "";
  const token = searchParams.get("token")?.trim() || "";
  const emailPreset = searchParams.get("email")?.trim() || "";

  const [resendEmail, setResendEmail] = useState(emailPreset);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailStepDone, setEmailStepDone] = useState(false);
  // Guard against React StrictMode double-fire and any unintended re-runs that
  // would consume the single-use token twice and produce "Lien invalide".
  const verifyAttempted = useRef(false);

  useEffect(() => {
    if (!uid || !token) return;
    if (verifyAttempted.current) return;
    verifyAttempted.current = true;

    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/account/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid, token }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(
            typeof data.error === "string"
              ? data.error
              : t("errors.verifyEmailFailed"),
          );
          return;
        }
        setEmailStepDone(true);
      } catch {
        if (!cancelled) setError(t("errors.network"));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, token, t]);

  const resendVerificationEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = resendEmail.trim().toLowerCase();
    if (!em) {
      setError(t("errors.emailRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/account/resend-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      if (!res.ok) {
        setError(t("errors.resendFailed"));
        return;
      }
      setInfo(t("resendSuccess"));
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  };

  const verifyLinkFailed = Boolean(uid && token && !emailStepDone && !busy && error);
  const showResendPanel = !emailStepDone && (!uid || !token || verifyLinkFailed);

  return (
    <AuthContainer maxWidth="lg">
      <AuthHeader
        icon={<ShieldCheck className="w-8 h-8 text-primary" />}
        title={t("title")}
        description={t("description")}
      />
      <AuthCard>
        {busy && !emailStepDone && uid && token ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{t("verifyingEmail")}</span>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {info ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            {info}
          </div>
        ) : null}

        {emailStepDone ? (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <p className="text-muted-foreground font-light">{t("allDone")}</p>
            <Button asChild className="w-full">
              <Link href="/login">{t("goToLogin")}</Link>
            </Button>
          </div>
        ) : null}

        {showResendPanel ? (
          <div className="space-y-6">
            <div className="flex gap-3 rounded-lg border border-border/40 bg-muted/30 p-4">
              <Mail className="h-5 w-5 shrink-0 text-primary mt-0.5" />
              <p className="text-sm text-muted-foreground font-light leading-relaxed">
                {t("checkInboxHint")}
              </p>
            </div>
            <form onSubmit={resendVerificationEmail} className="space-y-4">
              <div>
                <Label htmlFor="resend-email">{t("emailLabel")}</Label>
                <Input
                  id="resend-email"
                  type="email"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className="mt-1.5"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("sending")}
                  </>
                ) : (
                  t("resendEmail")
                )}
              </Button>
            </form>
          </div>
        ) : null}
      </AuthCard>
      <AuthFooter>
        <Link
          href="/login"
          className="text-sm font-light text-primary hover:text-primary/80"
        >
          {t("backToLogin")}
        </Link>
      </AuthFooter>
    </AuthContainer>
  );
}

export default function VerifyAccountPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <VerifyAccountInner />
    </Suspense>
  );
}
