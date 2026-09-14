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
 * booking funnel on www. Styled for the « vitrine » design.
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
    "mt-[7px] block w-full rounded-[11px] border border-[#E7DFD1] bg-[#FCFAF6] px-3.5 py-3 text-[15px] text-[#2F413D] placeholder:text-[#9DA29B] focus:border-[#17505F] focus:outline-none";
  const label = "block text-[13.5px] font-medium text-[#3D4B47]";
  const chip = (selected: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
      selected ? "border-[#17505F] bg-[#17505F] text-[#F6F2EA]" : "border-[#E7DFD1] bg-white text-[#3D4B47] hover:border-[#17505F]"
    }`;

  return (
    <section
      id={SHOWCASE_WAITLIST_ANCHOR}
      aria-labelledby="showcase-waitlist"
      className="scroll-mt-24 rounded-[22px] border border-[#E2EADC] bg-white p-[clamp(18px,2.6vw,26px)]"
    >
      <div className="mb-3 flex items-center gap-[11px]">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-[#E7EEE2] text-[#17505F]">
          <Hourglass className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <h2 id="showcase-waitlist" className="font-[family-name:var(--font-vitrine-serif)] text-[21px] font-medium text-[#0F3540]">
          {t("title")}
        </h2>
      </div>

      {state === "done" ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#DCE6D3] bg-[#F3F6F0] px-[15px] py-[13px]" role="status">
          <CheckCircle2 className="mt-px h-[18px] w-[18px] shrink-0 text-[#4E7A52]" aria-hidden="true" />
          <span className="text-sm leading-normal text-[#33453B]">
            <strong className="block font-semibold">{t("doneTitle")}</strong>
            {t("doneBody", { name: professionalName })}
          </span>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-[#15404B]">{t("exclusiveTitle", { name: professionalName })}</h3>
            <p className="mt-1 text-[14.5px] leading-[1.65] text-[#4C5853]">{t("exclusiveBody")}</p>
            {open ? null : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-4 w-full rounded-xl border border-[#17505F] bg-white px-[18px] py-[13px] text-[15px] font-semibold text-[#17505F] transition-colors hover:bg-[#17505F] hover:text-[#F8F5EE]"
              >
                {t("join")}
              </button>
            )}
          </div>

          {open ? (
            <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className={label}>
                  {t("fields.firstName")}
                  <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={60} autoComplete="given-name" />
                </label>
                <label className={label}>
                  {t("fields.lastName")}
                  <input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={60} autoComplete="family-name" />
                </label>
              </div>
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
                <span className="mt-1 block text-xs font-normal text-[#6A736C]">{t("fields.phoneHelp")}</span>
              </label>

              {services.length > 1 ? (
                <fieldset>
                  <legend className={label}>{t("fields.service")}</legend>
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
                  <legend className={label}>{t("fields.modality")}</legend>
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
                  <legend className={label}>{t("fields.motifs", { max: WAITLIST_MAX_MOTIFS })}</legend>
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
                <legend className={label}>{t("fields.periods")}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WAITLIST_PERIODS.map((option) => (
                    <button key={option} type="button" aria-pressed={periods.includes(option)} onClick={() => setPeriods((current) => toggle(current, option))} className={chip(periods.includes(option))}>
                      {t(`periods.${option}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className={label}>{t("fields.days")}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WAITLIST_WEEKDAYS.map((option) => (
                    <button key={option} type="button" aria-pressed={days.includes(option)} onClick={() => setDays((current) => toggle(current, option))} className={chip(days.includes(option))}>
                      {t(`days.${option}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-[#6A736C]">{t("fields.anyTimeHelp")}</p>
              </fieldset>

              <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[#3D4B47]">
                <input type="checkbox" className="mt-0.5 accent-[#17505F]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>{t("consent", { name: professionalName })}</span>
              </label>
              <label className={`flex items-start gap-2.5 text-[13px] leading-relaxed ${phone.trim() ? "text-[#3D4B47]" : "text-[#9DA29B]"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#17505F]"
                  checked={smsConsent}
                  disabled={phone.trim() === ""}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                />
                <span>{t("smsConsent")}</span>
              </label>

              {error ? (
                <p role="alert" className="text-sm text-[#B42318]">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={state === "sending"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#17505F] px-5 py-[15px] text-[15.5px] font-semibold text-[#F8F5EE] transition hover:bg-[#0E3A46] disabled:opacity-60"
              >
                {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {state === "sending" ? t("sending") : t("submit")}
              </button>
            </form>
          ) : null}

          <div className="border-t border-[#EDE6DA] pt-4">
            <h3 className="text-sm font-semibold text-[#15404B]">{t("generalTitle")}</h3>
            <p className="mt-1 text-[14.5px] leading-[1.65] text-[#4C5853]">{t("generalBody")}</p>
            <a href={matchUrl} data-showcase-cta="" className="mt-2 inline-flex text-sm font-medium text-[#17505F] hover:text-[#0E3A46]">
              {t("generalCta")}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
