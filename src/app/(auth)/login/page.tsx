"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  UserCircle,
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AuthContainer,
  AuthHeader,
  AuthCard,
  AuthFooter,
} from "@/components/auth";


export default function LoginPage() {
  const t = useTranslations("Auth.login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const wasInactive = searchParams.get("reason") === "inactivity";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [verifyHint, setVerifyHint] = useState<"none" | "email" | "phone">(
    "none",
  );
  const [showPassword, setShowPassword] = useState(false);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
    return password.length >= 8;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setVerifyHint("none");

    // Client-side validation
    if (!email.trim()) {
      setError("Email is required");
      setIsLoading(false);
      return;
    }

    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      setIsLoading(false);
      return;
    }

    if (!password) {
      setError("Password is required");
      setIsLoading(false);
      return;
    }

    if (!validatePassword(password)) {
      setError("Password must be at least 8 characters long");
      setIsLoading(false);
      return;
    }

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        try {
          const diag = await fetch("/api/auth/account/login-reason", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (!diag.ok) {
            setError(t("errors.invalidCredentials"));
          } else {
            const body = (await diag.json()) as { code?: string };
            const code = body.code;
            if (code === "AUTH_EMAIL_NOT_VERIFIED") {
              setError(t("errors.emailNotVerified"));
              setVerifyHint("email");
            } else if (code === "AUTH_ACCOUNT_INACTIVE") {
              setError(t("errors.accountInactive"));
            } else if (code === "AUTH_LICENSE_REJECTED") {
              setError(t("errors.licenseRejected"));
            } else if (code === "OK") {
              setError(t("errors.genericSignIn"));
            } else {
              setError(t("errors.invalidCredentials"));
            }
          }
        } catch {
          setError(t("errors.genericSignIn"));
        }
      } else {
        // Get the session to determine user role
        const response = await fetch("/api/auth/session");
        const session = await response.json();

        if (session?.user?.role) {
          const role = session.user.role;
          const dashboardMap: Record<string, string> = {
            client: "/client/dashboard",
            professional: "/professional/dashboard",
            admin: "/admin/dashboard",
          };
          const dashboardUrl = dashboardMap[role] || "/client/dashboard";
          router.push(dashboardUrl);
        } else {
          router.push("/client/dashboard");
        }
      }
    } catch {
      setError(t("errors.genericSignIn"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContainer>
      <AuthHeader
        icon={<UserCircle className="w-8 h-8 text-primary" />}
        title={t("title")}
        description={t("description")}
      />

      <AuthCard>
        {wasInactive && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {t("sessionExpiredInactivity")}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md space-y-2">
              <p className="text-sm text-red-600">{error}</p>
              {(verifyHint === "email" || verifyHint === "phone") && (
                <Link
                  href={`/verify-account?email=${encodeURIComponent(email)}`}
                  className="text-sm text-primary hover:text-primary/80 font-light inline-block"
                >
                  {t("confirmAccountLink")}
                </Link>
              )}
            </div>
          )}

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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 h-10"
                placeholder={t("emailPlaceholder")}
              />
            </div>
          </div>

          {/* Password Field */}
          <div>
            <Label htmlFor="password" className="font-light mb-2">
              {t("password")}
            </Label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 pr-9 h-10"
                placeholder={t("passwordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Remember Me & Forgot Password */}
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 text-primary focus:ring-primary border-border/20 rounded"
              />
              <Label htmlFor="remember-me" className="ml-2 font-light">
                {t("rememberMe")}
              </Label>
            </div>

            <div className="text-sm">
              <Link
                href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
                className="font-light text-primary hover:text-primary/80 transition-colors"
              >
                {t("forgotPassword")}
              </Link>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="group w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-base font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>{t("signIn")}</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

      </AuthCard>

      <AuthFooter>
        <p className="text-sm text-muted-foreground font-light">
          {t("noAccount")}{" "}
          <Link
            href="/signup"
            className="text-primary hover:text-primary/80 transition-colors"
          >
            {t("createAccount")}
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
