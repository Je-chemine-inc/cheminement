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
 * The two waitlists on a professional's page (spec 003 phase 4), as a wide row
 * under the booking panel: this professional's own list — the form, closed
 * until the visitor asks for it, opens full width; offers by email and, with
 * consent, text message — or Je chemine's general matching, which is the
 * ordinary booking funnel on www.
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
    "mt-2 block w-full rounded-2xl border border-[#E4E1DA] bg-[#FBFAF7] px-4 py-3 vt-md text-[#1F2A2E] placeholder:text-[#9AA19F] transition-colors focus:border-[#17505F] focus:bg-white focus:outline-none";
  const label = "block vt-sm font-medium text-[#3E494B]";
  const legend = "vt-sm font-medium text-[#3E494B]";
  const chip = (selected: boolean) =>
    `rounded-full border px-4 py-2 vt-sm font-medium transition-all duration-300 ${
      selected ? "border-[#17505F] bg-[#17505F] text-white" : "border-[#E4E1DA] bg-white text-[#3E494B] hover:border-[#17505F]"
    }`;

  return (
    <section
      id={SHOWCASE_WAITLIST_ANCHOR}
      aria-labelledby="showcase-waitlist"
      className="scroll-mt-28 rounded-[40px] border border-[#ECE8E1] bg-white p-[clamp(20px,2.6vw,44px)] shadow-[0_30px_70px_-56px_rgba(31,42,46,0.5)]"
    >
      {state === "done" ? (
        <div className="flex items-start gap-4 rounded-[28px] bg-[#E6EFEA] px-6 py-5" role="status">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#17505F]" aria-hidden="true" />
          <span className="vt-md leading-normal text-[#1F2A2E]">
            <strong id="showcase-waitlist" className="block font-semibold">
              {t("doneTitle")}
            </strong>
            {t("doneBody", { name: professionalName })}
          </span>
        </div>
      ) : (
        <>
          <div className="grid items-center gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#E6EFEA] text-[#17505F]">
                <Hourglass className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="showcase-waitlist" className="font-[family-name:var(--font-vitrine-serif)] text-[clamp(24px,2.1vw,34px)] leading-tight text-[#1F2A2E]">
                  {t("exclusiveTitle", { name: professionalName })}
                </h2>
                <p className="mt-2 max-w-[62ch] vt-md leading-[1.7] text-[#5B6566]">{t("exclusiveBody")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:justify-end">
              {open ? null : (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="rounded-full bg-[#17505F] px-7 py-4 vt-sm font-semibold text-white shadow-[0_16px_30px_-16px_rgba(23,80,95,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#0E3A46] motion-reduce:hover:translate-y-0"
                >
                  {t("join")}
                </button>
              )}
              <a
                href={matchUrl}
                data-showcase-cta=""
                title={t("generalBody")}
                className="rounded-full border border-[#D9D4CA] bg-white px-7 py-4 text-center vt-sm font-semibold text-[#17505F] transition-colors duration-300 hover:border-[#17505F] hover:text-[#17505F]"
              >
                {t("generalCta")}
              </a>
              <p className="w-full vt-xs leading-normal text-[#5B6566] lg:text-right">{t("generalBody")}</p>
            </div>
          </div>

          {open ? (
            <form onSubmit={(event) => void submit(event)} className="mt-8 grid gap-x-10 gap-y-6 border-t border-[#ECE8E1] pt-8 lg:grid-cols-2" noValidate>
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 xl:col-span-1">
                <label className={label}>
                  {t("fields.firstName")}
                  <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={60} autoComplete="given-name" />
                </label>
                <label className={label}>
                  {t("fields.lastName")}
                  <input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={60} autoComplete="family-name" />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 xl:col-span-1">
                <label className={label}>
                  {t("fields.email")}
                  <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
                </label>
                <label className={label}>
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
                  <span className="mt-1.5 block vt-xs font-normal text-[#5B6566]">{t("fields.phoneHelp")}</span>
                </label>
              </div>

              {services.length > 1 ? (
                <fieldset>
                  <legend className={legend}>{t("fields.service")}</legend>
                  <div className="mt-2.5 flex flex-wrap gap-2">
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
                  <legend className={legend}>{t("fields.modality")}</legend>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {modalities.map((option) => (
                      <button key={option} type="button" aria-pressed={modality === option} onClick={() => setModality(option)} className={chip(modality === option)}>
                        {t(`modalities.${option}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {motifOptions.length > 0 ? (
                <fieldset className="lg:col-span-2">
                  <legend className={legend}>{t("fields.motifs", { max: WAITLIST_MAX_MOTIFS })}</legend>
                  <div className="mt-2.5 flex flex-wrap gap-2">
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
                <legend className={legend}>{t("fields.periods")}</legend>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {WAITLIST_PERIODS.map((option) => (
                    <button key={option} type="button" aria-pressed={periods.includes(option)} onClick={() => setPeriods((current) => toggle(current, option))} className={chip(periods.includes(option))}>
                      {t(`periods.${option}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className={legend}>{t("fields.days")}</legend>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {WAITLIST_WEEKDAYS.map((option) => (
                    <button key={option} type="button" aria-pressed={days.includes(option)} onClick={() => setDays((current) => toggle(current, option))} className={chip(days.includes(option))}>
                      {t(`days.${option}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 vt-xs text-[#5B6566]">{t("fields.anyTimeHelp")}</p>
              </fieldset>

              <div className="space-y-3 lg:col-span-2">
                <label className="flex items-start gap-3 vt-sm leading-relaxed text-[#3E494B]">
                  <input type="checkbox" className="mt-1 h-4 w-4 rounded accent-[#17505F]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{t("consent", { name: professionalName })}</span>
                </label>
                <label className={`flex items-start gap-3 vt-sm leading-relaxed ${phone.trim() ? "text-[#3E494B]" : "text-[#9AA19F]"}`}>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded accent-[#17505F]"
                    checked={smsConsent}
                    disabled={phone.trim() === ""}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                  />
                  <span>{t("smsConsent")}</span>
                </label>
              </div>

              <div className="flex flex-col gap-4 lg:col-span-2 lg:flex-row lg:items-center lg:justify-between">
                {error ? (
                  <p role="alert" className="rounded-2xl bg-[#FDECEA] px-4 py-3 vt-sm text-[#B42318]">
                    {error}
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={state === "sending"}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#17505F] px-8 py-4 vt-md font-semibold text-white shadow-[0_16px_30px_-16px_rgba(23,80,95,0.9)] transition-all duration-300 hover:bg-[#0E3A46] disabled:opacity-60"
                >
                  {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {state === "sending" ? t("sending") : t("submit")}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
