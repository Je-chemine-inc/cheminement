import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Award,
  Globe,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { ShowcaseModalityKey, ShowcasePublicProfile } from "@/lib/showcase-public";
import { canonicalSiteUrl } from "@/lib/showcase-hosts";

/**
 * A professional's showcase page (spec 003), from the public data object only.
 * Rendered on the city host, and in the professional's and the admin's
 * preview (`preview`: a banner, and the photo loaded without Next's optimizer,
 * which cannot see an unpublished photo).
 *
 * Everything a professional wrote goes through React, never as HTML.
 */

const MODALITY_ICONS: Record<ShowcaseModalityKey, LucideIcon> = {
  inPerson: Users,
  video: Video,
  phone: Phone,
  chat: MessageSquare,
};

/** Where "request an appointment" leads: the booking funnel on www. */
export function showcaseBookingUrl(profile: Pick<ShowcasePublicProfile, "slug" | "city">): string {
  const query = new URLSearchParams({ from: "showcase", pro: profile.slug, city: profile.city.key });
  return canonicalSiteUrl(`/appointment?${query.toString()}`);
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export async function ShowcaseProfileView({
  profile,
  preview = false,
}: {
  profile: ShowcasePublicProfile;
  preview?: boolean;
}) {
  const t = await getTranslations("Showcase");
  const locale = (await getLocale()) === "en" ? "en-CA" : "fr-CA";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const name = profile.displayName;
  const title = profile.title.key ? t(`titles.${profile.title.key}`) : profile.title.label;
  const orderName = profile.order
    ? profile.order.code === "other"
      ? profile.order.label
      : t(`orders.${profile.order.code}`)
    : null;
  const orderText = orderName ? t("profile.memberOf", { order: orderName }) : null;
  const permitText = profile.licenseNumber ? t("profile.permit", { number: profile.licenseNumber }) : null;
  const standard = profile.services.standard;
  const bookingUrl = showcaseBookingUrl(profile);
  const bookingLabel = standard.offered ? t("profile.bookCta") : t("profile.matchCta");
  const presentation = [...profile.intro, ...profile.bio];

  return (
    <article className="bg-background">
      {preview ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {t("profile.previewBanner")}
        </div>
      ) : null}

      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[240px_1fr] md:py-16">
          <div className="relative mx-auto aspect-[4/5] w-48 overflow-hidden rounded-2xl bg-muted md:w-60">
            {profile.photoUrl ? (
              <Image
                src={profile.photoUrl}
                alt={t("profile.photoAlt", { name })}
                fill
                sizes="(min-width: 768px) 240px, 192px"
                className="object-cover"
                priority
                unoptimized={preview}
              />
            ) : (
              <div className="flex h-full items-center justify-center font-serif text-4xl text-muted-foreground">
                {initialsOf(name)}
              </div>
            )}
          </div>

          <div className="space-y-4 text-center md:text-left">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              {t("profile.location", { city: profile.city.name, region: profile.city.region })}
            </p>
            <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-5xl">{name}</h1>
            {title ? <p className="text-lg text-foreground/80">{title}</p> : null}
            {orderText || permitText ? (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground md:justify-start">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {orderText}
                  {orderText && permitText ? " · " : null}
                  {/* A permit number never breaks at its hyphen. */}
                  {permitText ? <span className="whitespace-nowrap">{permitText}</span> : null}
                </span>
              </p>
            ) : null}
            {profile.headline ? <p className="text-base text-foreground md:text-lg">{profile.headline}</p> : null}

            {profile.modalities.length > 0 ? (
              <ul className="flex flex-wrap justify-center gap-2 md:justify-start">
                {profile.modalities.map((modality) => {
                  const Icon = MODALITY_ICONS[modality];
                  return (
                    <li
                      key={modality}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-foreground"
                    >
                      <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      {t(`modalities.${modality}`)}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground md:justify-start">
              {profile.languages.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  {profile.languages.map((language) => t(`languages.${language}`)).join(", ")}
                </span>
              ) : null}
              {profile.officeCity ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {t("profile.officeIn", { city: profile.officeCity })}
                </span>
              ) : null}
              {profile.yearsOfExperience !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Award className="h-4 w-4" aria-hidden="true" />
                  {t("profile.experience", { years: profile.yearsOfExperience })}
                </span>
              ) : null}
            </div>

            <div className="pt-2">
              <a
                href={bookingUrl}
                className="inline-flex rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {bookingLabel}
              </a>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-10">
          {presentation.length > 0 ? (
            <section aria-labelledby="showcase-presentation">
              <h2 id="showcase-presentation" className="font-serif text-2xl font-light text-foreground">
                {t("profile.presentationTitle")}
              </h2>
              <div className="mt-4 space-y-4 leading-relaxed text-foreground/90">
                {presentation.map((paragraph, index) => (
                  <p key={index} className="whitespace-pre-line">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {profile.approach.length > 0 ? (
            <section aria-labelledby="showcase-approach">
              <h2 id="showcase-approach" className="font-serif text-2xl font-light text-foreground">
                {t("profile.approachTitle")}
              </h2>
              <div className="mt-4 space-y-4 leading-relaxed text-foreground/90">
                {profile.approach.map((paragraph, index) => (
                  <p key={index} className="whitespace-pre-line">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {profile.values.length > 0 ? (
            <section aria-labelledby="showcase-values">
              <h2 id="showcase-values" className="font-serif text-2xl font-light text-foreground">
                {t("profile.valuesTitle")}
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {profile.values.map((value) => (
                  <li key={value} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-foreground">
                    {value}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {profile.expertises.length > 0 ? (
            <section aria-labelledby="showcase-expertises">
              <h2 id="showcase-expertises" className="font-serif text-2xl font-light text-foreground">
                {t("profile.expertisesTitle")}
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {profile.expertises.map((expertise) => (
                  <li
                    key={expertise.label}
                    className="rounded-full border border-border/60 bg-card px-3 py-1 text-sm text-foreground"
                  >
                    {expertise.label}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="showcase-services" className="rounded-2xl border border-border/60 bg-card p-6">
            <h2 id="showcase-services" className="font-serif text-xl font-light text-foreground">
              {t("profile.servicesTitle")}
            </h2>
            <div className="mt-4 space-y-5">
              <div>
                <h3 className="text-sm font-medium text-foreground">{t("profile.standardTitle")}</h3>
                {!standard.offered ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t("profile.notAccepting", { name })}</p>
                ) : standard.prices.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t("profile.pricesUnavailable")}</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border/60">
                    {standard.prices.map((price) => (
                      <li key={price.therapyType} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                        <span className="text-foreground">
                          {t(`therapyTypes.${price.therapyType}`)}
                          <span className="block text-xs text-muted-foreground">
                            {t("profile.duration", { minutes: standard.durationMinutes })}
                          </span>
                        </span>
                        <span className="font-medium text-foreground">{money.format(price.price)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {profile.services.quick.offered ? (
                <div>
                  <h3 className="text-sm font-medium text-foreground">{t("profile.quickTitle")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t("profile.quickOffered")}</p>
                </div>
              ) : null}
            </div>
            <div className="mt-5 space-y-3 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
              {profile.insuranceNote.map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
              <p>{t("profile.receipt")}</p>
              <p>{t("profile.cancellation", { hours: profile.freeCancellationHours })}</p>
            </div>
          </section>

          <section className="rounded-2xl bg-primary/5 p-6">
            <h2 className="font-serif text-xl font-light text-foreground">{t("profile.bookTitle", { name })}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("profile.bookBody")}</p>
            <a
              href={bookingUrl}
              className="mt-4 inline-flex w-full justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {bookingLabel}
            </a>
          </section>
        </aside>
      </div>
    </article>
  );
}
