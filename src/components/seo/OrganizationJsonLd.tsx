import { getPlatformContactInfo, getSocialLinks } from "@/lib/platform-contact";
import { SITE_URL } from "@/lib/site-url";

/**
 * Organization structured data, emitted once on every page.
 *
 * This is what lets Google show the business name, logo and contact details as
 * an entity rather than guessing them from page text.
 *
 * Everything here comes from the admin-configured platform settings, never from
 * hardcoded guesses, and any field the admin has not filled in is OMITTED
 * rather than emitted empty. Structured data that contradicts the page is worse
 * than none: Google treats mismatches as a quality signal against the site.
 */
export default async function OrganizationJsonLd() {
  const [contact, social] = await Promise.all([
    getPlatformContactInfo().catch(() => null),
    getSocialLinks().catch(() => null),
  ]);

  const address = contact?.physicalAddress;
  const hasAddress = Boolean(address?.city && address?.province);

  // `sameAs` tells Google "these profiles are also us", so a URL here that is
  // not genuinely ours works against the entity match instead of for it.
  // getSocialLinks() is the gate: it returns only admin-saved http(s) URLs, and
  // there are no guessed defaults behind it any more, so an empty value here
  // simply means "not configured" and is left out.
  const sameAs = Object.values(social ?? {}).filter(
    (value): value is string => typeof value === "string" && value.startsWith("http"),
  );

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: contact?.companyName?.trim() || "Je chemine",
    url: SITE_URL,
    logo: `${SITE_URL}/Logo.png`,
    description:
      "Plateforme québécoise de santé mentale : jumelage avec des professionnels qualifiés, prise de rendez-vous et accompagnement bilingue.",
    areaServed: {
      "@type": "AdministrativeArea",
      name: "Québec, Canada",
    },
    knowsLanguage: ["fr-CA", "en-CA"],
  };

  if (hasAddress) {
    data.address = {
      "@type": "PostalAddress",
      ...(address!.street ? { streetAddress: [address!.street, address!.suite].filter(Boolean).join(", ") } : {}),
      addressLocality: address!.city,
      addressRegion: address!.province,
      ...(address!.postalCode ? { postalCode: address!.postalCode } : {}),
      addressCountry: address!.country || "CA",
    };
  }

  const contactPoint: Record<string, unknown> = {
    "@type": "ContactPoint",
    contactType: "customer support",
    availableLanguage: ["French", "English"],
  };
  if (contact?.phoneNumber?.trim()) contactPoint.telephone = contact.phoneNumber.trim();
  if (contact?.supportEmail?.trim()) contactPoint.email = contact.supportEmail.trim();
  // Only worth emitting if there is actually a way to make contact.
  if (contactPoint.telephone || contactPoint.email) data.contactPoint = contactPoint;

  if (sameAs.length > 0) data.sameAs = sameAs;

  return (
    <script
      type="application/ld+json"
      // Values come from our own database, and JSON.stringify escapes them.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
