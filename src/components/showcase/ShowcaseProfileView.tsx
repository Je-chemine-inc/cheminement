import { Fragment, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Award,
  Brain,
  CalendarDays,
  Check,
  Globe,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Quote,
  ReceiptText,
  ShieldCheck,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { ShowcaseModalityKey, ShowcasePublicProfile } from "@/lib/showcase-public";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import { VITRINE_ANCHORS, formatShowcasePrice, headlinePrice, vitrineSections, type VitrineSection } from "@/lib/showcase-vitrine";
import {
  SHOWCASE_ACCENTS,
  aboutHeadingMessage,
  visibleSections,
  type ShowcaseSectionKey,
  type ShowcaseTextKey,
} from "@/lib/showcase-customization";
import type { ShowcaseProductCard } from "@/lib/products";
import type { ShowcaseArticleCard } from "@/lib/articles";
import { Footer, Header } from "@/components/layout";
import { VitrineSectionDock } from "@/components/showcase/vitrine/VitrineSectionDock";
import { VitrineBooking } from "@/components/showcase/vitrine/VitrineBooking";
import type { ShowcaseBookingOption } from "@/lib/showcase-booking-types";
import { VitrineMotion } from "@/components/showcase/vitrine/VitrineMotion";
import { vitrineSans, vitrineSerif } from "@/components/showcase/vitrine/fonts";

/**
 * A professional's showcase page (spec 003): a wide, airy layout with soft
 * shapes — rounded images and cards, pill buttons and tags — a large portrait,
 * a rounded serif (Fraunces, SOFT axis) over Plus Jakarta Sans, and large
 * images: the professional's office photos when they add some, else Je
 * chemine's ambience photos (`lib/showcase-imagery.ts`). Built from the public
 * data object only; a section with nothing to show is left out. Rendered on
 * the city host, and in the professional's and the admin's preview (`preview`:
 * a banner, the photo loaded without Next's optimizer, which cannot see an
 * unpublished photo, no free times, no waitlist, nothing sticky).
 *
 * Everything a professional wrote goes through React, never as HTML.
 */

const MODALITY_ICONS: Record<ShowcaseModalityKey, LucideIcon> = {
  inPerson: MapPin,
  video: Video,
  phone: Phone,
  chat: MessageSquare,
};

/**
 * The ways of consulting « En bref » names. Booking is centralised — a visitor asks Je chemine for a
 * rendez-vous, and the channel is agreed in the funnel — so the page says where the professional
 * receives and whether they receive remotely, rather than listing every channel their account
 * declares. The account keeps them all: matching and the waitlist still read them.
 */
const BRIEF_MODALITIES: readonly ShowcaseModalityKey[] = ["inPerson", "video"];

const ROOT_ID = "vitrine";
const SERIF = "font-[family-name:var(--font-vitrine-serif)]";
// One centred column: content up to 1680 px, with type that grows with the viewport.
const WRAP = "mx-auto w-full max-w-[1680px] px-[clamp(20px,3vw,64px)]";
/** A section's heading block: centred, with its paragraphs kept to a readable width underneath. */
const HEAD = "mx-auto max-w-[92ch] text-center";
// scroll-mt clears the floating header when a nav link scrolls to a section.
const SECTION = "scroll-mt-28 py-[clamp(44px,3.6vw,76px)]";
const LABEL = "inline-flex items-center rounded-full bg-[color:var(--vt-accent-soft,#E6EFEA)] px-4 py-1.5 text-[clamp(13px,calc(0.25vw+9.5px),16px)] font-semibold text-[color:var(--vt-accent,#17505F)]";
/** A heading on the deep « En bref » block: spaced capitals, the quietest thing on it. */
const LABEL_ON_DARK = "text-center text-[clamp(10.5px,0.72vw,13px)] font-semibold uppercase tracking-[0.34em] text-white/55";
const H2 = `${SERIF} text-[clamp(26px,1.9vw,42px)] font-normal leading-[1.12] tracking-[-0.01em] text-[#1F2A2E] text-pretty`;
const BODY = "text-[clamp(15.5px,calc(0.2vw+12.5px),18px)] leading-[1.7] text-[#3E494B] text-pretty";
const SOFT_SHADOW = "shadow-[0_30px_70px_-50px_rgba(31,42,46,0.45)]";
// The hero's button: larger than the shared one because it stands alone on a whole screen, and in
// the platform's own primary colour so it reads as the same button as « Commencer » in the nav bar.
const BUTTON_HERO =
  "inline-flex items-center justify-center gap-3 rounded-full bg-primary px-[clamp(26px,2.5vw,40px)] py-[clamp(14px,1.05vw,20px)] text-[clamp(14px,0.9vw,17px)] font-semibold text-primary-foreground shadow-[0_18px_34px_-18px_rgba(31,42,46,0.6)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/90 hover:text-primary-foreground motion-reduce:hover:translate-y-0";
const BUTTON_OUTLINE =
  "inline-flex items-center justify-center gap-2.5 rounded-full border border-[#D9D4CA] bg-white px-[clamp(22px,2.2vw,30px)] py-4 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)] transition-all duration-300 hover:border-[color:var(--vt-accent,#17505F)] hover:bg-[#F3F7F5] hover:text-[color:var(--vt-accent,#17505F)]";

/** The rounded serif, the hero's entrance, and the reduced-motion guard. */
const PAGE_CSS = `
html:has(#${ROOT_ID}){scroll-behavior:smooth}
@media (prefers-reduced-motion: reduce){html:has(#${ROOT_ID}){scroll-behavior:auto}}
#${ROOT_ID}{word-spacing:.06em}
#${ROOT_ID} .vt-xs{font-size:clamp(12px,calc(.15vw + 9.5px),14.5px)}
#${ROOT_ID} .vt-sm{font-size:clamp(13.5px,calc(.14vw + 11.5px),15.5px)}
#${ROOT_ID} .vt-md{font-size:clamp(14.5px,calc(.16vw + 12px),16.5px)}
#${ROOT_ID} .vt-lg{font-size:clamp(16px,calc(.2vw + 12.5px),18.5px)}
#${ROOT_ID} [class*="font-vitrine-serif"]{font-variation-settings:"SOFT" 100,"WONK" 0;word-spacing:normal}
@keyframes vitrineUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes vtHeroWord{from{opacity:0;transform:translate3d(0,.42em,0)}to{opacity:1;transform:none}}
@keyframes vtHeroLine{from{opacity:0;transform:translate3d(0,14px,0)}to{opacity:1;transform:none}}
@keyframes vtHeroPortrait{from{opacity:0;transform:translate3d(0,44px,0) scale(1.05)}to{opacity:1;transform:none}}
@keyframes vtHeroBand{from{opacity:0}to{opacity:1}}
/* A long, almost flat curve: it settles rather than springs. */
#${ROOT_ID} .vt-word{display:inline-block;will-change:transform,opacity;animation:vtHeroWord 1.15s cubic-bezier(.16,.84,.3,1) both}
#${ROOT_ID} .vt-line{animation:vtHeroLine 1s cubic-bezier(.16,.84,.3,1) both}
#${ROOT_ID} .vt-portrait{will-change:transform,opacity;animation:vtHeroPortrait 1.6s cubic-bezier(.2,.8,.24,1) .1s both}
#${ROOT_ID} .vt-band{animation:vtHeroBand 1.2s ease-out both}
@keyframes vtBriefIn{from{opacity:0;transform:translate3d(0,16px,0)}to{opacity:1;transform:none}}
@keyframes vtBriefRule{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes vtSheen{0%{opacity:0;transform:translateX(-160%) skewX(-14deg)}22%{opacity:1}100%{opacity:0;transform:translateX(460%) skewX(-14deg)}}
/* « En bref » on arrival (.vt-seen, never without JavaScript): facts rise in turn, rules draw from the left, a light crosses. */
#${ROOT_ID} [data-brief].vt-seen [data-brief-item]{animation:vtBriefIn .95s cubic-bezier(.16,.84,.3,1) both;animation-delay:calc(var(--vt-i,0) * 110ms)}
#${ROOT_ID} [data-brief].vt-seen .vt-brief-rule{animation:vtBriefRule 1.15s cubic-bezier(.22,.8,.26,1) both;animation-delay:calc(var(--vt-i,0) * 110ms + 130ms)}
#${ROOT_ID} [data-brief].vt-seen .vt-sheen{animation:vtSheen 2.2s cubic-bezier(.3,.7,.35,1) .2s both}
#${ROOT_ID} [data-brief-item] .vt-brief-icon{transition:transform .6s cubic-bezier(.2,.8,.24,1),border-color .6s ease}
#${ROOT_ID} [data-brief-item]:hover .vt-brief-icon{transform:scale(1.07);border-color:rgba(255,255,255,.55)}
@keyframes vtStepNum{from{opacity:0;transform:translate3d(-7px,0,0)}to{opacity:1;transform:none}}
@keyframes vtStepLate{from{opacity:0;transform:translate3d(0,9px,0)}to{opacity:1;transform:none}}
@keyframes vtHeadIn{from{opacity:0;transform:translate3d(0,15px,0)}to{opacity:1;transform:none}}
@keyframes vtBarIn{from{opacity:0;transform:translate3d(0,140%,0)}to{opacity:1;transform:none}}
/* « Parcours » on arrival: a line rises, its rule draws from the left, its numeral follows. */
#${ROOT_ID} [data-steps].vt-seen [data-step]{animation:vtBriefIn .85s cubic-bezier(.16,.84,.3,1) both;animation-delay:calc(var(--vt-i,0) * 95ms)}
#${ROOT_ID} [data-steps].vt-seen .vt-step-rule{animation:vtBriefRule 1.05s cubic-bezier(.22,.8,.26,1) both;animation-delay:calc(var(--vt-i,0) * 95ms + 110ms)}
#${ROOT_ID} [data-steps].vt-seen .vt-step-num{animation:vtStepNum .8s cubic-bezier(.16,.84,.3,1) both;animation-delay:calc(var(--vt-i,0) * 95ms + 190ms)}
#${ROOT_ID} [data-steps].vt-seen .vt-step-late{animation:vtStepLate .8s cubic-bezier(.16,.84,.3,1) both;animation-delay:calc(var(--vt-i,0) * 95ms + 200ms)}
/* A heading arrives in reading order — its label, its title, then what follows it; a run of
   paragraphs arrives one after another. Both wait for .vt-seen, so neither exists without it. */
#${ROOT_ID} [data-head].vt-seen > *,#${ROOT_ID} [data-paras].vt-seen > *{animation:vtHeadIn .85s cubic-bezier(.16,.84,.3,1) both}
#${ROOT_ID} [data-head].vt-seen > :nth-child(2),#${ROOT_ID} [data-paras].vt-seen > :nth-child(2){animation-delay:95ms}
#${ROOT_ID} [data-head].vt-seen > :nth-child(3),#${ROOT_ID} [data-paras].vt-seen > :nth-child(3){animation-delay:190ms}
#${ROOT_ID} [data-head].vt-seen > :nth-child(n+4),#${ROOT_ID} [data-paras].vt-seen > :nth-child(n+4){animation-delay:270ms}
#${ROOT_ID} details .vt-theme-mark{transition:transform .5s cubic-bezier(.2,.8,.24,1)}
#${ROOT_ID} details[open] .vt-theme-mark{transform:rotate(45deg)}
#${ROOT_ID} details[open] .vt-theme-body{animation:vtStepLate .55s cubic-bezier(.16,.84,.3,1) both}
#${ROOT_ID} [data-step] .vt-step-num{transition:color .45s ease}
#${ROOT_ID} [data-step]:hover .vt-step-num{color:var(--vt-accent,#17505F)}
@keyframes vitrineIn{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
/* The phone's bar rises once the hero has had its moment, like the dock on a wider screen. */
#${ROOT_ID} .vt-bar{animation:vtBarIn .8s cubic-bezier(.16,.84,.3,1) .9s both}
.vitrine-up{animation:vitrineUp .8s cubic-bezier(.22,.8,.26,1) both}
.vitrine-in{animation:vitrineIn 1s cubic-bezier(.22,.8,.26,1) .05s both}
@media (prefers-reduced-motion: reduce){.vitrine-up,.vitrine-in,#${ROOT_ID} .vt-word,#${ROOT_ID} .vt-line,#${ROOT_ID} .vt-portrait,#${ROOT_ID} .vt-band,#${ROOT_ID} .vt-bar,#${ROOT_ID} [data-brief-item],#${ROOT_ID} .vt-brief-rule,#${ROOT_ID} .vt-sheen,#${ROOT_ID} [data-step],#${ROOT_ID} .vt-step-rule,#${ROOT_ID} .vt-step-num,#${ROOT_ID} .vt-step-late,#${ROOT_ID} .vt-theme-body,#${ROOT_ID} [data-head] > *,#${ROOT_ID} [data-paras] > *{animation:none}#${ROOT_ID} details .vt-theme-mark{transition:none}#${ROOT_ID} [data-brief-item] .vt-brief-icon,#${ROOT_ID} [data-step] .vt-step-num{transition:none}}
`;

/** Where "request an appointment" leads: the booking funnel on www. */
export function showcaseBookingUrl(profile: Pick<ShowcasePublicProfile, "slug" | "city">): string {
  const query = new URLSearchParams({ from: "showcase", pro: profile.slug, city: profile.city.key });
  return canonicalSiteUrl(`/appointment?${query.toString()}`);
}

export async function ShowcaseProfileView({
  profile,
  preview = false,
  products = [],
  articles = [],
  bookingOptions = [],
}: {
  profile: ShowcasePublicProfile;
  preview?: boolean;
  /**
   * The consultations the page can offer a time for (spec 003 phase 3b). Empty — the usual case —
   * means no « Disponibilités » at all: the page's button goes to the general list.
   */
  bookingOptions?: ShowcaseBookingOption[];
  /** The professional's live trainings and products (spec 003 phase 5), sold on www. */
  products?: ShowcaseProductCard[];
  /** The professional's live articles, read at /nouveautes/<slug>. */
  articles?: ShowcaseArticleCard[];
}) {
  const t = await getTranslations("Showcase");
  const localeTag = (await getLocale()) === "en" ? "en-CA" : "fr-CA";
  const money = { format: (amount: number) => formatShowcasePrice(amount, localeTag) };

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
  const { standard } = profile.services;
  const bookingUrl = showcaseBookingUrl(profile);
  // Every booking button opens Je chemine's own request, which reaches the general list where a
  // professional is chosen. The funnel only treats a request as aimed at one professional when the
  // link carries a service, a day and a time as well (readShowcaseDirectIntent); this one carries
  // none of them, so the wording is the same whoever the page belongs to.
  const bookLabel = t("profile.bookCta");
  const bookHref = bookingUrl;
  const bookFunnel = { "data-showcase-cta": "" };
  // The professional's own choices (texts, sections, colour, photos); each falls back to the page's default.
  const custom = profile.customization;
  const text = (key: ShowcaseTextKey, fallback: string) => custom.texts[key] || fallback;
  const palette = SHOWCASE_ACCENTS[custom.accent];
  const accentStyle = { "--vt-accent": palette.accent, "--vt-accent-dark": palette.dark, "--vt-accent-soft": palette.soft } as CSSProperties;
  // The page shows no stock photography: a professional own office photo, or no image at all.
  const officePhoto = profile.officePhotoUrls[0] ?? null;
  const officeAlt = t("vitrine.about.officePhotoAlt", { name });

  // The introduction opens the page beside the portrait; the longer biography is « À propos ».
  const about = profile.bio;
  const hasAbout =
    about.length > 0 ||
    Boolean(profile.headline) ||
    profile.intro.length > 0 ||
    Boolean(profile.quote) ||
    profile.credentials.length > 0;
  const hasApproachText = profile.approach.length > 0 || profile.methods.length > 0;
  // The name arrives word by word; whatever follows waits for the last one.
  const nameWords = name.split(/\s+/).filter(Boolean);
  const afterName = 0.18 + Math.max(0, nameWords.length - 1) * 0.11 + 0.26;

  const shownSections = visibleSections(custom.sectionOrder, custom.hiddenSections, {
    about: hasAbout,
    approach: hasApproachText,
    expertises: profile.expertises.length > 0 || profile.focusAreas.length > 0,
    products: products.length > 0,
    articles: articles.length > 0,
  });
  const languages = profile.languages.map((language) => t(`languages.${language}`)).join(", ");
  const standardPrice = headlinePrice(standard.prices);
  const years = profile.yearsOfExperience;
  const aboutDefault = aboutHeadingMessage({ title, years, name });
  const aboutHeading = t(aboutDefault.key, aboutDefault.values);

  // What the professional wrote about insurance receipts, on one line.
  const insuranceNote = profile.insuranceNote.join(" ").trim();

  // « En bref », under the presentation: the order and permit already sit under the name.
  const briefFacts: { icon: LucideIcon; text: string }[] = [
    ...profile.highlights.map((text) => ({ icon: Check, text })),
    ...(insuranceNote ? [{ icon: ReceiptText, text: insuranceNote }] : []),
    ...(years !== null ? [{ icon: Award, text: t("profile.experience", { years }) }] : []),
    ...(languages ? [{ icon: Globe, text: languages }] : []),
    ...profile.modalities
      .filter((modality) => BRIEF_MODALITIES.includes(modality))
      .map((modality) => ({
        icon: MODALITY_ICONS[modality],
        text: modality === "inPerson" ? t("vitrine.chips.inPerson", { city: officeCity }) : t(`vitrine.chips.${modality}`),
      })),
  ];

  // « Disponibilités »: only on real hours with a free time ahead, and never in a preview, which has no times.
  const hasAvailability = !preview && bookingOptions.length > 0;
  const shownModes = profile.modalities.filter((modality) => BRIEF_MODALITIES.includes(modality));
  const modesPhrase =
    shownModes.includes("inPerson") && shownModes.includes("video")
      ? t("vitrine.placeBoth", { city: officeCity })
      : shownModes.includes("video")
        ? t("vitrine.placeVideo")
        : shownModes.includes("inPerson")
          ? t("vitrine.chips.inPerson", { city: officeCity })
          : "";

  const sections = vitrineSections({
    hasAbout,
    hasBrief: briefFacts.length > 0,
    hasCredentials: profile.credentials.length > 0,
    hasFocusAreas: profile.focusAreas.length > 0,
    hasProducts: products.length > 0,
    hasArticles: articles.length > 0,
    hasAvailability,
    order: shownSections,
  });
  const navLinks = sections.map((section: VitrineSection) => ({
    href: `#${VITRINE_ANCHORS[section]}`,
    label: t(`vitrine.nav.${section}`),
  }));

  // « Disponibilités » (spec 003 phase 3b): not a section a professional orders or hides — it exists
  // only while they publish real hours, and it follows « À propos ». Picking a time is a request to
  // them directly, made in the booking funnel, which holds the time until they answer.
  const availabilityBlock = hasAvailability ? (
    <section id={VITRINE_ANCHORS.availability} className={SECTION} data-availability="">
      <div className={WRAP}>
        <div className={HEAD} data-head="" data-appear="">
          <p className={LABEL}>{t("vitrine.availability.eyebrow")}</p>
          <h2 className={`${H2} mt-5`}>{t("vitrine.availability.title", { name })}</h2>
          <p className={`${BODY} mx-auto mt-5 max-w-[72ch]`}>{t("vitrine.availability.intro", { name })}</p>
        </div>
        <div className="mx-auto mt-[clamp(28px,3vw,48px)] max-w-[1320px] text-left" data-reveal="0">
          <VitrineBooking
            slug={profile.slug}
            name={name}
            options={bookingOptions}
            modes={modesPhrase}
            bookingBaseUrl={bookingUrl}
          />
        </div>
      </div>
    </section>
  ) : null;

  // Each section below the introduction on its own, so a professional can reorder or hide it (visibleSections).
  const sectionBlocks: Record<ShowcaseSectionKey, ReactNode> = {
    about: (
      <>
      {/* À propos */}
      {hasAbout ? (
        <section id={VITRINE_ANCHORS.about} className={SECTION}>
          <div className={`${WRAP} grid items-start gap-x-[clamp(40px,6vw,120px)] gap-y-12 ${officePhoto ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] text-left" : "text-center"}`}>
            <div className="min-w-0" data-reveal="0">
              <p className={LABEL}>{t("vitrine.about.eyebrow")}</p>
              <h2 className={`${H2} mt-5`}>{text("aboutTitle", aboutHeading)}</h2>
              {credential ? (
                <p className="mt-4 inline-flex items-center gap-2 vt-sm text-[#5B6566]">
                  <ShieldCheck className="h-4 w-4 text-[color:var(--vt-accent,#17505F)]" aria-hidden="true" />
                  {credential}
                </p>
              ) : null}
              {profile.headline ? (
                <p className={`mx-auto mt-7 max-w-[44ch] ${SERIF} text-[clamp(21px,1.4vw,30px)] leading-[1.35] text-[#1F2A2E] text-pretty`}>
                  {profile.headline}
                </p>
              ) : null}
              <div className="mx-auto mt-8 max-w-[100ch] space-y-5 text-left" data-paras="" data-appear="">
                {[...profile.intro, ...about].map((paragraph, index) => (
                  <p key={index} className={`${BODY} whitespace-pre-line`}>
                    {paragraph}
                  </p>
                ))}
              </div>
              {briefFacts.length > 0 ? (
                <div
                  id={VITRINE_ANCHORS.brief}
                  className="mx-auto mt-[clamp(40px,4vw,72px)] max-w-[100ch] scroll-mt-28"
                  data-brief=""
                  data-reveal="0"
                >
                  <div className="relative overflow-hidden rounded-[clamp(26px,3vw,46px)] bg-[color:var(--vt-accent-dark,#0E3A46)] px-[clamp(24px,3.4vw,72px)] py-[clamp(32px,3.2vw,58px)] shadow-[0_54px_104px_-66px_rgba(31,42,46,0.9)] ring-1 ring-inset ring-white/10">
                    {/* Depth without a second colour: a light from the top left, the corner falling away */}
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_95%_at_8%_-12%,rgba(255,255,255,0.17),transparent_58%)]" />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(200deg,transparent_42%,rgba(0,0,0,0.3)_100%)]" />
                    {/* A light crosses the block once, as it arrives */}
                    <span aria-hidden="true" className="vt-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/14 to-transparent opacity-0" />
                    <p className={`relative ${LABEL_ON_DARK}`}>{t("vitrine.about.factsTitle")}</p>
                    {/* Lines, not boxes: one fact a line, in two columns from sm up. */}
                    <ul className="relative mt-[clamp(22px,2.4vw,42px)] grid gap-x-[clamp(32px,4vw,80px)] border-t border-white/12 text-left sm:grid-cols-2">
                      {briefFacts.map((fact, index) => (
                        <li
                          key={index}
                          data-brief-item=""
                          style={{ "--vt-i": index } as CSSProperties}
                          // An odd last fact takes the whole width, so no rule stops halfway across the block.
                          // Mind the space before the interpolation: Tailwind scans this file as text, and a `${` glued
                          // to the last utility swallows it.
                          className={`relative flex items-center gap-[clamp(14px,1.5vw,26px)] py-[clamp(16px,1.7vw,28px)] ${index === briefFacts.length - 1 && briefFacts.length % 2 === 1 ? "sm:col-span-2" : ""}`}
                        >
                          <span className="vt-brief-icon grid h-[clamp(38px,2.7vw,52px)] w-[clamp(38px,2.7vw,52px)] shrink-0 place-items-center rounded-full border border-white/25 text-white/85 transition-colors duration-500">
                            <fact.icon strokeWidth={1.25} className="h-[clamp(16px,1.15vw,21px)] w-[clamp(16px,1.15vw,21px)]" aria-hidden="true" />
                          </span>
                          <span className={`${SERIF} text-[clamp(17px,1.3vw,25px)] leading-[1.3] text-[#F6F3EE] text-pretty`}>{fact.text}</span>
                          {/* The rule under a fact draws itself from the left */}
                          <span aria-hidden="true" className="vt-brief-rule absolute inset-x-0 bottom-0 h-px origin-left bg-white/15" />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {profile.quote ? (
                <figure className="relative mx-auto mt-10 max-w-[100ch] rounded-[32px] bg-[color:var(--vt-accent-soft,#E6EFEA)] px-[clamp(24px,3vw,44px)] py-[clamp(24px,2.6vw,36px)] text-left">
                  <Quote className="absolute left-[clamp(20px,2.4vw,34px)] top-[clamp(22px,2.4vw,34px)] h-7 w-7 text-[color:var(--vt-accent,#17505F)]/30" aria-hidden="true" />
                  <blockquote className={`pl-11 ${SERIF} text-[clamp(20px,1.4vw,27px)] italic leading-[1.35] text-[#1F2A2E] text-pretty`}>
                    {profile.quote}
                  </blockquote>
                  <figcaption className="mt-3 pl-11 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)]">{t("vitrine.about.quoteBy", { name })}</figcaption>
                </figure>
              ) : null}
              {profile.credentials.length > 0 ? (
                <div
                  id={VITRINE_ANCHORS.credentials}
                  className="mx-auto mt-[clamp(40px,4vw,72px)] max-w-[100ch] scroll-mt-28"
                  data-steps=""
                  data-reveal="0"
                >
                  <p className={LABEL}>{t("vitrine.about.credentialsTitle")}</p>
                  <ul className="mt-[clamp(20px,2vw,32px)] border-t border-[#E2DCD1] text-left">
                    {profile.credentials.map((line, index) => (
                      <li
                        key={index}
                        data-step=""
                        style={{ "--vt-i": index } as CSSProperties}
                        className="relative flex items-baseline gap-[clamp(16px,1.6vw,28px)] py-[clamp(12px,1.1vw,18px)]"
                      >
                        <span className="vt-step-num vt-xs tabular-nums text-[#1F2A2E]/30">{String(index + 1).padStart(2, "0")}</span>
                        <span className={`${SERIF} text-[clamp(16px,1.05vw,21px)] leading-[1.4] text-[#1F2A2E]`}>{line}</span>
                        {/* The rule under a line draws itself: a border cannot be drawn, a span can */}
                        <span aria-hidden="true" className="vt-step-rule absolute inset-x-0 bottom-0 h-px origin-left bg-[#E2DCD1]" />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            {officePhoto ? (
              <div className="relative min-w-0 lg:sticky lg:top-28" data-reveal="1">
                <div className={`relative aspect-[4/5] w-full overflow-hidden rounded-[40px] bg-[#F6F3EE] ${SOFT_SHADOW}`}>
                  <Image src={officePhoto} alt={officeAlt} fill sizes="(min-width: 1024px) 36vw, 100vw" className="object-cover" unoptimized={preview} />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      </>
    ),
    approach: (
      <>
      {/* Approche */}
      <section id={VITRINE_ANCHORS.approach} className={SECTION}>
        <div className={WRAP}>
          {/* The approach text reads right under the title */}
          <div className={HEAD} data-approach-head="" data-head="" data-appear="">
            <p className={`${LABEL}`}>{t("vitrine.approach.eyebrow")}</p>
            <h2 className={`${H2} mt-5`}>{text("approachTitle", t("vitrine.approach.title"))}</h2>
            {profile.approach.length > 0 ? (
              <div className="mt-5 space-y-5 text-left" data-paras="" data-appear="">
                {profile.approach.map((paragraph, index) => (
                  <p key={index} className={`${BODY} whitespace-pre-line`}>
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : null}
          </div>

          {/* Methods: horizontal cards; a single method spans the whole row */}
          {profile.methods.length > 0 ? (
            <>
              <h3 className={`${SERIF} mt-[clamp(56px,6vw,104px)] text-center text-[clamp(24px,1.8vw,36px)] leading-tight text-[#1F2A2E]`}>
                {text("methodsTitle", t("vitrine.approach.methodsTitle"))}
              </h3>
              <ul
                className={`mt-[clamp(24px,2.4vw,40px)] grid gap-[clamp(14px,1.4vw,24px)] ${
                  profile.methods.length === 1 ? "" : profile.methods.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-2 2xl:grid-cols-3"
                }`}
                data-methods=""
              >
                {profile.methods.map((method, index) => (
                  <li
                    key={index}
                    data-reveal={index}
                    className="flex min-w-0 flex-col gap-6 rounded-[36px] bg-white p-[clamp(24px,2.6vw,48px)] shadow-[0_24px_60px_-50px_rgba(31,42,46,0.45)] sm:flex-row sm:items-start sm:gap-[clamp(24px,2.4vw,44px)]"
                  >
                    <span className="flex h-[clamp(56px,4vw,76px)] w-[clamp(56px,4vw,76px)] shrink-0 items-center justify-center rounded-2xl bg-[color:var(--vt-accent-soft,#E6EFEA)] text-[color:var(--vt-accent,#17505F)]">
                      <Brain className="h-[45%] w-[45%]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <span className="inline-flex rounded-full bg-[#F6F3EE] px-4 py-1.5 vt-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--vt-accent,#17505F)]">
                        {method.name}
                      </span>
                      {method.title ? (
                        <p className={`mt-4 ${SERIF} text-[clamp(21px,1.5vw,30px)] leading-[1.15] text-[#1F2A2E] text-balance`}>{method.title}</p>
                      ) : null}
                      {method.body.map((paragraph, paragraphIndex) => (
                        <p key={paragraphIndex} className="mt-3 max-w-[72ch] vt-md leading-[1.75] text-[#5B6566] text-pretty">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {/* How a request unfolds: four connected steps, an arrow between cards on wide screens */}
        </div>
      </section>
      </>
    ),
    expertises: (
      <>
      {/* Ce que j'accompagne: the professional's own cards */}
      {profile.focusAreas.length > 0 ? (
        <section id={VITRINE_ANCHORS.focus} className={SECTION}>
          <div className={WRAP}>
            {/* The intro reads as the title's subtitle, right under it */}
            <div className={HEAD} data-expertises-head="" data-head="" data-appear="">
              <p className={LABEL}>{t("vitrine.focus.eyebrow")}</p>
              <h2 className={`${H2} mt-5`}>{text("expertisesTitle", t("vitrine.expertisesTitle"))}</h2>
              <p className={`${BODY} mx-auto mt-5 max-w-[84ch]`}>{text("expertisesIntro", t("vitrine.expertisesIntro", { name }))}</p>
            </div>
            {/* Lines, not cards: the area's name, then what it covers, a hairline between each. */}
            <ul
              className="mx-auto mt-[clamp(28px,3vw,48px)] max-w-[100ch] border-t border-[#E2DCD1] text-left"
              data-steps=""
              data-reveal="0"
            >
              {profile.focusAreas.map((area, index) => (
                <li
                  key={index}
                  data-step=""
                  data-focus-area=""
                  style={{ "--vt-i": index } as CSSProperties}
                  className="relative grid gap-x-[clamp(24px,3vw,56px)] gap-y-2 py-[clamp(18px,1.8vw,28px)] md:grid-cols-[minmax(0,11fr)_minmax(0,17fr)]"
                >
                  <h3 className={`${SERIF} text-[clamp(19px,1.3vw,26px)] leading-[1.2] text-[#1F2A2E] text-balance`}>
                    {area.title}
                  </h3>
                  {/* The description follows its title a beat behind */}
                  <div className="vt-step-late min-w-0">
                    {area.body.map((paragraph, paragraphIndex) => (
                      <p key={paragraphIndex} className="vt-md leading-[1.7] text-[#3E494B] text-pretty">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <span aria-hidden="true" className="vt-step-rule absolute inset-x-0 bottom-0 h-px origin-left bg-[#E2DCD1]" />
                </li>
              ))}
            </ul>
            {/* The catalogue themes close the section: one a line, opened to read what it covers.
                A theme nobody has written about is a line, not an empty thing to open. */}
            {profile.expertises.length > 0 ? (
              <div
                className="mx-auto mt-[clamp(36px,4vw,64px)] max-w-[100ch]"
                data-expertise-themes=""
                data-steps=""
                data-reveal="0"
              >
                <p className={LABEL}>{t("vitrine.themes.title")}</p>
                <ul className="mt-[clamp(18px,2vw,32px)] border-t border-[#E2DCD1] text-left">
                  {profile.expertises.map((expertise, index) => (
                    <li
                      key={expertise.label}
                      data-step=""
                      style={{ "--vt-i": index } as CSSProperties}
                      className="relative"
                    >
                      {expertise.description ? (
                        <details>
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-[clamp(16px,2vw,40px)] py-[clamp(14px,1.4vw,22px)] [&::-webkit-details-marker]:hidden">
                            <span className={`${SERIF} text-[clamp(17px,1.15vw,23px)] leading-[1.3] text-[#1F2A2E]`}>
                              {expertise.label}
                            </span>
                            {/* A plus that turns into a cross when the line is open */}
                            <Plus
                              aria-hidden="true"
                              strokeWidth={1.5}
                              className="vt-theme-mark h-[clamp(18px,1.3vw,24px)] w-[clamp(18px,1.3vw,24px)] shrink-0 text-[color:var(--vt-accent,#17505F)]"
                            />
                          </summary>
                          <p className={`vt-theme-body ${BODY} max-w-[82ch] pb-[clamp(16px,1.6vw,26px)]`}>
                            {expertise.description}
                          </p>
                        </details>
                      ) : (
                        <div className="py-[clamp(14px,1.4vw,22px)]">
                          <span className={`${SERIF} text-[clamp(17px,1.15vw,23px)] leading-[1.3] text-[#1F2A2E]`}>
                            {expertise.label}
                          </span>
                        </div>
                      )}
                      <span aria-hidden="true" className="vt-step-rule absolute inset-x-0 bottom-0 h-px origin-left bg-[#E2DCD1]" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      </>
    ),
    products: (
      <>
      {/* Formations */}
      {products.length > 0 ? (
        <section id={VITRINE_ANCHORS.products} className={SECTION}>
          <div className={WRAP}>
            <div className={HEAD} data-head="" data-appear="">
              <p className={LABEL}>{t("vitrine.products.eyebrow")}</p>
              <h2 className={`${H2} mt-5`}>{text("productsTitle", t("vitrine.products.title"))}</h2>
            </div>
            <ul
              className={`mt-[clamp(40px,4.5vw,64px)] grid gap-[clamp(20px,2.2vw,32px)] md:grid-cols-2 ${products.length >= 3 ? "xl:grid-cols-3" : ""}`}
            >
              {products.map((product, index) => (
                <li
                  key={product.slug}
                  data-reveal={index}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-[36px] bg-white p-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_34px_70px_-50px_rgba(31,42,46,0.55)] motion-reduce:hover:translate-y-0"
                >
                  {product.iconUrl ? (
                    <a href={product.url} className="relative block aspect-[16/10] w-full overflow-hidden rounded-[28px] bg-[#F6F3EE]">
                      <Image
                        src={product.iconUrl}
                        alt=""
                        fill
                        sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
                        className="object-cover transition-transform duration-700 group-hover:scale-[1.04] motion-reduce:transition-none"
                        unoptimized={preview}
                      />
                      <span className="absolute left-4 top-4 rounded-full bg-white/90 px-4 py-1.5 vt-xs font-semibold text-[color:var(--vt-accent,#17505F)] backdrop-blur-md">
                        {t(`profile.productType_${product.type}`)}
                      </span>
                    </a>
                  ) : null}
                  <div className="flex flex-1 flex-col px-[clamp(10px,1.2vw,18px)] pb-3 pt-6">
                    {/* Without an image the type has nowhere to sit, so it opens the card instead. */}
                    {product.iconUrl ? null : (
                      <span className="mb-4 inline-flex w-fit rounded-full bg-[#F6F3EE] px-4 py-1.5 vt-xs font-semibold text-[color:var(--vt-accent,#17505F)]">
                        {t(`profile.productType_${product.type}`)}
                      </span>
                    )}
                    <h3 className={`${SERIF} break-words text-[clamp(21px,1.5vw,26px)] leading-tight text-[#1F2A2E]`}>
                      <a href={product.url} className="hover:text-[color:var(--vt-accent,#17505F)]">
                        {product.title}
                      </a>
                    </h3>
                    {product.summary ? <p className="mt-3 line-clamp-3 vt-md leading-[1.7] text-[#5B6566]">{product.summary}</p> : null}
                    {product.webinarStartsAt ? (
                      <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-[#F6F3EE] px-4 py-2 vt-sm text-[#3E494B]">
                        <CalendarDays className="h-4 w-4 text-[color:var(--vt-accent,#17505F)]" aria-hidden="true" />
                        {new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(
                          new Date(product.webinarStartsAt),
                        )}
                      </p>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between gap-4 pt-6">
                      <span className={`${SERIF} text-[30px] text-[#1F2A2E]`}>
                        {product.priceCents > 0 ? money.format(product.priceCents / 100) : t("profile.productFree")}
                      </span>
                      <a href={product.url} className={`group ${BUTTON_OUTLINE} py-3`}>
                        {t("profile.productOpen")}
                        <ArrowRight
                          className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none"
                          aria-hidden="true"
                        />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
      </>
    ),
    articles: (
      <>
      {/* Articles, reviewed by the team and read on www */}
      {articles.length > 0 ? (
        <section id={VITRINE_ANCHORS.articles} className={SECTION} data-articles="">
          <div className={WRAP}>
            <div className={HEAD} data-head="" data-appear="">
              <p className={LABEL}>{t("vitrine.articles.eyebrow")}</p>
              <h2 className={`${H2} mt-5`}>{text("articlesTitle", t("vitrine.articles.title"))}</h2>
            </div>
            <ul className={`mt-[clamp(40px,4.5vw,64px)] grid gap-[clamp(20px,2.2vw,32px)] md:grid-cols-2 ${articles.length >= 3 ? "xl:grid-cols-3" : ""}`}>
              {articles.map((article, index) => (
                <li
                  key={article.slug}
                  data-reveal={index}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-[36px] border border-[#ECE8E1] bg-white p-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_34px_70px_-50px_rgba(31,42,46,0.55)] motion-reduce:hover:translate-y-0"
                >
                  {article.iconUrl ? (
                    <a href={article.url} className="relative block aspect-[16/10] w-full overflow-hidden rounded-[28px] bg-[#F6F3EE]">
                      <Image
                        src={article.iconUrl}
                        alt=""
                        fill
                        sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
                        className="object-cover transition-transform duration-700 group-hover:scale-[1.04] motion-reduce:transition-none"
                        unoptimized={preview}
                      />
                    </a>
                  ) : null}
                  <div className="flex flex-1 flex-col px-[clamp(10px,1.2vw,18px)] pb-3 pt-6">
                    {article.publishedAt ? (
                      <p className="vt-xs font-semibold uppercase tracking-[0.18em] text-[#5B6566]">
                        {new Intl.DateTimeFormat(localeTag, { dateStyle: "long", timeZone: "America/Toronto" }).format(new Date(article.publishedAt))}
                      </p>
                    ) : null}
                    <h3 className={`${SERIF} mt-3 break-words text-[clamp(21px,1.5vw,26px)] leading-tight text-[#1F2A2E]`}>
                      <a href={article.url} className="hover:text-[color:var(--vt-accent,#17505F)]">
                        {article.title}
                      </a>
                    </h3>
                    {article.summary ? <p className="mt-3 line-clamp-3 vt-md leading-[1.7] text-[#5B6566]">{article.summary}</p> : null}
                    <div className="mt-auto pt-6">
                      <a href={article.url} className={`group ${BUTTON_OUTLINE} py-3`}>
                        {t("vitrine.articles.read")}
                        <ArrowRight
                          className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none"
                          aria-hidden="true"
                        />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
      </>
    ),
  };

  return (
    <>
      <Header />
      <article
        id={ROOT_ID}
        style={accentStyle}
        className={`${vitrineSerif.variable} ${vitrineSans.variable} min-h-screen bg-[#F6F3EE] pt-14 font-[family-name:var(--font-vitrine-sans)] text-[#3E494B] antialiased`}
      >
      <style>{PAGE_CSS}</style>

      {preview ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {t("profile.previewBanner")}
        </div>
      ) : null}

      {/* Hero: the professional's portrait, their name, their profession, one button. Nothing else. */}
      <section
        id={VITRINE_ANCHORS.top}
        className="vt-band relative isolate flex min-h-[calc(100svh-3.5rem)] scroll-mt-20 flex-col overflow-hidden bg-[#F6F3EE]"
      >
        {/* The portrait fills the band's right edge — past the page gutter, to the screen's edge.
            Below lg it stays in the flow, above the name. */}
        {profile.photoUrl ? (
          <div className="vt-portrait relative h-[42svh] w-full shrink-0 lg:absolute lg:right-0 lg:top-1/2 lg:h-[min(100%,70svh)] lg:w-[38%] lg:-translate-y-1/2 xl:w-[36%]">
            <Image
              src={profile.photoUrl}
              alt={t("profile.photoAlt", { name })}
              fill
              sizes="(min-width: 1024px) 38vw, 100vw"
              quality={90}
              className="object-contain object-center"
              priority
              unoptimized={preview}
            />
          </div>
        ) : null}

        {/* The name sits in the middle of the band, with or without a portrait beside it. */}
        <div className={`${WRAP} relative flex flex-1`}>
          <div
            className={`flex flex-1 flex-col items-center justify-center py-[clamp(32px,5vw,96px)] text-center ${
              profile.photoUrl ? "lg:w-[56%] lg:flex-none lg:pr-[clamp(16px,2vw,40px)] xl:w-[58%]" : ""
            }`}
          >
            <h1 className={`${SERIF} text-[clamp(36px,4.2vw,88px)] font-normal leading-[1.04] tracking-[-0.02em] text-[#1F2A2E] text-balance`}>
              {nameWords.map((word, index) => (
                <span key={index} className="vt-word" style={{ animationDelay: `${0.18 + index * 0.11}s` }}>
                  {word}
                  {index < nameWords.length - 1 ? "\u00A0" : null}
                </span>
              ))}
            </h1>
            {title ? (
              <p
                className="vt-line mt-[clamp(12px,1.1vw,20px)] text-[clamp(11px,0.8vw,16px)] font-semibold uppercase tracking-[0.36em] text-[#1F2A2E]/55"
                style={{ animationDelay: `${afterName}s` }}
              >
                {title}
              </p>
            ) : null}
            <a
              href={bookHref}
              {...bookFunnel}
              className={`group vt-line mt-[clamp(24px,2.4vw,42px)] ${BUTTON_HERO}`}
              style={{ animationDelay: `${afterName + 0.14}s` }}
            >
              {bookLabel}
              <ArrowRight
                className="h-[1.1em] w-[1.1em] transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none"
                aria-hidden="true"
              />
            </a>
            {/* Where that button's request goes; and when the professional has times, the way to them. */}
            <p
              className="vt-line mt-[clamp(14px,1.2vw,20px)] max-w-[46ch] vt-xs leading-[1.6] text-[#1F2A2E]/55 text-pretty"
              style={{ animationDelay: `${afterName + 0.24}s` }}
              data-central-note=""
            >
              {t("vitrine.centralNote")}
              {hasAvailability ? (
                <>
                  {" "}
                  <a href={`#${VITRINE_ANCHORS.availability}`} className="font-semibold text-[color:var(--vt-accent,#17505F)] underline-offset-4 hover:underline">
                    {t("vitrine.seeTimes", { name })}
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </section>

      {/* « Disponibilités » opens the page when there is no « À propos » to follow */}
      {shownSections.includes("about") ? null : availabilityBlock}
      {/* The sections in the professional's order, without those hidden or with nothing to show */}
      {shownSections.map((key) => (
        <Fragment key={key}>
          {sectionBlocks[key]}
          {key === "about" ? availabilityBlock : null}
        </Fragment>
      ))}


      {preview ? null : (
        <>
          <div aria-hidden="true" className="h-[92px] bg-[#F6F3EE] md:hidden" />
          <div className="vt-bar fixed inset-x-3 bottom-3 z-[60] flex items-center gap-3 rounded-full border border-[#ECE8E1] bg-white/95 py-2 pl-5 pr-2 shadow-[0_18px_40px_-20px_rgba(31,42,46,0.45)] backdrop-blur-xl [margin-bottom:env(safe-area-inset-bottom)] md:hidden">
            {standard.offered ? (
              <div className="min-w-0">
                {standardPrice !== null ? (
                  <p className={`${SERIF} text-[19px] leading-tight text-[#1F2A2E]`}>
                    {t("vitrine.sticky.price", { price: money.format(standardPrice), minutes: standard.durationMinutes })}
                  </p>
                ) : null}
                <p className="truncate vt-xs text-[#5B6566]">{t("vitrine.sticky.note")}</p>
              </div>
            ) : null}
            <a
              href={bookHref}
              {...bookFunnel}
              className="ml-auto inline-flex flex-none items-center rounded-full bg-[color:var(--vt-accent,#17505F)] px-5 py-3.5 vt-sm font-semibold text-white"
            >
              {bookLabel}
            </a>
          </div>
          <VitrineMotion rootId={ROOT_ID} />
        </>
      )}
      </article>
      <Footer />
      {/* The dock is fixed to the bottom of the screen, so at the very end of the page it would sit on
          the footer’s own last line. This strip, in the footer colour, is what it rests on instead. */}
      {preview || navLinks.length === 0 ? null : (
        <>
          <div aria-hidden="true" className="h-[clamp(72px,6vw,104px)] bg-primary" />
          <VitrineSectionDock links={navLinks} navLabel={t("vitrine.nav.label")} />
        </>
      )}
    </>
  );
}
