import { getTranslations } from "next-intl/server";
import { CheckCircle2, Mail, Clock, UserCheck } from "lucide-react";
import { SignOutButton } from "./SignOutButton";

export default async function ProfessionalAccountPendingPage() {
  const t = await getTranslations("Auth.professionalAccountPending");

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <div className="flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-10 w-10" strokeWidth={1.5} />
        </div>
      </div>

      <div className="text-center space-y-3">
        <h1 className="font-serif text-3xl font-light text-foreground md:text-4xl">
          {t("title")}
        </h1>
        <p className="text-base text-muted-foreground font-light leading-relaxed">
          {t("description")}
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-sm font-light leading-relaxed text-amber-900 dark:text-amber-100">
            {t("emailNotice")}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border/40 bg-muted/30 p-6">
        <h2 className="font-medium text-foreground">{t("nextStepsTitle")}</h2>
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="text-sm font-light leading-relaxed text-muted-foreground">
              {t("nextStep1")}
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="text-sm font-light leading-relaxed text-muted-foreground">
              {t("nextStep2")}
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="text-sm font-light leading-relaxed text-muted-foreground">
              {t("nextStep3")}
            </span>
          </li>
        </ul>
      </div>

      <div className="flex justify-center pt-2">
        <SignOutButton label={t("signOut")} />
      </div>
    </div>
  );
}
