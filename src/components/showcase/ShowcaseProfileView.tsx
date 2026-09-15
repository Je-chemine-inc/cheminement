import { Fragment, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Anchor,
  ArrowRight,
  Award,
  Brain,
  CalendarDays,
  Check,
  Clock,
  Compass,
  Feather,
  Flower2,
  Globe,
  Handshake,
  Heart,
  HeartHandshake,
  Leaf,
  Lightbulb,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Quote,
  Receipt,
  Repeat,
  ShieldCheck,
  Sparkles,
  Sprout,
  Sun,
  Users,
  Video,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { DirectRequestService } from "@/lib/direct-request-rules";
import type { ShowcaseModalityKey, ShowcasePublicProfile } from "@/lib/showcase-public";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";
import type { WaitlistModality } from "@/lib/waitlist-rules";
import { VITRINE_ANCHORS, headlinePrice, initialsOf, vitrineSections, type VitrineSection } from "@/lib/showcase-vitrine";
import { pageImages, pickAmbience } from "@/lib/showcase-imagery";
import {
  SHOWCASE_ACCENTS,
  visibleSections,
  type ShowcaseSectionKey,
  type ShowcaseTextKey,
} from "@/lib/showcase-customization";
import type { ShowcaseProductCard } from "@/lib/products";
import { ShowcaseWaitlistForm } from "@/components/showcase/ShowcaseWaitlistForm";
import { VitrineBooking, type VitrineBookingOption } from "@/components/showcase/vitrine/VitrineBooking";
import { VitrineHeader } from "@/components/showcase/vitrine/VitrineHeader";
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

/** Decorative icon and soft colour for each expertise card, in turn (the platform keeps no icon per expertise). */
const EXPERTISE_THEMES: { icon: LucideIcon; tint: string }[] = [
  { icon: Leaf, tint: "bg-[color:var(--vt-accent-soft,#E6EFEA)]" },
  { icon: Sun, tint: "bg-[#F6EDE0]" },
  { icon: Waves, tint: "bg-[#E7EEF2]" },
  { icon: Heart, tint: "bg-[#F4E9E7]" },
  { icon: Sprout, tint: "bg-[#EEF0E2]" },
  { icon: Feather, tint: "bg-[#EFEAF3]" },
  { icon: Flower2, tint: "bg-[#F3EEE6]" },
  { icon: Sparkles, tint: "bg-[#E9F1EE]" },
];

/** Icon and soft colour for each value card, in turn — distinct from the expertise cards further down. */
const VALUE_THEMES: { icon: LucideIcon; tint: string }[] = [
  { icon: Compass, tint: "bg-[#EAF2EE]" },
  { icon: Lightbulb, tint: "bg-[#F7F0E2]" },
  { icon: HeartHandshake, tint: "bg-[#EDF0F7]" },
  { icon: Anchor, tint: "bg-[#F6ECE9]" },
  { icon: Users, tint: "bg-[#EFF2E4]" },
];

/** The value cards' grid for 1 to 5 values: every row filled, never a lone narrow card. */
const VALUE_GRIDS: Record<number, string> = {
  1: "mx-auto max-w-[760px]",
  2: "mx-auto max-w-[1500px] sm:grid-cols-2",
  3: "md:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5",
};

/** Sections drawn on their own background: the first one after the image band needs space above it. */
const BACKGROUND_SECTIONS: ReadonlySet<ShowcaseSectionKey> = new Set(["approach", "services", "slots", "products"]);

const ROOT_ID = "vitrine";
const SERIF = "font-[family-name:var(--font-vitrine-serif)]";
// Wide screens use their width: content up to 2240 px, and type that grows with the viewport.
const WRAP = "mx-auto w-full max-w-[2240px] px-[clamp(20px,5vw,136px)]";
// scroll-mt clears the floating header when a nav link scrolls to a section.
const SECTION = "scroll-mt-28 py-[clamp(64px,7vw,150px)]";
const LABEL = "inline-flex items-center rounded-full bg-[color:var(--vt-accent-soft,#E6EFEA)] px-4 py-1.5 text-[clamp(13px,calc(0.25vw+9.5px),16px)] font-semibold text-[color:var(--vt-accent,#17505F)]";
const H2 = `${SERIF} text-[clamp(34px,3.4vw,76px)] font-normal leading-[1.08] tracking-[-0.01em] text-[#1F2A2E] text-pretty`;
const BODY = "text-[clamp(17px,calc(0.45vw+11px),23px)] leading-[1.8] text-[#3E494B] text-pretty";
const RULE = "border-[#ECE8E1]";
const SOFT_SHADOW = "shadow-[0_30px_70px_-50px_rgba(31,42,46,0.45)]";
const PILL = "inline-flex items-center gap-2 rounded-full border border-[#ECE8E1] bg-white px-[clamp(16px,1vw,24px)] py-[clamp(10px,0.6vw,14px)] text-[clamp(15px,calc(0.3vw+10px),19px)] text-[#1F2A2E]";
const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-2.5 rounded-full bg-[color:var(--vt-accent,#17505F)] px-[clamp(24px,2.4vw,34px)] py-4 vt-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(23,80,95,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--vt-accent-dark,#0E3A46)] hover:text-white motion-reduce:hover:translate-y-0";
const BUTTON_OUTLINE =
  "inline-flex items-center justify-center gap-2.5 rounded-full border border-[#D9D4CA] bg-white px-[clamp(22px,2.2vw,30px)] py-4 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)] transition-all duration-300 hover:border-[color:var(--vt-accent,#17505F)] hover:bg-[#F3F7F5] hover:text-[color:var(--vt-accent,#17505F)]";

/** The rounded serif, the hero's entrance, and the reduced-motion guard. */
const PAGE_CSS = `
html:has(#${ROOT_ID}){scroll-behavior:smooth}
@media (prefers-reduced-motion: reduce){html:has(#${ROOT_ID}){scroll-behavior:auto}}
#${ROOT_ID}{word-spacing:.06em}
#${ROOT_ID} .vt-xs{font-size:clamp(13px,calc(.2vw + 9.5px),16px)}
#${ROOT_ID} .vt-sm{font-size:clamp(14.5px,calc(.3vw + 10px),18.5px)}
#${ROOT_ID} .vt-md{font-size:clamp(16px,calc(.35vw + 10.5px),20px)}
#${ROOT_ID} .vt-lg{font-size:clamp(18px,calc(.4vw + 11.5px),22px)}
#${ROOT_ID} [class*="font-vitrine-serif"]{font-variation-settings:"SOFT" 100,"WONK" 0;word-spacing:normal}
@keyframes vitrineUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes vitrineIn{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
.vitrine-up{animation:vitrineUp .8s cubic-bezier(.22,.8,.26,1) both}
.vitrine-in{animation:vitrineIn 1s cubic-bezier(.22,.8,.26,1) .05s both}
@media (prefers-reduced-motion: reduce){.vitrine-up,.vitrine-in{animation:none}}
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
  // The professional's own choices (texts, sections, colour, photos); each falls back to the page's default.
  const custom = profile.customization;
  const text = (key: ShowcaseTextKey, fallback: string) => custom.texts[key] || fallback;
  const palette = SHOWCASE_ACCENTS[custom.accent];
  const accentStyle = { "--vt-accent": palette.accent, "--vt-accent-dark": palette.dark, "--vt-accent-soft": palette.soft } as CSSProperties;
  const images = pageImages(profile.slug, profile.officePhotoUrls, custom.ambience);
  const officeAlt = t("vitrine.about.officePhotoAlt", { name });

  // The introduction opens the page beside the portrait; the longer biography is « À propos ».
  const about = profile.bio;
  const hasAbout = about.length > 0 || Boolean(profile.quote) || profile.credentials.length > 0;
  const hasApproachText = profile.approach.length > 0 || profile.methods.length > 0;
  const shownSections = visibleSections(custom.sectionOrder, custom.hiddenSections, {
    about: hasAbout,
    approach: true,
    values: profile.valueCards.some((card) => card.description),
    services: true,
    slots: !preview,
    expertises: profile.expertises.length > 0 || profile.focusAreas.length > 0,
    products: products.length > 0,
    cta: true,
  });
  const sections = vitrineSections({ hasAbout, showSlots, hasProducts: products.length > 0, order: shownSections });
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
  const bookingOptions: VitrineBookingOption[] = [
    ...(standard.offered ? [{ service: "standard" as const, minutes: standard.durationMinutes, price: standardPrice }] : []),
    ...(quick.offered ? [{ service: "quick" as const, minutes: quick.durationMinutes, price: quick.price }] : []),
  ];
  const years = profile.yearsOfExperience;
  const aboutHeading = title
    ? years !== null && years > 0
      ? t("vitrine.about.headingYears", { title, years, city: officeCity })
      : t("vitrine.about.heading", { title, city: officeCity })
    : t("vitrine.about.headingNoTitle", { name, city: officeCity });

  // « En bref », beside the portrait: the order and permit already sit under the name.
  const briefFacts: { icon: LucideIcon; text: string }[] = [
    ...profile.highlights.map((text) => ({ icon: Check, text })),
    ...(years !== null ? [{ icon: Award, text: t("profile.experience", { years }) }] : []),
    ...(languages ? [{ icon: Globe, text: languages }] : []),
    ...profile.modalities.map((modality) => ({
      icon: MODALITY_ICONS[modality],
      text: modality === "inPerson" ? t("vitrine.chips.inPerson", { city: officeCity }) : t(`vitrine.chips.${modality}`),
    })),
  ];
  const steps: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: CalendarDays, title: t("vitrine.approach.requestTitle"), body: t("vitrine.approach.requestBody", { name }) },
    { icon: Mail, title: t("vitrine.approach.answerTitle"), body: t("vitrine.approach.answerBody", { name }) },
    { icon: Handshake, title: t("vitrine.approach.firstTitle"), body: t("vitrine.approach.firstBody") },
    { icon: Repeat, title: t("vitrine.approach.nextTitle"), body: t("vitrine.approach.nextBody", { name }) },
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

  // The consultations as cards: the standard one first and featured, the quick one beside it when open.
  const priceRows: {
    key: "standard" | "quick";
    icon: LucideIcon;
    title: string;
    point: string;
    chips: { icon: LucideIcon; text: string }[];
    offered: boolean;
    price: number | null;
    details: { type: string; price: string }[];
  }[] = [
    {
      key: "standard",
      icon: MessageSquare,
      title: t("profile.standardTitle"),
      point: text("standardPoint", t("vitrine.services.standardPoint")),
      chips: [
        { icon: Clock, text: t("profile.duration", { minutes: standard.durationMinutes }) },
        ...(modes ? [{ icon: hasInPerson ? MapPin : Video, text: modes.charAt(0).toLocaleUpperCase(localeTag) + modes.slice(1) }] : []),
      ],
      offered: standard.offered,
      price: standardPrice,
      details:
        standard.prices.length > 1
          ? standard.prices.map((price) => ({ type: t(`therapyTypes.${price.therapyType}`), price: money.format(price.price) }))
          : [],
    },
    ...(quick.offered
      ? [
          {
            key: "quick" as const,
            icon: Zap,
            title: t("profile.quickTitle"),
            point: text("quickPoint", t("vitrine.services.quickPoint")),
            chips: [{ icon: Clock, text: t("profile.duration", { minutes: quick.durationMinutes }) }],
            offered: true,
            price: quick.price,
            details: [],
          },
        ]
      : []),
  ];
  const serviceNotes: { icon: LucideIcon; text: string }[] = [
    ...(profile.insuranceNote.length > 0 ? [{ icon: ShieldCheck, text: profile.insuranceNote.join("\n") }] : []),
    { icon: CalendarDays, text: t("profile.cancellation", { hours: profile.freeCancellationHours }) },
    { icon: Receipt, text: t("profile.receipt") },
  ];

  // Each section below the image band on its own, so a professional can reorder or hide it (visibleSections).
  const sectionBlocks: Record<ShowcaseSectionKey, ReactNode> = {
    about: (
      <>
      {/* À propos */}
      {hasAbout ? (
        <section id={VITRINE_ANCHORS.about} className={SECTION}>
          <div className={`${WRAP} grid items-start gap-x-[clamp(40px,6vw,120px)] gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`}>
            <div className="min-w-0" data-reveal="0">
              <p className={LABEL}>{t("vitrine.about.eyebrow")}</p>
              <h2 className={`${H2} mt-5 max-w-[22ch]`}>{text("aboutTitle", aboutHeading)}</h2>
              <div className="mt-8 max-w-[68ch] space-y-5">
                {about.map((paragraph, index) => (
                  <p key={index} className={`${BODY} whitespace-pre-line`}>
                    {paragraph}
                  </p>
                ))}
              </div>
              {profile.quote ? (
                <figure className="relative mt-10 max-w-[62ch] rounded-[32px] bg-[color:var(--vt-accent-soft,#E6EFEA)] px-[clamp(24px,3vw,44px)] py-[clamp(24px,2.6vw,36px)]">
                  <Quote className="absolute left-[clamp(20px,2.4vw,34px)] top-[clamp(22px,2.4vw,34px)] h-7 w-7 text-[color:var(--vt-accent,#17505F)]/30" aria-hidden="true" />
                  <blockquote className={`pl-11 ${SERIF} text-[clamp(22px,1.9vw,32px)] italic leading-[1.35] text-[#1F2A2E] text-pretty`}>
                    {profile.quote}
                  </blockquote>
                  <figcaption className="mt-3 pl-11 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)]">{t("vitrine.about.quoteBy", { name })}</figcaption>
                </figure>
              ) : null}
              {profile.credentials.length > 0 ? (
                <div className="mt-10">
                  <p className={`${SERIF} text-[22px] text-[#1F2A2E]`}>{t("vitrine.about.credentialsTitle")}</p>
                  <ul className="mt-4 space-y-3">
                    {profile.credentials.map((line, index) => (
                      <li key={index} className="flex items-start gap-3 vt-md leading-[1.6] text-[#3E494B]">
                        <span className="mt-[0.6em] h-2 w-2 shrink-0 rounded-full bg-[color:var(--vt-accent,#17505F)]" aria-hidden="true" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="relative min-w-0 lg:sticky lg:top-28" data-reveal="1">
              <div className={`relative aspect-[4/5] w-full overflow-hidden rounded-[40px] bg-[#F6F3EE] ${SOFT_SHADOW}`}>
                <Image src={images.about.src} alt={images.about.office ? officeAlt : ""} fill sizes="(min-width: 1024px) 36vw, 100vw" className="object-cover" unoptimized={preview && images.about.office} />
              </div>
            </div>
          </div>
        </section>
      ) : null}
      </>
    ),
    approach: (
      <>
      {/* Approche */}
      <section id={VITRINE_ANCHORS.approach} className={`${SECTION} bg-[#F6F3EE]`}>
        <div className={WRAP}>
          {/* The approach text reads right under the title */}
          <div className="max-w-[72ch]" data-approach-head="">
            <p className={`${LABEL} bg-white`}>{t("vitrine.approach.eyebrow")}</p>
            <h2 className={`${H2} mt-5`}>{hasApproachText ? text("approachTitle", t("vitrine.approach.title")) : text("stepsTitle", t("vitrine.approach.stepsTitle"))}</h2>
            {profile.approach.length > 0 ? (
              <div className="mt-5 max-w-[68ch] space-y-5">
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
              <h3 className={`${SERIF} mt-[clamp(56px,6vw,104px)] text-[clamp(28px,2.6vw,46px)] leading-tight text-[#1F2A2E]`}>
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
                        <p className={`mt-4 ${SERIF} text-[clamp(24px,2.1vw,38px)] leading-[1.15] text-[#1F2A2E] text-balance`}>{method.title}</p>
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
          {hasApproachText ? (
            <h3 className={`${SERIF} mt-[clamp(56px,6vw,104px)] text-[clamp(28px,2.6vw,46px)] leading-tight text-[#1F2A2E]`}>
              {text("stepsTitle", t("vitrine.approach.stepsTitle"))}
            </h3>
          ) : null}
          <ol className="mt-[clamp(24px,2.4vw,40px)] grid gap-[clamp(14px,1.4vw,24px)] sm:grid-cols-2 lg:grid-cols-4 lg:gap-[clamp(28px,2.4vw,44px)]" data-steps="">
            {steps.map((step, index) => (
              <li
                key={index}
                data-reveal={index}
                className="relative flex min-w-0 flex-col rounded-[36px] bg-white p-[clamp(24px,2.4vw,40px)] shadow-[0_24px_60px_-50px_rgba(31,42,46,0.45)]"
              >
                {index < steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-[calc(clamp(28px,2.4vw,44px)/2+18px)] top-[calc(clamp(24px,2.4vw,40px)+28px)] z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[#E3DED4] bg-[#F6F3EE] text-[color:var(--vt-accent,#17505F)] lg:flex"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </span>
                ) : null}
                <div className="flex items-center justify-between gap-4">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--vt-accent-soft,#E6EFEA)] text-[color:var(--vt-accent,#17505F)]">
                    <step.icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="vt-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--vt-accent,#17505F)]/70">
                    {t("vitrine.approach.stepLabel", { number: index + 1 })}
                  </span>
                </div>
                <p className={`mt-7 ${SERIF} text-[clamp(22px,1.8vw,32px)] leading-tight text-[#1F2A2E] text-balance`}>{step.title}</p>
                <p className="mt-3 vt-md leading-[1.7] text-[#5B6566] text-pretty">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      </>
    ),
    values: (
      <>
      {/* Valeurs, when at least one is described: one tinted card per value, each with its own icon */}
      {profile.valueCards.some((card) => card.description) ? (
        <section className={SECTION}>
          <div className={WRAP}>
            <div className="mx-auto max-w-[62ch] text-center" data-reveal="0">
              <p className={LABEL}>{t("vitrine.values.eyebrow")}</p>
              <h2 className={`${H2} mt-5 text-balance`}>{text("valuesTitle", t("vitrine.values.title"))}</h2>
              <p className={`${BODY} mx-auto mt-5 max-w-[52ch]`}>{text("valuesIntro", t("vitrine.values.intro"))}</p>
            </div>
            <ul
              className={`mt-[clamp(40px,5vw,88px)] grid gap-[clamp(14px,1.4vw,26px)] ${VALUE_GRIDS[Math.min(profile.valueCards.length, 5)]}`}
              data-values=""
            >
              {profile.valueCards.map((card, index) => {
                const theme = VALUE_THEMES[index % VALUE_THEMES.length];
                return (
                  <li
                    key={card.label}
                    data-reveal={index % 4}
                    className={`group relative isolate flex min-h-[200px] min-w-0 sm:min-h-[clamp(280px,22vw,430px)] flex-col overflow-hidden rounded-[40px] p-[clamp(26px,2.6vw,48px)] transition-shadow duration-500 hover:shadow-[0_40px_80px_-56px_rgba(31,42,46,0.55)] ${theme.tint}`}
                  >
                    <theme.icon
                      aria-hidden="true"
                      strokeWidth={1.1}
                      className="pointer-events-none absolute -bottom-12 -right-12 -z-10 h-[clamp(170px,13vw,250px)] w-[clamp(170px,13vw,250px)] text-[color:var(--vt-accent,#17505F)] opacity-[0.07] transition-transform duration-700 group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transition-none"
                    />
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex h-[clamp(52px,3.6vw,68px)] w-[clamp(52px,3.6vw,68px)] items-center justify-center rounded-full bg-white text-[color:var(--vt-accent,#17505F)] shadow-[0_14px_30px_-20px_rgba(31,42,46,0.5)]">
                        <theme.icon className="h-[42%] w-[42%]" aria-hidden="true" />
                      </span>
                      <span className={`${SERIF} vt-md text-[#1F2A2E]/35`}>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="mt-auto pt-8 sm:pt-[clamp(40px,4vw,72px)]">
                      <p className={`${SERIF} text-[clamp(30px,2.6vw,52px)] leading-[1.05] tracking-[-0.01em] text-[#1F2A2E] text-balance`}>
                        {card.label}
                      </p>
                      <span
                        aria-hidden="true"
                        className="mt-5 block h-[3px] w-12 rounded-full bg-[color:var(--vt-accent,#17505F)]/55 transition-all duration-500 group-hover:w-20 motion-reduce:transition-none"
                      />
                      {card.description ? (
                        <p className="mt-5 max-w-[40ch] vt-md leading-[1.7] text-[#3E494B] text-pretty">{card.description}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}
      </>
    ),
    services: (
      <>
      {/* Tarifs */}
      {/* Its own soft green ground, so it never reads as one block with « Valeurs » above */}
      <section id={VITRINE_ANCHORS.services} className={`${SECTION} bg-[#EEF4F1]`}>
        <div className={WRAP}>
          {/* The intro reads as the title's subtitle, right under it */}
          <div className="max-w-[72ch]" data-services-head="">
            <p className={`${LABEL} bg-white`}>{t("vitrine.services.eyebrow")}</p>
            <h2 className={`${H2} mt-5`}>{text("servicesTitle", t("vitrine.services.title"))}</h2>
            <p className={`${BODY} mt-5 max-w-[58ch]`}>{text("servicesIntro", t("vitrine.services.intro"))}</p>
          </div>

          <ul
            className={`mt-[clamp(40px,4.5vw,64px)] grid gap-[clamp(16px,1.6vw,28px)] ${priceRows.length > 1 ? "lg:grid-cols-2" : "lg:max-w-[820px]"}`}
            data-price-cards=""
          >
            {priceRows.map((row, index) => {
              const featured = index === 0;
              return (
                <li
                  key={row.key}
                  data-reveal={index}
                  className={`relative isolate flex min-w-0 flex-col overflow-hidden rounded-[40px] p-[clamp(26px,3vw,52px)] ${
                    featured
                      ? "bg-[color:var(--vt-accent,#17505F)] text-white shadow-[0_44px_90px_-56px_rgba(14,58,70,0.9)]"
                      : "bg-white text-[#1F2A2E] shadow-[0_30px_70px_-54px_rgba(31,42,46,0.45)]"
                  }`}
                >
                  {featured ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-28 -top-28 -z-10 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.12),rgba(255,255,255,0)_70%)]"
                    />
                  ) : null}
                  <span
                    className={`flex h-[clamp(52px,3.6vw,64px)] w-[clamp(52px,3.6vw,64px)] items-center justify-center rounded-2xl ${
                      featured ? "bg-white/12 text-white" : "bg-[color:var(--vt-accent-soft,#E6EFEA)] text-[color:var(--vt-accent,#17505F)]"
                    }`}
                  >
                    <row.icon className="h-[42%] w-[42%]" aria-hidden="true" />
                  </span>
                  <h3 className={`mt-7 ${SERIF} text-[clamp(28px,2.5vw,44px)] leading-[1.08] text-balance ${featured ? "text-white" : "text-[#1F2A2E]"}`}>
                    {row.title}
                  </h3>
                  <p className={`mt-3 max-w-[46ch] vt-md leading-[1.65] text-pretty ${featured ? "text-white/78" : "text-[#5B6566]"}`}>{row.point}</p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {row.chips.map((chip) => (
                      <li
                        key={chip.text}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 vt-sm ${
                          featured ? "bg-white/10 text-white" : "border border-[#ECE8E1] bg-white text-[#3E494B]"
                        }`}
                      >
                        <chip.icon className={`h-4 w-4 shrink-0 ${featured ? "text-white/80" : "text-[color:var(--vt-accent,#17505F)]"}`} aria-hidden="true" />
                        {chip.text}
                      </li>
                    ))}
                  </ul>
                  {row.offered && row.details.length > 0 ? (
                    <ul className={`mt-6 divide-y ${featured ? "divide-white/15" : "divide-[#ECE8E1]"}`}>
                      {row.details.map((detail) => (
                        <li key={detail.type} className="flex items-baseline justify-between gap-4 py-3 vt-md">
                          <span className={featured ? "text-white/80" : "text-[#5B6566]"}>{detail.type}</span>
                          <span className={`${SERIF} text-[clamp(20px,1.6vw,26px)]`}>{detail.price}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className={`mt-auto pt-[clamp(28px,3vw,44px)]`}>
                    <div
                      className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-5 border-t pt-[clamp(22px,2.4vw,36px)] ${
                        featured ? "border-white/15" : "border-[#ECE8E1]"
                      }`}
                    >
                      {row.offered ? (
                        <>
                          {row.price !== null ? (
                            <p className="flex items-baseline gap-2.5">
                              <span className={`${SERIF} whitespace-nowrap text-[clamp(46px,4.2vw,76px)] leading-none`}>{money.format(row.price)}</span>
                              <span className={`vt-sm ${featured ? "text-white/70" : "text-[#5B6566]"}`}>{t("vitrine.services.perSession")}</span>
                            </p>
                          ) : (
                            <p className={`max-w-[24ch] vt-md ${featured ? "text-white/80" : "text-[#5B6566]"}`}>{t("vitrine.services.priceLater")}</p>
                          )}
                          <a
                            href={bookHref}
                            {...bookFunnel}
                            className={
                              featured
                                ? "inline-flex items-center justify-center gap-2.5 rounded-full bg-white px-[clamp(24px,2.4vw,34px)] py-4 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--vt-accent-soft,#E6EFEA)] hover:text-[color:var(--vt-accent-dark,#0E3A46)] motion-reduce:hover:translate-y-0"
                                : BUTTON_PRIMARY
                            }
                          >
                            {showSlots ? (row.key === "standard" ? t("vitrine.services.seeTimes") : t("vitrine.services.seeQuick")) : bookLabel}
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </a>
                        </>
                      ) : (
                        <p className={`vt-md ${featured ? "text-white/80" : "text-[#5B6566]"}`}>{t("profile.notAccepting", { name })}</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-[clamp(16px,1.6vw,28px)] rounded-[40px] bg-white/70 p-[clamp(24px,2.8vw,48px)]" data-service-notes="">
            <p className={`${SERIF} text-[clamp(22px,1.9vw,30px)] text-[#1F2A2E]`}>{t("vitrine.services.notesTitle")}</p>
            <ul className={`mt-6 grid gap-x-[clamp(24px,3vw,56px)] gap-y-5 ${serviceNotes.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              {serviceNotes.map((note, index) => (
                <li key={index} className="flex min-w-0 items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--vt-accent-soft,#E6EFEA)] text-[color:var(--vt-accent,#17505F)]">
                    <note.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="min-w-0 whitespace-pre-line pt-2 vt-sm leading-[1.65] text-[#3E494B] text-pretty">{note.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      </>
    ),
    slots: (
      <>
      {/* Disponibilités */}
      {preview ? null : (
        <section id={VITRINE_ANCHORS.slots} className={`${SECTION} bg-[#F6F3EE]`}>
          <div className={WRAP}>
            {/* The intro reads as the title's subtitle, right under it */}
            <div className="mb-[clamp(32px,3.5vw,56px)] max-w-[72ch]" data-dispos-head="">
              <p className={`${LABEL} bg-white`}>{t("vitrine.dispos.eyebrow")}</p>
              <h2 className={`${H2} mt-5`}>{showSlots ? text("disposTitle", t("vitrine.dispos.title")) : t("vitrine.dispos.closedTitle")}</h2>
              <p className={`${BODY} mt-5 max-w-[58ch]`}>
                {showSlots ? text("disposIntro", t("vitrine.dispos.intro", { name })) : t("vitrine.dispos.closedIntro", { name })}
              </p>
            </div>
            {showSlots ? (
              <VitrineBooking
                slug={profile.slug}
                name={name}
                options={bookingOptions}
                modes={modes}
                bookingBaseUrl={bookingUrl}
                waitlistAnchor={VITRINE_ANCHORS.waitlist}
                aside={waitlist}
              />
            ) : (
              <div className="max-w-[760px]">{waitlist}</div>
            )}
          </div>
        </section>
      )}
      </>
    ),
    expertises: (
      <>
      {/* Ce que j'accompagne: the professional's own cards, then the catalog expertises */}
      {profile.expertises.length > 0 || profile.focusAreas.length > 0 ? (
        <section className={SECTION}>
          <div className={WRAP}>
            {/* The intro reads as the title's subtitle, right under it */}
            <div className="max-w-[72ch]" data-expertises-head="">
              <p className={LABEL}>{t("vitrine.expertises.eyebrow")}</p>
              <h2 className={`${H2} mt-5`}>{text("expertisesTitle", t("vitrine.expertisesTitle"))}</h2>
              <p className={`${BODY} mt-5 max-w-[58ch]`}>{text("expertisesIntro", t("vitrine.expertisesIntro", { name }))}</p>
            </div>
            {profile.focusAreas.length > 0 ? (
              <ul className="mt-[clamp(32px,4.5vw,64px)] grid gap-4 md:grid-cols-2">
                {profile.focusAreas.map((area, index) => {
                  const theme = EXPERTISE_THEMES[index % EXPERTISE_THEMES.length];
                  return (
                    <li key={index} data-reveal={index % 2} data-focus-area="" className={`min-w-0 rounded-[34px] p-[clamp(22px,2.4vw,40px)] ${theme.tint}`}>
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/85 text-[color:var(--vt-accent,#17505F)]">
                        <theme.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className={`mt-6 ${SERIF} text-[clamp(24px,2vw,34px)] leading-tight text-[#1F2A2E] text-balance`}>{area.title}</h3>
                      {area.body.map((paragraph, paragraphIndex) => (
                        <p key={paragraphIndex} className="mt-3 max-w-[58ch] vt-md leading-[1.7] text-[#3E494B] text-pretty">
                          {paragraph}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {profile.expertises.length > 0 ? (
            <ul className="mt-[clamp(32px,4.5vw,64px)] grid grid-cols-2 gap-3 sm:gap-[clamp(14px,1.2vw,22px)] sm:[grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {profile.expertises.map((expertise, index) => {
                const theme = EXPERTISE_THEMES[index % EXPERTISE_THEMES.length];
                return (
                  <li key={expertise.label} data-reveal={index % 4}>
                    <div
                      className={`flex h-full min-h-[168px] flex-col rounded-[26px] p-4 sm:min-h-[clamp(220px,15vw,290px)] sm:rounded-[34px] sm:p-[clamp(20px,1.8vw,30px)] ${theme.tint}`}
                    >
                      <span className="flex items-start justify-between gap-4">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-[color:var(--vt-accent,#17505F)] shadow-[0_12px_28px_-18px_rgba(31,42,46,0.45)] sm:h-[clamp(52px,3.4vw,66px)] sm:w-[clamp(52px,3.4vw,66px)]">
                          <theme.icon className="h-[45%] w-[45%]" aria-hidden="true" />
                        </span>
                        <span className={`${SERIF} vt-md text-[#1F2A2E]/35`}>{String(index + 1).padStart(2, "0")}</span>
                      </span>
                      <span className={`mt-auto block pt-6 ${SERIF} text-[clamp(19px,1.9vw,34px)] leading-[1.1] text-[#1F2A2E] text-balance sm:pt-10`}>
                        {expertise.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
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
        <section id={VITRINE_ANCHORS.products} className={`${SECTION} bg-[#F6F3EE]`}>
          <div className={WRAP}>
            <p className={`${LABEL} bg-white`}>{t("vitrine.products.eyebrow")}</p>
            <h2 className={`${H2} mt-5 max-w-[24ch]`}>{text("productsTitle", t("vitrine.products.title"))}</h2>
            <ul
              className={`mt-[clamp(40px,4.5vw,64px)] grid gap-[clamp(20px,2.2vw,32px)] md:grid-cols-2 ${products.length >= 3 ? "xl:grid-cols-3" : ""}`}
            >
              {products.map((product, index) => (
                <li
                  key={product.slug}
                  data-reveal={index}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-[36px] bg-white p-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_34px_70px_-50px_rgba(31,42,46,0.55)] motion-reduce:hover:translate-y-0"
                >
                  <a href={product.url} className="relative block aspect-[16/10] w-full overflow-hidden rounded-[28px] bg-[#F6F3EE]">
                    <Image
                      // Past the page's three large images, so a product never repeats one of them or its neighbour.
                      src={product.iconUrl ?? pickAmbience(profile.slug, 3 + index)}
                      alt=""
                      fill
                      sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-[1.04] motion-reduce:transition-none"
                      unoptimized={preview && Boolean(product.iconUrl)}
                    />
                    <span className="absolute left-4 top-4 rounded-full bg-white/90 px-4 py-1.5 vt-xs font-semibold text-[color:var(--vt-accent,#17505F)] backdrop-blur-md">
                      {t(`profile.productType_${product.type}`)}
                    </span>
                  </a>
                  <div className="flex flex-1 flex-col px-[clamp(10px,1.2vw,18px)] pb-3 pt-6">
                    <h3 className={`${SERIF} break-words text-[clamp(24px,2vw,30px)] leading-tight text-[#1F2A2E]`}>
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
                      <a href={product.url} className={`${BUTTON_OUTLINE} py-3`}>
                        {t("profile.productOpen")}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
    cta: (
      <>
      {/* Closing band */}
      <section className={`${WRAP} py-[clamp(40px,5vw,72px)]`}>
        <div className="relative isolate overflow-hidden rounded-[44px]">
          <Image src={images.closing.src} alt="" fill sizes="100vw" className="-z-20 object-cover" unoptimized={preview && images.closing.office} />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-[color:var(--vt-accent-dark,#0E3A46)]/90 via-[color:var(--vt-accent-dark,#0E3A46)]/75 to-[color:var(--vt-accent-dark,#0E3A46)]/40" />
          <div className="flex min-h-[clamp(380px,38vw,560px)] flex-col items-start justify-center px-[clamp(24px,5vw,88px)] py-[clamp(48px,6vw,96px)]">
            <p className="inline-flex rounded-full bg-white/15 px-4 py-1.5 vt-xs font-semibold text-white backdrop-blur-md">{t("vitrine.ctaEyebrow")}</p>
            <h2 className={`${SERIF} mt-5 max-w-[18ch] text-[clamp(36px,4.4vw,68px)] font-normal leading-[1.06] text-white text-balance`}>
              {text("ctaTitle", t("vitrine.cta.title"))}
            </h2>
            <p className="mt-5 max-w-[52ch] text-[clamp(17px,1.5vw,20px)] leading-[1.7] text-white/85 text-pretty">{text("ctaBody", t("vitrine.cta.body", { name }))}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href={bookHref}
                {...bookFunnel}
                className="inline-flex items-center justify-center gap-2.5 rounded-full bg-white px-[clamp(24px,2.4vw,34px)] py-4 vt-sm font-semibold text-[color:var(--vt-accent,#17505F)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--vt-accent-soft,#E6EFEA)] hover:text-[color:var(--vt-accent-dark,#0E3A46)] motion-reduce:hover:translate-y-0"
              >
                {bookLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              {preview ? null : (
                <a
                  href={`#${VITRINE_ANCHORS.waitlist}`}
                  className="inline-flex items-center justify-center rounded-full border border-white/50 px-[clamp(22px,2.2vw,30px)] py-4 vt-sm font-semibold text-white transition-colors duration-300 hover:bg-white/10 hover:text-white"
                >
                  {t("vitrine.cta.waitlist")}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
      </>
    ),
  };

  return (
    <article
      id={ROOT_ID}
      style={accentStyle}
      className={`${vitrineSerif.variable} ${vitrineSans.variable} min-h-screen bg-white font-[family-name:var(--font-vitrine-sans)] text-[#3E494B] antialiased`}
    >
      <style>{PAGE_CSS}</style>

      {preview ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {t("profile.previewBanner")}
        </div>
      ) : null}

      <VitrineHeader
        name={name}
        title={title}
        photoUrl={profile.photoUrl}
        photoUnoptimized={preview}
        initials={initialsOf(name)}
        brandHref={canonicalSiteUrl("/")}
        brandLabel={t("brand")}
        links={navLinks}
        bookHref={bookHref}
        bookLabel={bookLabel}
        bookIsFunnel={!showSlots}
        navLabel={t("vitrine.nav.label")}
        sticky={!preview}
      />

      {/* Portrait hero */}
      <section id={VITRINE_ANCHORS.top} className="scroll-mt-20">
        <div className={`${WRAP} grid items-center gap-x-[clamp(40px,6vw,120px)] gap-y-12 py-[clamp(48px,6vw,104px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
          <div className="vitrine-in relative mx-auto w-full max-w-[440px] lg:max-w-none">
            <div aria-hidden="true" className="absolute -bottom-[clamp(18px,2.2vw,36px)] -right-[clamp(18px,2.2vw,36px)] h-3/4 w-3/4 rounded-[48px] bg-[color:var(--vt-accent-soft,#E6EFEA)]" />
            <div aria-hidden="true" className="absolute -left-[clamp(14px,1.6vw,26px)] -top-[clamp(14px,1.6vw,26px)] h-28 w-28 rounded-full bg-[#F6F3EE]" />
            <div className={`relative rounded-[40px] border border-[#ECE8E1] bg-white p-[clamp(8px,1vw,14px)] ${SOFT_SHADOW}`}>
              <div className="relative aspect-[4/5] max-h-[960px] w-full overflow-hidden rounded-[32px] bg-[#F6F3EE]">
                {profile.photoUrl ? (
                  <Image
                    src={profile.photoUrl}
                    alt={t("profile.photoAlt", { name })}
                    fill
                    sizes="(min-width: 1024px) 40vw, 440px"
                    className="object-cover"
                    priority
                    unoptimized={preview}
                  />
                ) : (
                  <div className={`flex h-full items-center justify-center ${SERIF} text-[96px] text-[color:var(--vt-accent,#17505F)]/60`}>{initialsOf(name)}</div>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0">
            {title ? <p className={`vitrine-up ${LABEL}`}>{title}</p> : null}
            <h1 className={`vitrine-up mt-5 ${SERIF} text-[clamp(46px,5.2vw,120px)] font-normal leading-[1] tracking-[-0.02em] text-[#1F2A2E] text-balance [animation-delay:.06s]`}>
              {name}
            </h1>
            {credential ? (
              <p className="vitrine-up mt-4 inline-flex items-center gap-2 vt-sm text-[#5B6566] [animation-delay:.1s]">
                <ShieldCheck className="h-4 w-4 text-[color:var(--vt-accent,#17505F)]" aria-hidden="true" />
                {credential}
              </p>
            ) : null}
            {profile.headline ? (
              <p className={`vitrine-up mt-7 max-w-[32ch] ${SERIF} text-[clamp(25px,2.2vw,50px)] leading-[1.3] text-[#1F2A2E] text-pretty [animation-delay:.14s]`}>
                {profile.headline}
              </p>
            ) : null}
            {profile.intro.length > 0 ? (
              <div className="vitrine-up mt-5 max-w-[62ch] space-y-4 [animation-delay:.18s]">
                {profile.intro.map((paragraph, index) => (
                  <p key={index} className={`${BODY} whitespace-pre-line`}>
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="vitrine-up mt-9 flex flex-wrap items-center gap-3 [animation-delay:.22s]">
              <a href={bookHref} {...bookFunnel} className={BUTTON_PRIMARY}>
                {bookLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a href={`#${VITRINE_ANCHORS.services}`} className={BUTTON_OUTLINE}>
                {t("vitrine.heroSecondary")}
              </a>
            </div>
            {briefFacts.length > 0 ? (
              <div className="vitrine-up mt-9 max-w-[62ch] rounded-[32px] bg-[#F6F3EE] p-[clamp(20px,2.4vw,32px)] [animation-delay:.26s]" data-brief="">
                <p className={`${SERIF} text-[22px] text-[#1F2A2E]`}>{t("vitrine.about.factsTitle")}</p>
                <ul className="mt-4 flex flex-wrap gap-2.5">
                  {briefFacts.map((fact, index) => (
                    <li key={index} className={PILL}>
                      <fact.icon className="h-4 w-4 shrink-0 text-[color:var(--vt-accent,#17505F)]" aria-hidden="true" />
                      {fact.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Image band */}
      <figure className={WRAP}>
        <div className={`relative aspect-[4/3] max-h-[960px] w-full overflow-hidden rounded-[40px] bg-[#F6F3EE] sm:aspect-[16/9] lg:aspect-[21/9] ${SOFT_SHADOW}`}>
          <Image src={images.band.src} alt={images.band.office ? officeAlt : ""} fill sizes="100vw" className="object-cover" priority unoptimized={preview && images.band.office} />
          {/* The values over the photo follow the « Valeurs » section: hidden with it. */}
          {profile.values.length > 0 && !custom.hiddenSections.includes("values") ? (
            <figcaption className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 p-[clamp(16px,2.4vw,36px)]">
              <span className="rounded-full bg-[#1F2A2E]/70 px-4 py-2 vt-xs font-semibold text-white backdrop-blur-md">{t("vitrine.values.eyebrow")}</span>
              {profile.values.map((value) => (
                <span key={value} className={`rounded-full bg-white/85 px-5 py-2 ${SERIF} text-[clamp(16px,1.4vw,20px)] italic text-[#1F2A2E] backdrop-blur-md`}>
                  {value}
                </span>
              ))}
            </figcaption>
          ) : null}
        </div>
      </figure>

      {BACKGROUND_SECTIONS.has(shownSections[0]) ? <div aria-hidden="true" className="h-[clamp(64px,8vw,120px)]" /> : null}
      {/* The sections in the professional's order, without those hidden or with nothing to show */}
      {shownSections.map((key) => (
        <Fragment key={key}>{sectionBlocks[key]}</Fragment>
      ))}

      <footer className="rounded-t-[44px] bg-[#F6F3EE]">
        <div className={`${WRAP} grid gap-10 py-[clamp(48px,5vw,88px)] sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]`}>
          <div className="min-w-0">
            <p className={`${SERIF} text-[30px] leading-tight text-[#1F2A2E]`}>{name}</p>
            {title ? <p className={`mt-3 ${LABEL} bg-white`}>{title}</p> : null}
            <p className="mt-4 vt-sm leading-[1.7] text-[#5B6566]">{place}</p>
            {credential ? <p className="mt-1 vt-sm leading-[1.6] text-[#5B6566]">{credential}</p> : null}
          </div>
          <nav aria-label={t("vitrine.footer.pageTitle")} className="min-w-0">
            <p className="vt-sm font-semibold text-[#1F2A2E]">{t("vitrine.footer.pageTitle")}</p>
            <ul className="mt-4 flex flex-col gap-2.5 vt-sm">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-[#3E494B] hover:text-[color:var(--vt-accent,#17505F)]">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0">
            <p className="vt-sm font-semibold text-[#1F2A2E]">{t("vitrine.footer.platformTitle")}</p>
            <ul className="mt-4 flex flex-col gap-2.5 vt-sm">
              <li>
                <a href={canonicalSiteUrl("/")} className="text-[#3E494B] hover:text-[color:var(--vt-accent,#17505F)]">
                  {t("vitrine.footer.site")}
                </a>
              </li>
              <li>
                <a href={bookingUrl} data-showcase-cta="" className="text-[#3E494B] hover:text-[color:var(--vt-accent,#17505F)]">
                  {t("vitrine.footer.match")}
                </a>
              </li>
            </ul>
          </div>
          <div className="min-w-0">
            <p className="vt-sm font-semibold text-[#1F2A2E]">{t("vitrine.footer.poweredTitle")}</p>
            <a
              href={canonicalSiteUrl("/")}
              className="mt-4 inline-flex items-center rounded-full bg-white px-5 py-3 shadow-[0_12px_30px_-22px_rgba(31,42,46,0.45)] transition-opacity hover:opacity-80"
            >
              <Image src="/Logo.png" alt={t("brand")} width={423} height={84} className="h-[clamp(26px,1.8vw,36px)] w-auto" />
            </a>
            <p className="mt-3 vt-sm leading-[1.6] text-[#5B6566]">{t("vitrine.footer.poweredBody")}</p>
          </div>
        </div>
        <div className={`${WRAP} pb-8`}>
          <div className={`flex flex-wrap justify-center gap-x-6 gap-y-2 border-t ${RULE} pt-5 text-center vt-xs text-[#5B6566]`}>
            <span>{t("footer.rights", { year: new Date().getFullYear() })}</span>
            <a href={canonicalSiteUrl("/privacy")} className="hover:text-[color:var(--vt-accent,#17505F)]">
              {t("footer.privacy")}
            </a>
            <a href={canonicalSiteUrl("/terms")} className="hover:text-[color:var(--vt-accent,#17505F)]">
              {t("footer.terms")}
            </a>
          </div>
        </div>
      </footer>

      {preview ? null : (
        <>
          <div aria-hidden="true" className="h-[92px] bg-[#F6F3EE] md:hidden" />
          <div className="fixed inset-x-3 bottom-3 z-[60] flex items-center gap-3 rounded-full border border-[#ECE8E1] bg-white/95 py-2 pl-5 pr-2 shadow-[0_18px_40px_-20px_rgba(31,42,46,0.45)] backdrop-blur-xl [margin-bottom:env(safe-area-inset-bottom)] md:hidden">
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
              {bookable.length > 0 ? t("vitrine.sticky.cta") : bookLabel}
            </a>
          </div>
          <VitrineMotion rootId={ROOT_ID} />
        </>
      )}
    </article>
  );
}
