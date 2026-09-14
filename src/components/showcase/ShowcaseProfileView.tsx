import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Headphones,
  Info,
  Leaf,
  MapPin,
  MessageSquare,
  MonitorPlay,
  Phone,
  PlayCircle,
  ShieldCheck,
  Tag,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import type { ShowcaseModalityKey, ShowcasePublicProfile } from "@/lib/showcase-public";
import { SHOWCASE_HUB_PATH, absoluteShowcaseUrl, canonicalSiteUrl } from "@/lib/showcase-hosts";
import type { WaitlistModality } from "@/lib/waitlist-rules";
import { VITRINE_ANCHORS, headlinePrice, initialsOf, vitrineSections, type VitrineSection } from "@/lib/showcase-vitrine";
import type { ShowcaseProductCard } from "@/lib/products";
import { ShowcaseWaitlistForm } from "@/components/showcase/ShowcaseWaitlistForm";
import { VitrineBooking } from "@/components/showcase/vitrine/VitrineBooking";
import { VitrineHeader } from "@/components/showcase/vitrine/VitrineHeader";
import { VitrineMotion } from "@/components/showcase/vitrine/VitrineMotion";
import { vitrineSans, vitrineSerif } from "@/components/showcase/vitrine/fonts";

/**
 * A professional's showcase page (spec 003), in the « vitrine » design from
 * Claude Design: the professional's own header, a hero, what the platform
 * knows about them, their approach, fees, free times and waitlist, products,
 * frequent questions. Built from the public data object only; a section with
 * nothing to show is left out. Rendered on the city host, and in the
 * professional's and the admin's preview (`preview`: a banner, the photo loaded
 * without Next's optimizer, which cannot see an unpublished photo, no free
 * times, no waitlist, nothing sticky).
 *
 * Everything a professional wrote goes through React, never as HTML.
 */

const MODALITY_ICONS: Record<ShowcaseModalityKey, LucideIcon> = {
  inPerson: MapPin,
  video: Video,
  phone: Phone,
  chat: MessageSquare,
};

const PRODUCT_ICONS: Record<ShowcaseProductCard["type"], LucideIcon> = {
  video: PlayCircle,
  audio: Headphones,
  pdf: FileText,
  webinar: MonitorPlay,
  external: ExternalLink,
};

const ROOT_ID = "vitrine";
const SERIF = "font-[family-name:var(--font-vitrine-serif)]";
const WRAP = "mx-auto w-full max-w-[1180px] px-[clamp(14px,3vw,28px)]";
const SECTION = "scroll-mt-20 py-[clamp(48px,7vw,96px)]";
const EYEBROW = "mb-3.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#5E6A5A]";
const H2 = `${SERIF} text-[clamp(28px,4vw,44px)] font-medium leading-[1.12] tracking-[-0.022em] text-[#0F3540] text-pretty`;
const LEAD = "text-[clamp(16px,1.7vw,18px)] leading-[1.7] text-[#4C5853] text-pretty";
const CARD =
  "rounded-[20px] border border-[#EDE6DA] bg-white transition duration-300 ease-[cubic-bezier(.22,.8,.26,1)] hover:-translate-y-1 hover:border-[#D6DFCF] hover:shadow-[0_24px_44px_-30px_rgba(16,51,61,0.5)] motion-reduce:transition-none motion-reduce:hover:translate-y-0";
const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-2.5 rounded-[14px] bg-[#17505F] font-semibold text-[#F8F5EE] shadow-[0_16px_30px_-18px_rgba(23,80,95,0.85)] transition hover:-translate-y-0.5 hover:bg-[#0E3A46] hover:text-[#F8F5EE] motion-reduce:hover:translate-y-0";
const BUTTON_OUTLINE =
  "inline-flex items-center justify-center gap-2.5 rounded-[14px] border border-[#CBD4C7] bg-white font-semibold text-[#17505F] transition hover:border-[#17505F] hover:bg-[#F3F6F0] hover:text-[#17505F]";

/** Keyframes for the hero's entrance and the drifting light; off with reduced motion. */
const MOTION_CSS = `
@keyframes vitrineUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes vitrineIn{from{opacity:0;transform:scale(.965)}to{opacity:1;transform:none}}
@keyframes vitrineDrift{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(-28px,20px,0) scale(1.09)}}
.vitrine-up{animation:vitrineUp .75s cubic-bezier(.22,.8,.26,1) both}
.vitrine-in{animation:vitrineIn .95s cubic-bezier(.22,.8,.26,1) .1s both}
.vitrine-drift{animation:vitrineDrift 26s ease-in-out infinite alternate}
@media (prefers-reduced-motion: reduce){.vitrine-up,.vitrine-in,.vitrine-drift{animation:none}}
`;

/** Where "request an appointment" leads: the booking funnel on www. */
export function showcaseBookingUrl(profile: Pick<ShowcasePublicProfile, "slug" | "city">): string {
  const query = new URLSearchParams({ from: "showcase", pro: profile.slug, city: profile.city.key });
  return canonicalSiteUrl(`/appointment?${query.toString()}`);
}

/** How one can wait for this professional: the ways they consult, or all of them when none is listed. */
function waitlistModalitiesOf(keys: readonly ShowcaseModalityKey[]): WaitlistModality[] {
  const modalities: WaitlistModality[] = [];
  if (keys.includes("video")) modalities.push("video");
  if (keys.includes("inPerson")) modalities.push("in-person");
  if (keys.includes("phone")) modalities.push("phone");
  return modalities.length > 0 ? modalities : ["video", "in-person", "phone"];
}

export async function ShowcaseProfileView({
  profile,
  preview = false,
  products = [],
}: {
  profile: ShowcasePublicProfile;
  preview?: boolean;
  /** The professional's live trainings and products (spec 003 phase 5), sold on www. */
  products?: ShowcaseProductCard[];
}) {
  const t = await getTranslations("Showcase");
  const localeTag = (await getLocale()) === "en" ? "en-CA" : "fr-CA";
  const money = new Intl.NumberFormat(localeTag, {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const orList = new Intl.ListFormat(localeTag, { type: "disjunction" });

  const name = profile.displayName;
  const title = profile.title.key ? t(`titles.${profile.title.key}`) : profile.title.label;
  const orderName = profile.order
    ? profile.order.code === "other"
      ? profile.order.label
      : t(`orders.${profile.order.code}`)
    : null;
  const credential =
    orderName && profile.licenseNumber
      ? t("vitrine.orderPermit", { order: orderName, number: profile.licenseNumber })
      : orderName ?? (profile.licenseNumber ? t("profile.permit", { number: profile.licenseNumber }) : null);
  const officeCity = profile.officeCity ?? profile.city.name;
  const { standard, quick } = profile.services;
  const bookingUrl = showcaseBookingUrl(profile);
  const bookable: DirectRequestService[] = [
    ...(standard.offered ? (["standard"] as const) : []),
    ...(quick.offered ? (["quick"] as const) : []),
  ];
  // With a consultation open, the booking buttons lead to the free times, and the
  // funnel is reached through a chosen time. With none, they offer Je chemine's matching.
  const showSlots = !preview && bookable.length > 0;
  const bookLabel = bookable.length > 0 ? t("profile.bookCta") : t("profile.matchCta");
  const bookHref = showSlots ? `#${VITRINE_ANCHORS.slots}` : bookingUrl;
  const bookFunnel = showSlots ? {} : { "data-showcase-cta": "" };
  const cityHref = preview ? absoluteShowcaseUrl(profile.city.key, "/") : "/";

  const about = [...profile.intro, ...profile.bio];
  const sections = vitrineSections({ hasAbout: about.length > 0, showSlots, hasProducts: products.length > 0 });
  const navLinks = sections.map((section: VitrineSection) => ({
    href: `#${VITRINE_ANCHORS[section]}`,
    label: t(`vitrine.nav.${section}`),
  }));

  const hasInPerson = profile.modalities.includes("inPerson");
  const hasVideo = profile.modalities.includes("video");
  const place = hasInPerson && hasVideo
    ? t("vitrine.placeBoth", { city: officeCity })
    : hasInPerson
      ? officeCity
      : hasVideo
        ? t("vitrine.placeVideo")
        : profile.city.name;
  const modes = profile.modalities.length > 0 ? orList.format(profile.modalities.map((key) => t(`vitrine.modesShort.${key}`))) : "";
  const languages = profile.languages.map((language) => t(`languages.${language}`)).join(", ");
  const standardPrice = headlinePrice(standard.prices);
  const years = profile.yearsOfExperience;
  const aboutHeading = title
    ? years !== null && years > 0
      ? t("vitrine.about.headingYears", { title, years, city: officeCity })
      : t("vitrine.about.heading", { title, city: officeCity })
    : t("vitrine.about.headingNoTitle", { name, city: officeCity });

  const facts: { icon: LucideIcon; text: string }[] = [
    ...(credential ? [{ icon: ShieldCheck, text: credential }] : []),
    ...(years !== null ? [{ icon: Award, text: t("profile.experience", { years }) }] : []),
    ...(languages ? [{ icon: Globe, text: languages }] : []),
    ...(hasInPerson ? [{ icon: MapPin, text: t("vitrine.about.office", { city: officeCity }) }] : []),
    ...(hasVideo ? [{ icon: Video, text: t("vitrine.chips.video") }] : []),
  ];
  const trust: { icon: LucideIcon; text: string }[] = [
    ...(credential ? [{ icon: ShieldCheck, text: credential }] : []),
    { icon: CheckCircle2, text: t("vitrine.trust.receipt") },
    { icon: CalendarDays, text: t("vitrine.trust.cancellation", { hours: profile.freeCancellationHours }) },
    ...(bookable.length > 0 ? [{ icon: Clock, text: t("vitrine.trust.answer") }] : []),
  ];
  const steps = [
    { title: t("vitrine.approach.requestTitle"), body: t("vitrine.approach.requestBody", { name }) },
    { title: t("vitrine.approach.answerTitle"), body: t("vitrine.approach.answerBody", { name }) },
    { title: t("vitrine.approach.firstTitle"), body: t("vitrine.approach.firstBody") },
    { title: t("vitrine.approach.nextTitle"), body: t("vitrine.approach.nextBody", { name }) },
  ];
  const faq = [
    { q: t("vitrine.faq.bookingQ"), a: t("vitrine.faq.bookingA", { name }) },
    ...(modes ? [{ q: t("vitrine.faq.modesQ"), a: t("vitrine.faq.modesA", { name, modes }) }] : []),
    { q: t("vitrine.faq.insuranceQ"), a: t("vitrine.faq.insuranceA") },
    { q: t("vitrine.faq.privacyQ"), a: t("vitrine.faq.privacyA") },
    { q: t("vitrine.faq.cancelQ"), a: t("vitrine.faq.cancelA", { hours: profile.freeCancellationHours }) },
    ...(preview ? [] : [{ q: t("vitrine.faq.waitQ"), a: t("vitrine.faq.waitA", { name }) }]),
  ];

  const waitlist = preview ? null : (
    <ShowcaseWaitlistForm
      slug={profile.slug}
      professionalName={name}
      services={["standard", ...(quick.offered ? (["quick"] as const) : [])]}
      modalities={waitlistModalitiesOf(profile.modalities)}
      motifOptions={profile.expertises.map((expertise) => expertise.label)}
      matchUrl={bookingUrl}
    />
  );

  return (
    <article
      id={ROOT_ID}
      className={`${vitrineSerif.variable} ${vitrineSans.variable} min-h-screen bg-[#FAF7F2] font-[family-name:var(--font-vitrine-sans)] text-[#414E4B] antialiased`}
    >
      <style>{MOTION_CSS}</style>

      {preview ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {t("profile.previewBanner")}
        </div>
      ) : null}

      <div className="bg-[#12414F] text-[#D8E4DE]">
        <div className={`${WRAP} flex flex-wrap items-center gap-x-[18px] gap-y-2 py-[9px] text-[12.5px]`}>
          <span className="inline-flex items-center gap-[7px]">
            <Leaf className="h-[15px] w-[15px]" aria-hidden="true" />
            {t("vitrine.verified")}
          </span>
          {credential ? (
            <span className="inline-flex items-center gap-[7px] text-[#BFD2CB]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {credential}
            </span>
          ) : null}
          <a href={cityHref} className="ml-auto inline-flex items-center gap-[7px] whitespace-nowrap text-[#D8E4DE] hover:text-white">
            {t("vitrine.others", { city: profile.city.name })}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      <VitrineHeader
        name={name}
        title={title}
        links={navLinks}
        bookHref={bookHref}
        bookLabel={bookLabel}
        bookIsFunnel={!showSlots}
        navLabel={t("vitrine.nav.label")}
        sticky={!preview}
      />

      <section
        id={VITRINE_ANCHORS.top}
        className="relative scroll-mt-20 overflow-hidden border-b border-[#EDE6DA] bg-[radial-gradient(120%_150%_at_78%_0%,#E9F0E3_0%,#F5F2EA_46%,#FAF7F2_100%)]"
      >
        <div
          aria-hidden="true"
          className="vitrine-drift pointer-events-none absolute -right-[140px] -top-[200px] h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(169,190,155,0.4),rgba(169,190,155,0)_68%)]"
        />
        <div className={`${WRAP} relative flex flex-wrap items-center gap-[clamp(26px,4vw,56px)] pb-[clamp(34px,4.5vw,60px)] pt-[clamp(34px,5.5vw,72px)]`}>
          <div className="min-w-0 flex-[1_1_400px]">
            <p className="vitrine-up mb-[18px] text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#5E6A5A]">
              {title ? `${title} · ${place}` : place}
            </p>
            <h1
              className={`vitrine-up ${SERIF} mb-5 max-w-[19ch] text-[clamp(36px,5.6vw,64px)] font-medium leading-[1.05] tracking-[-0.026em] text-[#0F3540] text-pretty [animation-delay:.07s]`}
            >
              {name}
            </h1>
            {profile.headline ? (
              <p className="vitrine-up mb-[26px] max-w-[54ch] text-[clamp(16.5px,1.8vw,19.5px)] leading-[1.65] text-[#3B4844] text-pretty [animation-delay:.14s]">
                {profile.headline}
              </p>
            ) : null}
            <div className="vitrine-up mb-[26px] flex flex-wrap items-center gap-3.5 [animation-delay:.21s]">
              <a href={bookHref} {...bookFunnel} className={`${BUTTON_PRIMARY} px-[26px] py-4 text-[15.5px]`}>
                {bookLabel}
                <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
              </a>
              <a href={`#${VITRINE_ANCHORS.services}`} className={`${BUTTON_OUTLINE} px-[22px] py-[15px] text-[15.5px]`}>
                <Tag className="h-[17px] w-[17px]" aria-hidden="true" />
                {t("vitrine.heroSecondary")}
              </a>
            </div>
            <ul className="vitrine-up flex flex-wrap gap-2 [animation-delay:.28s]">
              {profile.modalities.map((modality) => {
                const Icon = MODALITY_ICONS[modality];
                return (
                  <li key={modality} className="inline-flex items-center gap-[7px] rounded-full border border-[#EAE2D5] bg-white px-3.5 py-2 text-[13.5px] text-[#3D4B47]">
                    <Icon className="h-[15px] w-[15px] text-[#17505F]" aria-hidden="true" />
                    {modality === "inPerson" ? t("vitrine.chips.inPerson", { city: officeCity }) : t(`vitrine.chips.${modality}`)}
                  </li>
                );
              })}
              {languages ? (
                <li className="inline-flex items-center gap-[7px] rounded-full border border-[#EAE2D5] bg-white px-3.5 py-2 text-[13.5px] text-[#3D4B47]">
                  <Globe className="h-[15px] w-[15px] text-[#17505F]" aria-hidden="true" />
                  {languages}
                </li>
              ) : null}
              {years !== null ? (
                <li className="inline-flex items-center gap-[7px] rounded-full border border-[#EAE2D5] bg-white px-3.5 py-2 text-[13.5px] text-[#3D4B47]">
                  <CalendarDays className="h-[15px] w-[15px] text-[#17505F]" aria-hidden="true" />
                  {t("profile.experience", { years })}
                </li>
              ) : null}
            </ul>
          </div>

          <div className="relative min-w-0 flex-[0_1_380px]">
            <div aria-hidden="true" className="absolute inset-[18px_-16px_-18px_16px] rounded-[28px] bg-[#DCE6D3] opacity-70" />
            <div className="vitrine-in relative rounded-[28px] border border-[#EDE6DA] bg-white p-[9px] shadow-[0_30px_56px_-34px_rgba(16,51,61,0.45)]">
              <div className="relative h-[clamp(280px,38vw,420px)] w-full overflow-hidden rounded-[20px] bg-[linear-gradient(160deg,#E9F0E3,#DCE6D3)]">
                {profile.photoUrl ? (
                  <Image
                    src={profile.photoUrl}
                    alt={t("profile.photoAlt", { name })}
                    fill
                    sizes="(min-width: 1024px) 380px, 90vw"
                    className="object-cover"
                    priority
                    unoptimized={preview}
                  />
                ) : (
                  <div className={`flex h-full items-center justify-center ${SERIF} text-6xl font-medium text-[#17505F]/70`}>
                    {initialsOf(name)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#EDE6DA] bg-white">
        <ul className={`${WRAP} grid items-center gap-x-[30px] gap-y-3.5 py-[clamp(18px,2.4vw,26px)] [grid-template-columns:repeat(auto-fit,minmax(236px,1fr))]`}>
          {trust.map((item, index) => (
            <li key={index} className="inline-flex items-center gap-2.5 text-sm text-[#3D4B47]">
              <item.icon className="h-[18px] w-[18px] shrink-0 text-[#17505F]" aria-hidden="true" />
              {item.text}
            </li>
          ))}
        </ul>
      </section>

      {about.length > 0 ? (
        <section id={VITRINE_ANCHORS.about} className={`${SECTION} border-b border-[#EDE6DA] bg-white`}>
          <div className={`${WRAP} flex flex-wrap items-start gap-[clamp(28px,4vw,64px)]`}>
            {facts.length > 0 ? (
              <aside data-reveal="0" className="min-w-0 max-w-[420px] flex-[1_1_300px] rounded-2xl border border-[#EDE6DA] bg-[#FCFAF6] px-5 py-[18px]">
                <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[#666E62]">{t("vitrine.about.factsTitle")}</p>
                <ul className="flex flex-col gap-[11px] text-sm text-[#3D4B47]">
                  {facts.map((fact, index) => (
                    <li key={index} className="flex gap-2.5">
                      <fact.icon className="mt-px h-[17px] w-[17px] shrink-0 text-[#17505F]" aria-hidden="true" />
                      <span>{fact.text}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
            <div data-reveal="1" className="min-w-0 flex-[1_1_420px]">
              <p className={EYEBROW}>{t("vitrine.about.eyebrow")}</p>
              <h2 className={`${H2} mb-[18px]`}>{aboutHeading}</h2>
              {about.map((paragraph, index) => (
                <p
                  key={index}
                  className={`mb-3.5 whitespace-pre-line text-pretty ${
                    index === 0 ? "text-[clamp(16px,1.7vw,18px)] leading-[1.7] text-[#36433F]" : "text-base leading-[1.75] text-[#4C5853]"
                  }`}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section id={VITRINE_ANCHORS.approach} className={SECTION}>
        <div className={WRAP}>
          <p className={EYEBROW}>{t("vitrine.approach.eyebrow")}</p>
          {profile.approach.length > 0 ? (
            <>
              <h2 className={`${H2} mb-3.5 max-w-[24ch]`}>{t("vitrine.approach.title")}</h2>
              <div className="mb-11 max-w-[62ch] space-y-3.5">
                {profile.approach.map((paragraph, index) => (
                  <p key={index} className={`${LEAD} whitespace-pre-line`}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </>
          ) : null}
          <h3
            className={`${
              profile.approach.length > 0 ? `${SERIF} text-[clamp(22px,2.6vw,28px)] tracking-[-0.015em]` : `${H2} max-w-[24ch]`
            } mb-5 font-medium text-[#0F3540]`}
          >
            {t("vitrine.approach.stepsTitle")}
          </h3>
          <ol className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {steps.map((step, index) => (
              <li key={index} data-reveal={index} className={`${CARD} rounded-2xl px-[22px] py-5`}>
                <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#666E62]">
                  {t("vitrine.approach.step", { number: String(index + 1).padStart(2, "0") })}
                </p>
                <p className="mb-1.5 text-base font-semibold text-[#16404C]">{step.title}</p>
                <p className="text-sm leading-[1.6] text-[#4C5853]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {profile.values.length > 0 ? (
        <section className="border-y border-[#D7E1CE] bg-[#E7EEE2] py-[clamp(40px,5.5vw,72px)]">
          <div className={`${WRAP} flex flex-wrap items-center gap-[clamp(24px,4vw,56px)]`}>
            <div className="min-w-0 max-w-[380px] flex-[1_1_260px]">
              <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-[#4F5C4B]">{t("vitrine.values.eyebrow")}</p>
              <h2 className={`${SERIF} text-[clamp(26px,3.4vw,38px)] font-medium leading-[1.14] tracking-[-0.022em] text-[#1D3A2E] text-pretty`}>
                {t("vitrine.values.title")}
              </h2>
            </div>
            <ul className="grid min-w-0 flex-[1_1_380px] gap-3 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
              {profile.values.map((value, index) => (
                <li
                  key={value}
                  data-reveal={index}
                  className="rounded-2xl border border-[#D7E1CE] bg-white px-5 py-[18px] text-base font-semibold text-[#1D3A2E] transition duration-300 hover:-translate-y-1 hover:border-[#BFCFB4] hover:shadow-[0_22px_40px_-30px_rgba(29,58,46,0.45)] motion-reduce:hover:translate-y-0"
                >
                  {value}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section id={VITRINE_ANCHORS.services} className={SECTION}>
        <div className={WRAP}>
          <p className={EYEBROW}>{t("vitrine.services.eyebrow")}</p>
          <h2 className={`${H2} mb-3.5 max-w-[22ch]`}>{t("vitrine.services.title")}</h2>
          <p className={`${LEAD} mb-9 max-w-[62ch]`}>{t("vitrine.services.intro")}</p>

          <div className="mb-[22px] grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(268px,1fr))]">
            <article
              data-reveal="0"
              className={`relative flex flex-col rounded-[20px] bg-white p-[26px] transition duration-300 ${
                standard.offered
                  ? "border-[1.5px] border-[#17505F] shadow-[0_24px_46px_-32px_rgba(16,51,61,0.5)] hover:-translate-y-1.5 hover:shadow-[0_38px_60px_-34px_rgba(16,51,61,0.58)] motion-reduce:hover:translate-y-0"
                  : "border border-[#EDE6DA]"
              }`}
            >
              <h3 className="mb-1.5 text-[17px] font-semibold text-[#15404B]">{t("profile.standardTitle")}</h3>
              <p className="mb-[18px] text-[13.5px] text-[#5E6863]">
                {modes ? t("vitrine.services.standardMeta", { minutes: standard.durationMinutes, modes }) : t("profile.duration", { minutes: standard.durationMinutes })}
              </p>
              {!standard.offered ? (
                <p className="text-sm leading-relaxed text-[#4C5853]">{t("profile.notAccepting", { name })}</p>
              ) : (
                <>
                  <p className={`${SERIF} mb-[18px] text-[38px] font-medium leading-none text-[#0F3540]`}>
                    {standardPrice !== null ? money.format(standardPrice) : <span className="text-xl">{t("vitrine.services.priceLater")}</span>}
                  </p>
                  {standard.prices.length > 1 ? (
                    <ul className="mb-[22px] flex flex-col gap-[9px] text-sm text-[#4C5853]">
                      {standard.prices.map((price) => (
                        <li key={price.therapyType} className="flex gap-[9px]">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4E7A52]" aria-hidden="true" />
                          {t("vitrine.services.therapyPrice", { type: t(`therapyTypes.${price.therapyType}`), price: money.format(price.price) })}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="mb-[22px] flex flex-col gap-[9px] text-sm text-[#4C5853]">
                      <li className="flex gap-[9px]">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4E7A52]" aria-hidden="true" />
                        {t("vitrine.trust.receipt")}
                      </li>
                    </ul>
                  )}
                  <a
                    href={bookHref}
                    {...bookFunnel}
                    className="mt-auto rounded-xl bg-[#17505F] px-[18px] py-3.5 text-center text-[15px] font-semibold text-[#F8F5EE] transition hover:-translate-y-0.5 hover:bg-[#0E3A46] hover:text-[#F8F5EE] motion-reduce:hover:translate-y-0"
                  >
                    {showSlots ? t("vitrine.services.seeTimes") : bookLabel}
                  </a>
                </>
              )}
            </article>

            {quick.offered ? (
              <article data-reveal="1" className={`${CARD} flex flex-col p-[26px]`}>
                <h3 className="mb-1.5 text-[17px] font-semibold text-[#15404B]">{t("profile.quickTitle")}</h3>
                <p className="mb-[18px] text-[13.5px] text-[#5E6863]">{t("vitrine.services.quickMeta", { minutes: quick.durationMinutes })}</p>
                <p className={`${SERIF} mb-[18px] text-[38px] font-medium leading-none text-[#0F3540]`}>
                  {quick.price !== null ? money.format(quick.price) : <span className="text-xl">{t("vitrine.services.priceLater")}</span>}
                </p>
                <ul className="mb-[22px] flex flex-col gap-[9px] text-sm text-[#4C5853]">
                  <li className="flex gap-[9px]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4E7A52]" aria-hidden="true" />
                    {t("vitrine.services.quickPoint")}
                  </li>
                </ul>
                <a href={bookHref} {...bookFunnel} className={`${BUTTON_OUTLINE} mt-auto rounded-xl px-[18px] py-[13px] text-[15px] shadow-none`}>
                  {showSlots ? t("vitrine.services.seeQuick") : bookLabel}
                </a>
              </article>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-[18px] border border-[#EDE6DA] bg-white px-6 py-5">
            {profile.insuranceNote.map((paragraph, index) => (
              <p key={index} className="inline-flex flex-[1_1_260px] items-start gap-[9px] whitespace-pre-line text-sm leading-[1.6] text-[#4C5853]">
                <Info className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[#17505F]" aria-hidden="true" />
                {paragraph}
              </p>
            ))}
            <p className="inline-flex flex-[1_1_260px] items-start gap-[9px] text-sm leading-[1.6] text-[#4C5853]">
              <CalendarDays className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[#17505F]" aria-hidden="true" />
              {t("profile.cancellation", { hours: profile.freeCancellationHours })}
            </p>
            <p className="inline-flex flex-[1_1_260px] items-start gap-[9px] text-sm leading-[1.6] text-[#4C5853]">
              <Tag className="mt-0.5 h-[17px] w-[17px] shrink-0 text-[#17505F]" aria-hidden="true" />
              {t("profile.receipt")}
            </p>
          </div>
        </div>
      </section>

      {preview ? null : (
        <section id={VITRINE_ANCHORS.slots} className={`${SECTION} border-y border-[#E2EADC] bg-[#F3F6F0]`}>
          <div className={WRAP}>
            <p className={`${EYEBROW} text-[#4F5C4B]`}>{t("vitrine.dispos.eyebrow")}</p>
            {showSlots ? (
              <>
                <h2 className={`${H2} mb-3.5 max-w-[22ch]`}>{t("vitrine.dispos.title")}</h2>
                <p className="mb-8 max-w-[60ch] text-[clamp(16px,1.7vw,18px)] leading-[1.7] text-[#42504A] text-pretty">
                  {t("vitrine.dispos.intro", { name })}
                </p>
                <VitrineBooking
                  slug={profile.slug}
                  name={name}
                  services={bookable}
                  modes={modes}
                  bookingBaseUrl={bookingUrl}
                  waitlistAnchor={VITRINE_ANCHORS.waitlist}
                  aside={waitlist}
                />
              </>
            ) : (
              <>
                <h2 className={`${H2} mb-3.5 max-w-[22ch]`}>{t("vitrine.dispos.closedTitle")}</h2>
                <p className="mb-8 max-w-[60ch] text-[clamp(16px,1.7vw,18px)] leading-[1.7] text-[#42504A] text-pretty">
                  {t("vitrine.dispos.closedIntro", { name })}
                </p>
                <div className="max-w-[560px]">{waitlist}</div>
              </>
            )}
          </div>
        </section>
      )}

      {products.length > 0 ? (
        <section id={VITRINE_ANCHORS.products} className={SECTION}>
          <div className={WRAP}>
            <p className={EYEBROW}>{t("vitrine.products.eyebrow")}</p>
            <h2 className={`${H2} mb-8 max-w-[24ch]`}>{t("vitrine.products.title")}</h2>
            <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(264px,1fr))]">
              {products.map((product, index) => {
                const Icon = PRODUCT_ICONS[product.type];
                return (
                  <li key={product.slug} data-reveal={index} className={`${CARD} flex flex-col overflow-hidden`}>
                    <div className="relative h-[152px] w-full bg-[linear-gradient(150deg,#E7EEE2,#F3EFE7)]">
                      {product.iconUrl ? (
                        <Image src={product.iconUrl} alt="" fill sizes="(min-width: 1024px) 380px, 90vw" className="object-cover" unoptimized={preview} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[#17505F]/60">
                          <Icon className="h-11 w-11" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-[9px] px-[22px] pb-[22px] pt-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#666E62]">{t(`profile.productType_${product.type}`)}</p>
                      <h3 className="break-words text-[17px] font-semibold leading-[1.35] text-[#15404B]">{product.title}</h3>
                      {product.summary ? <p className="line-clamp-3 text-sm leading-[1.6] text-[#4C5853]">{product.summary}</p> : null}
                      {product.webinarStartsAt ? (
                        <p className="inline-flex items-center gap-[7px] text-[13px] text-[#5E6863]">
                          <CalendarDays className="h-3.5 w-3.5 text-[#17505F]" aria-hidden="true" />
                          {new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(
                            new Date(product.webinarStartsAt),
                          )}
                        </p>
                      ) : null}
                      <div className="mt-auto flex items-center gap-3 pt-2.5">
                        <span className="whitespace-nowrap text-lg font-semibold text-[#15404B]">
                          {product.priceCents > 0 ? money.format(product.priceCents / 100) : t("profile.productFree")}
                        </span>
                        <a
                          href={product.url}
                          className="ml-auto rounded-[11px] border border-[#D7DFD2] bg-white px-5 py-[9px] text-sm font-medium text-[#17505F] transition hover:border-[#17505F] hover:bg-[#17505F] hover:text-[#F8F5EE]"
                        >
                          {t("profile.productOpen")}
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {profile.expertises.length > 0 ? (
        <section className="border-y border-[#EDE6DA] bg-white py-[clamp(40px,5.5vw,72px)]">
          <div className={WRAP}>
            <p className={`${EYEBROW} mb-4`}>{t("vitrine.expertises.eyebrow")}</p>
            <ul className="flex flex-wrap gap-[9px]">
              {profile.expertises.map((expertise) => {
                const chip =
                  "inline-flex rounded-[11px] border border-[#E7DFD1] bg-[#FCFAF6] px-4 py-2.5 text-[14.5px] text-[#2F413D] transition hover:-translate-y-0.5 hover:border-[#17505F] hover:bg-white motion-reduce:hover:translate-y-0";
                return (
                  <li key={expertise.label}>
                    {expertise.slug && !preview ? (
                      <a href={`/specialite/${expertise.slug}`} className={`${chip} hover:text-[#17505F]`}>
                        {expertise.label}
                      </a>
                    ) : (
                      <span className={chip}>{expertise.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      <section id={VITRINE_ANCHORS.faq} className={`${SECTION} ${profile.expertises.length > 0 ? "" : "border-t border-[#EDE6DA]"} bg-white`}>
        <div className={`${WRAP} flex flex-wrap gap-[clamp(24px,4vw,56px)]`}>
          <div className="min-w-0 max-w-[360px] flex-[1_1_260px]">
            <p className={EYEBROW}>{t("vitrine.faq.eyebrow")}</p>
            <h2 className={`${SERIF} mb-3 text-[clamp(26px,3.4vw,38px)] font-medium leading-[1.14] tracking-[-0.022em] text-[#0F3540] text-pretty`}>
              {t("vitrine.faq.title")}
            </h2>
            <p className="mb-4 text-[15px] leading-[1.7] text-[#4C5853]">{t("vitrine.faq.intro")}</p>
            <a href={canonicalSiteUrl("/contact")} className="inline-flex items-center gap-2 whitespace-nowrap text-[14.5px] font-medium text-[#17505F] hover:text-[#0E3A46]">
              {t("vitrine.faq.contact")}
              <ArrowRight className="h-[15px] w-[15px]" aria-hidden="true" />
            </a>
          </div>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
            {faq.map((item, index) => (
              <details key={item.q} open={index === 0} className="group overflow-hidden rounded-2xl border border-[#EDE6DA] bg-[#FCFAF6]">
                <summary className="flex cursor-pointer list-none items-center gap-3.5 px-5 py-[18px] text-[15.5px] font-medium leading-snug text-[#1B3E48] [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">{item.q}</span>
                  <span aria-hidden="true" className="relative h-[18px] w-[18px] shrink-0 text-[#17505F]">
                    <span className="absolute left-1/2 top-1/2 h-[1.7px] w-3.5 -translate-x-1/2 -translate-y-1/2 rounded bg-current" />
                    <span className="absolute left-1/2 top-1/2 h-3.5 w-[1.7px] -translate-x-1/2 -translate-y-1/2 rounded bg-current transition-transform group-open:scale-y-0" />
                  </span>
                </summary>
                <p className="px-5 pb-5 text-[14.5px] leading-[1.7] text-[#4C5853] text-pretty">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="py-[clamp(40px,6vw,80px)]">
        <div className={WRAP}>
          <div className="relative flex flex-wrap items-center gap-[clamp(22px,3vw,44px)] overflow-hidden rounded-[26px] bg-[#12414F] p-[clamp(28px,4.5vw,56px)]">
            <div aria-hidden="true" className="pointer-events-none absolute -right-[90px] -top-[130px] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(169,190,155,0.24),rgba(169,190,155,0)_66%)]" />
            <div className="relative min-w-0 flex-[1_1_320px]">
              <h2 className={`${SERIF} mb-3 max-w-[24ch] text-[clamp(26px,3.6vw,40px)] font-medium leading-[1.12] tracking-[-0.022em] text-[#FCFBF7] text-pretty`}>
                {t("vitrine.cta.title")}
              </h2>
              <p className="max-w-[54ch] text-[clamp(15.5px,1.7vw,18px)] leading-[1.65] text-[#D5E2DC] text-pretty">{t("vitrine.cta.body", { name })}</p>
            </div>
            <div className="relative flex flex-none flex-wrap gap-3">
              <a
                href={bookHref}
                {...bookFunnel}
                className="inline-flex items-center gap-2.5 rounded-[14px] bg-[#F7F4EC] px-[26px] py-4 text-[15.5px] font-semibold text-[#12414F] transition hover:-translate-y-0.5 hover:bg-[#DCE8D6] hover:text-[#0E3A46] motion-reduce:hover:translate-y-0"
              >
                {bookLabel}
                <ArrowRight className="h-[17px] w-[17px]" aria-hidden="true" />
              </a>
              {preview ? null : (
                <a
                  href={`#${VITRINE_ANCHORS.waitlist}`}
                  className="inline-flex items-center gap-2.5 rounded-[14px] border border-white/40 px-6 py-[15px] text-[15.5px] font-semibold text-[#F7F4EC] transition hover:bg-white/10 hover:text-[#F7F4EC]"
                >
                  {t("vitrine.cta.waitlist")}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#D6E2E7] bg-[#E8EFF2]">
        <div className={`${WRAP} flex flex-wrap items-center gap-4 py-[22px]`}>
          <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-white text-[#1E5567]">
            <Info className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-[1_1_320px]">
            <p className="mb-1 text-[15px] font-semibold text-[#1A3F4B]">{t("vitrine.emergencyTitle")}</p>
            <p className="text-[13.5px] leading-[1.6] text-[#33474E] text-pretty">{t("footer.emergency")}</p>
          </div>
        </div>
      </section>

      <footer className="bg-[#FAF7F2] pb-10 pt-[clamp(32px,4vw,56px)]">
        <div className={`${WRAP} flex flex-wrap gap-8`}>
          <div className="min-w-0 flex-[1_1_260px]">
            <p className={`${SERIF} mb-1.5 text-[22px] font-medium text-[#0F3540]`}>{title ? `${name}, ${title.toLocaleLowerCase(localeTag)}` : name}</p>
            <p className="mb-3 max-w-[300px] text-[13.5px] leading-[1.7] text-[#5E6863]">{place}</p>
            {credential ? <p className="max-w-[300px] text-[12.5px] leading-[1.6] text-[#666E62]">{credential}</p> : null}
          </div>
          <nav aria-label={t("vitrine.footer.pageTitle")} className="flex-[0_1_170px]">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#666E62]">{t("vitrine.footer.pageTitle")}</p>
            <ul className="flex flex-col gap-[9px] text-sm">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-[#17505F] hover:text-[#0E3A46]">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex-[0_1_210px]">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#666E62]">{t("vitrine.footer.platformTitle")}</p>
            <ul className="flex flex-col gap-[9px] text-sm">
              <li>
                <a href={cityHref} className="text-[#17505F] hover:text-[#0E3A46]">
                  {t("vitrine.footer.cityPros", { city: profile.city.name })}
                </a>
              </li>
              <li>
                <a href={canonicalSiteUrl(SHOWCASE_HUB_PATH)} className="text-[#17505F] hover:text-[#0E3A46]">
                  {t("vitrine.footer.allPros")}
                </a>
              </li>
              <li>
                <a href={bookingUrl} data-showcase-cta="" className="text-[#17505F] hover:text-[#0E3A46]">
                  {t("vitrine.footer.match")}
                </a>
              </li>
            </ul>
          </div>
          <div className="flex-[0_1_190px]">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#666E62]">{t("vitrine.footer.poweredTitle")}</p>
            <a href={canonicalSiteUrl("/")} className="mb-2.5 inline-flex items-center gap-2 text-[#17505F] hover:text-[#0E3A46]">
              <Leaf className="h-[19px] w-[19px]" aria-hidden="true" />
              <span className={`${SERIF} text-[19px] font-medium`}>{t("brand")}</span>
            </a>
            <p className="text-[12.5px] leading-[1.6] text-[#5E6863]">{t("vitrine.footer.poweredBody")}</p>
          </div>
        </div>
        <div className={`${WRAP} mt-8`}>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[#EDE6DA] pt-5 text-[13px] text-[#666E62]">
            <span>{t("footer.rights", { year: new Date().getFullYear() })}</span>
            <a href={canonicalSiteUrl("/privacy")} className="text-[#666E62] hover:text-[#17505F]">
              {t("footer.privacy")}
            </a>
            <a href={canonicalSiteUrl("/terms")} className="text-[#666E62] hover:text-[#17505F]">
              {t("footer.terms")}
            </a>
          </div>
        </div>
      </footer>

      {preview ? null : (
        <>
          <div aria-hidden="true" className="h-[82px] md:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-3 border-t border-[#EAE2D5] bg-white/95 px-4 pb-[calc(11px+env(safe-area-inset-bottom))] pt-[11px] shadow-[0_-8px_24px_-18px_rgba(16,51,61,0.5)] backdrop-blur-md md:hidden">
            {standard.offered ? (
              <div className="min-w-0">
                {standardPrice !== null ? (
                  <p className="text-[15px] font-semibold leading-tight text-[#15404B]">
                    {t("vitrine.sticky.price", { price: money.format(standardPrice), minutes: standard.durationMinutes })}
                  </p>
                ) : null}
                <p className="truncate text-xs text-[#6A736C]">{t("vitrine.sticky.note")}</p>
              </div>
            ) : null}
            <a
              href={bookHref}
              {...bookFunnel}
              className="ml-auto inline-flex flex-none items-center gap-2 rounded-xl bg-[#17505F] px-5 py-[13px] text-[15px] font-semibold text-[#F8F5EE] hover:bg-[#0E3A46] hover:text-[#F8F5EE]"
            >
              {bookable.length > 0 ? t("vitrine.sticky.cta") : bookLabel}
            </a>
          </div>
          <VitrineMotion rootId={ROOT_ID} />
        </>
      )}
    </article>
  );
}
