"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Languages, MapPin, MessageCircle, Phone, Video, type LucideIcon } from "lucide-react";
import type { ShowcaseModalityKey } from "@/lib/showcase-public";
import { directoryTint } from "@/components/professionals/directory-tints";

/** One professional as the page shows it: every text already translated on the server. */
export interface DirectoryCard {
  id: string;
  name: string;
  initials: string;
  /** « Ph.D. · Psychologue » */
  eyebrow: string;
  /** The profession the filter groups by (a title key, or "other"). */
  group: string;
  experience: string | null;
  summary: string;
  photoUrl: string | null;
  photoAlt: string;
  languages: string[];
  modalities: { key: ShowcaseModalityKey; label: string }[];
  profileHref: string | null;
  profileLabel: string;
  /** Position in the list, picks the monogram's colours. */
  tint: number;
}

export interface DirectoryGroup {
  key: string;
  label: string;
  count: number;
}

const SERIF = { fontFamily: "var(--font-vitrine-serif), Georgia, 'Times New Roman', serif" };

const MODALITY_ICONS: Record<ShowcaseModalityKey, LucideIcon> = {
  inPerson: MapPin,
  video: Video,
  phone: Phone,
  chat: MessageCircle,
};

/**
 * The professionals, one under the other: a large circled portrait on one side and the presentation
 * on the other, alternating. The filter is the only thing that moves, so this is the one client part.
 */
export function ProfessionalsDirectoryGrid({
  cards,
  groups,
  labels,
}: {
  cards: DirectoryCard[];
  groups: DirectoryGroup[];
  labels: { filter: string; all: string; noResults: string; viewProfile: string; languages: string; modalities: string };
}) {
  const [group, setGroup] = useState<string | null>(null);
  const shown = group ? cards.filter((card) => card.group === group) : cards;

  const chip = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium transition ${
      active ? "bg-[#1F2A2E] text-white shadow-sm" : "border border-[#E4E1DA] bg-white text-[#1F2A2E] hover:border-[#1F2A2E]/30"
    }`;

  return (
    <div>
      {groups.length > 1 && (
        <div role="group" aria-label={labels.filter} className="flex flex-wrap gap-2">
          <button type="button" className={chip(group === null)} aria-pressed={group === null} onClick={() => setGroup(null)}>
            {labels.all}
            <span className="text-xs opacity-60">{cards.length}</span>
          </button>
          {groups.map((item) => (
            <button
              key={item.key}
              type="button"
              className={chip(group === item.key)}
              aria-pressed={group === item.key}
              onClick={() => setGroup(item.key)}
            >
              {item.label}
              <span className="text-xs opacity-60">{item.count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mt-8 text-[#5B6566]">{labels.noResults}</p>
      ) : (
        <ul className="mt-6 md:mt-12">
          {shown.map((card, index) => {
            const tint = directoryTint(card.tint);
            const mirrored = index % 2 === 1;
            return (
              <li key={card.id} className="border-b border-[#DFDAD1] py-14 last:border-b-0 md:py-20 xl:py-24">
                <article
                  className={`group flex flex-col items-center gap-10 md:items-start md:gap-16 lg:gap-24 xl:gap-32 ${
                    mirrored ? "md:flex-row-reverse" : "md:flex-row"
                  }`}
                >
                  {/* Portrait */}
                  <div className="relative shrink-0">
                    <span
                      aria-hidden
                      className={`absolute -inset-4 rounded-full border border-[#17505F]/15 transition duration-500 group-hover:-inset-6 ${
                        card.photoUrl ? "" : "opacity-70"
                      }`}
                    />
                    <div className="relative size-60 overflow-hidden rounded-full border-2 border-[#17505F]/70 bg-[#F3F7F7] shadow-[0_28px_56px_-28px_rgba(31,42,46,0.45)] md:size-72 lg:size-80 xl:size-[22rem]">
                      {card.photoUrl ? (
                        <Image
                          src={card.photoUrl}
                          alt={card.photoAlt}
                          fill
                          sizes="(min-width: 1280px) 352px, (min-width: 1024px) 320px, (min-width: 768px) 288px, 240px"
                          className="object-cover transition duration-700 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <span
                          aria-hidden
                          style={{ ...SERIF, color: tint.ink, background: `linear-gradient(135deg, ${tint.from}, ${tint.to})` }}
                          className="flex size-full items-center justify-center text-6xl md:text-7xl xl:text-8xl"
                        >
                          {card.initials}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Presentation */}
                  <div className="min-w-0 flex-1 text-center md:text-left">
                    {card.eyebrow && (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#17505F]">{card.eyebrow}</p>
                    )}
                    <h2 style={SERIF} className="mt-3 text-[34px] leading-tight text-[#1F2A2E] md:text-[42px] xl:text-5xl">
                      {card.name}
                    </h2>
                    {card.experience && <p className="mt-3 text-[15px] text-[#5B6566]">{card.experience}</p>}
                    {card.summary && (
                      <p className="mt-6 max-w-3xl text-base leading-8 text-[#5B6566] md:text-lg md:leading-9">
                        {card.summary}
                      </p>
                    )}

                    {(card.languages.length > 0 || card.modalities.length > 0) && (
                      <dl
                        className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 md:justify-start"
                      >
                        {card.languages.length > 0 && (
                          <div className="flex items-center gap-2 text-[15px] text-[#1F2A2E]">
                            <dt className="sr-only">{labels.languages}</dt>
                            <Languages aria-hidden className="size-4 shrink-0 text-[#17505F]" />
                            <dd>{card.languages.join(" · ")}</dd>
                          </div>
                        )}
                        {card.modalities.length > 0 && (
                          <div>
                            <dt className="sr-only">{labels.modalities}</dt>
                            <dd>
                              <ul className="flex flex-wrap justify-center gap-2 md:justify-start">
                                {card.modalities.map((modality) => {
                                  const Icon = MODALITY_ICONS[modality.key];
                                  return (
                                    <li
                                      key={modality.key}
                                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-[13px] text-[#1F2A2E] ring-1 ring-[#E4E1DA]"
                                    >
                                      <Icon aria-hidden className="size-3.5 text-[#17505F]" />
                                      {modality.label}
                                    </li>
                                  );
                                })}
                              </ul>
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {card.profileHref && (
                      <Link
                        href={card.profileHref}
                        aria-label={card.profileLabel}
                        style={SERIF}
                        className="mt-9 inline-flex items-center gap-2 text-xl font-bold text-[#17505F] underline underline-offset-[6px] transition hover:text-[#0F3F4C]"
                      >
                        {labels.viewProfile}
                        <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
