import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, Phone, Video } from "lucide-react";
import type { DirectoryCardProps } from "@/lib/showcase-directory";

/**
 * One professional in a directory (spec 003, the « Ville » design): photo,
 * name, title and experience, expertises, how they consult, their next free
 * times and the link to their page. Only props, no translations or hooks, so
 * the city page's client directory and the server card lists share it.
 */
const MODE_ICONS = { inPerson: MapPin, video: Video, phone: Phone } as const;

export function ShowcaseDirectoryCard(props: DirectoryCardProps) {
  const body = (
    <>
      <span className="relative flex h-[clamp(84px,11vw,116px)] w-[clamp(84px,11vw,116px)] flex-none items-center justify-center overflow-hidden rounded-2xl bg-[#EEF2EC] font-serif text-3xl text-[#17505F]/60">
        {props.photoUrl ? (
          <Image src={props.photoUrl} alt="" fill sizes="116px" className="object-cover" />
        ) : (
          props.initials
        )}
      </span>
      <span className="block min-w-0 flex-[1_1_220px]">
        <span className="block font-serif text-[clamp(20px,2.2vw,24px)] leading-tight tracking-[-0.015em] text-[#0F3540]">
          {props.displayName}
        </span>
        {props.subtitle ? <span className="mt-1 block text-[14.5px] text-[#5B6661]">{props.subtitle}</span> : null}
        {props.cityLine ? (
          <span className="mt-1 block text-xs uppercase tracking-wide text-[#666E62]">{props.cityLine}</span>
        ) : null}
        {props.expertises.length > 0 ? (
          <span className="mt-2.5 flex flex-wrap gap-1.5">
            {props.expertises.map((expertise) => (
              <span key={expertise} className="rounded-lg border border-[#E2EADC] bg-[#F3F6F0] px-2.5 py-1 text-[12.5px] text-[#37483C]">
                {expertise}
              </span>
            ))}
          </span>
        ) : null}
        {props.modes.length > 0 ? (
          <span className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-[#5E6863]">
            {props.modes.map((mode) => {
              const Icon = MODE_ICONS[mode.icon];
              return (
                <span key={mode.label} className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-[#17505F]" aria-hidden="true" />
                  {mode.label}
                </span>
              );
            })}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-[0_1_190px] flex-col gap-2">
        {props.nextSlots.length > 0 ? (
          <>
            <span className="text-xs uppercase tracking-[0.06em] text-[#666E62]">{props.nextSlotsTitle}</span>
            <span className="flex flex-wrap gap-1.5" data-next-slots="">
              {props.nextSlots.map((slot) => (
                <span key={slot} className="rounded-[9px] border border-[#E7DFD1] bg-[#FCFAF6] px-2.5 py-1.5 text-[13px] text-[#22403C]">
                  {slot}
                </span>
              ))}
            </span>
          </>
        ) : null}
        <span className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-[#17505F]">
          {props.viewProfile}
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </span>
    </>
  );
  const className =
    "group flex flex-wrap items-start gap-[clamp(14px,2vw,22px)] rounded-[20px] border border-[#EDE6DA] bg-white p-[clamp(14px,2vw,20px)] text-[#414E4B] transition-all duration-300 hover:-translate-y-1 hover:border-[#C6D4C2] hover:text-[#414E4B] hover:shadow-[0_24px_44px_-30px_rgba(16,51,61,0.5)] motion-reduce:hover:translate-y-0";
  return props.external ? (
    <a href={props.href} className={className} data-directory-card="">
      {body}
    </a>
  ) : (
    <Link href={props.href} className={className} data-directory-card="">
      {body}
    </Link>
  );
}
