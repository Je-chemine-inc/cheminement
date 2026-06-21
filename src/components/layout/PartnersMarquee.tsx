import Image from "next/image";
import Link from "next/link";
import type { IPartner } from "@/models/PlatformSettings";

/**
 * Scrolling band of admin-configured partner logos for the footer.
 *
 * - 0 partners → nothing.
 * - 1 partner  → a single static logo (a marquee of one looks broken).
 * - 2+         → a seamless auto-scrolling marquee (CSS-only, pauses on hover,
 *   disabled under prefers-reduced-motion — see `.animate-marquee` in globals.css).
 *   The track renders the list twice so a -50% translate loops without a seam;
 *   each chip carries a uniform right margin to keep that period exact.
 */
function PartnerLogo({ partner }: { partner: IPartner }) {
  const chip = (
    <span className="flex items-center rounded-lg bg-primary-foreground px-4 py-2 shadow-sm ring-1 ring-black/10">
      <span className="relative block h-16 w-40">
        <Image
          src={partner.logoUrl}
          alt={partner.name || "Partenaire"}
          fill
          sizes="160px"
          unoptimized
          className="object-contain"
        />
      </span>
    </span>
  );

  if (partner.linkUrl) {
    return (
      <Link
        href={partner.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={partner.name || undefined}
        className="mr-6 shrink-0 transition-opacity hover:opacity-80"
      >
        {chip}
      </Link>
    );
  }
  return <span className="mr-6 shrink-0">{chip}</span>;
}

export default function PartnersMarquee({
  partners,
}: {
  partners: IPartner[];
}) {
  if (partners.length === 0) return null;

  if (partners.length === 1) {
    return (
      <div className="flex">
        <PartnerLogo partner={partners[0]} />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
      <div className="flex w-max items-center animate-marquee">
        {partners.map((p, i) => (
          <PartnerLogo key={`p-${i}`} partner={p} />
        ))}
        {/* Identical second copy so translateX(-50%) loops seamlessly; hidden
            from assistive tech so the logos aren't announced twice. */}
        {partners.map((p, i) => (
          <span key={`dup-${i}`} aria-hidden="true" className="contents">
            <PartnerLogo partner={p} />
          </span>
        ))}
      </div>
    </div>
  );
}
