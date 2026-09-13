"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Hourglass, Loader2 } from "lucide-react";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import {
  SHOWCASE_WAITLIST_ANCHOR,
  WAITLIST_CONSENT_VERSION,
  WAITLIST_MAX_MOTIFS,
  WAITLIST_PERIODS,
  WAITLIST_WEEKDAYS,
  type WaitlistModality,
  type WaitlistPeriod,
  type WaitlistWeekday,
} from "@/lib/waitlist-rules";

/**
 * The two waitlists on a professional's page (spec 003 phase 4): this
 * professional's own list — the form below, offers by email and, with consent,
 * text message — or Je chemine's general matching, which is the ordinary
 * booking funnel on www.
 */
export function ShowcaseWaitlistForm({
  slug,
  professionalName,
  services,
  modalities,
  motifOptions,
  matchUrl,
}: {
  slug: string;
  professionalName: string;
  /** The consultations one can wait for, the standard one first. */
  services: DirectRequestService[];
  modalities: WaitlistModality[];
  /** The professional's expertises, offered as reasons for consulting. */
  motifOptions: string[];
  /** The booking funnel on www: the general waitlist. */
  matchUrl: string;
}) {
  const t = useTranslations("ShowcaseWaitlist");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState<DirectRequestService>(services[0] ?? "standard");
  const [modality, setModality] = useState<WaitlistModality>(modalities[0] ?? "video");
  const [motifs, setMotifs] = useState<string[]>([]);
  const [periods, setPeriods] = useState<WaitlistPeriod[]>([]);
  const [days, setDays] = useState<WaitlistWeekday[]>([]);
  const [consent, setConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!consent) {
      setError(t("errors.consent"));
      return;
    }
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/showcase/${encodeURIComponent(slug)}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone,
          locale: locale === "en" ? "en" : "fr",
          service,
          modality,
          motifs,
          periods,
          days,
          consent,
          consentVersion: WAITLIST_CONSENT_VERSION,
          smsConsent: smsConsent && phone.trim() !== "",
        }),
      });
      if (res.ok) {
        setState("done");
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string; field?: string } | null;
      setError(
        body?.code === "WAITLIST_FULL"
          ? t("errors.full")
          : body?.code === "RATE_LIMITED"
            ? t("errors.rateLimited")
            : body?.field === "email"
              ? t("errors.email")
              : body?.field === "phone"
                ? t("errors.phone")
                : res.status === 400
                  ? t("errors.invalid")
                  : res.status === 404
                    ? t("errors.unavailable")
                    : t("errors.generic"),
      );
    } catch {
      setError(t("errors.generic"));
    }
    setState("idle");
  };

  const input =
    "mt-1 block w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none";
  const chip = (selected: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      selected ? "border-primary bg-primary/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <section
      id={SHOWCASE_WAITLIST_ANCHOR}
      aria-labelledby="showcase-waitlist"
      className="scroll-mt-24 rounded-2xl border border-border/60 bg-card p-6"
    >
      <h2 id="showcase-waitlist" className="flex items-center gap-2 font-serif text-xl font-light text-foreground">
        <Hourglass className="h-5 w-5 text-primary" aria-hidden="true" />
        {t("title")}
      </h2>

      {state === "done" ? (
        <div className="mt-4 space-y-2" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("doneTitle")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("doneBody", { name: professionalName })}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-foreground">{t("exclusiveTitle", { name: professionalName })}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("exclusiveBody")}</p>
            {open ? null : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 inline-flex rounded-lg border border-primary px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/5"
              >
                {t("join")}
              </button>
            )}
          </div>

          {open ? (
            <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-foreground">
                  {t("fields.firstName")}
                  <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={60} autoComplete="given-name" />
                </label>
                <label className="block text-sm text-foreground">
                  {t("fields.lastName")}
                  <input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={60} autoComplete="family-name" />
                </label>
              </div>
              <label className="block text-sm text-foreground">
                {t("fields.email")}
                <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
              </label>
              <label className="block text-sm text-foreground">
                {t("fields.phone")}
                <input
                  className={input}
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (e.target.value.trim() === "") setSmsConsent(false);
                  }}
                  maxLength={25}
                  autoComplete="tel"
                />
                <span className="mt-1 block text-xs text-muted-foreground">{t("fields.phoneHelp")}</span>
              </label>

              {services.length > 1 ? (
                <fieldset>
                  <legend className="text-sm text-foreground">{t("fields.service")}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {services.map((option) => (
                      <button key={option} type="button" aria-pressed={service === option} onClick={() => setService(option)} className={chip(service === option)}>
                        {t(`services.${option}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {modalities.length > 1 ? (
                <fieldset>
                  <legend className="text-sm text-foreground">{t("fields.modality")}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {modalities.map((option) => (
                      <button key={option} type="button" aria-pressed={modality === option} onClick={() => setModality(option)} className={chip(modality === option)}>
                        {t(`modalities.${option}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {motifOptions.length > 0 ? (
                <fieldset>
                  <legend className="text-sm text-foreground">{t("fields.motifs", { max: WAITLIST_MAX_MOTIFS })}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {motifOptions.map((option) => {
                      const selected = motifs.includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={selected}
                          disabled={!selected && motifs.length >= WAITLIST_MAX_MOTIFS}
                          onClick={() => setMotifs((current) => toggle(current, option))}
                          className={`${chip(selected)} disabled:opacity-50`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <fieldset>
                <legend className="text-sm text-foreground">{t("fields.periods")}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WAITLIST_PERIODS.map((option) => (
                    <button key={option} type="button" aria-pressed={periods.includes(option)} onClick={() => setPeriods((current) => toggle(current, option))} className={chip(periods.includes(option))}>
                      {t(`periods.${option}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm text-foreground">{t("fields.days")}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WAITLIST_WEEKDAYS.map((option) => (
                    <button key={option} type="button" aria-pressed={days.includes(option)} onClick={() => setDays((current) => toggle(current, option))} className={chip(days.includes(option))}>
                      {t(`days.${option}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("fields.anyTimeHelp")}</p>
              </fieldset>

              <label className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>{t("consent", { name: professionalName })}</span>
              </label>
              <label className={`flex items-start gap-2 text-xs leading-relaxed ${phone.trim() ? "text-foreground" : "text-muted-foreground"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={smsConsent}
                  disabled={phone.trim() === ""}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                />
                <span>{t("smsConsent")}</span>
              </label>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={state === "sending"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {state === "sending" ? t("sending") : t("submit")}
              </button>
            </form>
          ) : null}

          <div className="border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium text-foreground">{t("generalTitle")}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("generalBody")}</p>
            <a href={matchUrl} data-showcase-cta="" className="mt-2 inline-flex text-sm text-primary hover:underline">
              {t("generalCta")}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
