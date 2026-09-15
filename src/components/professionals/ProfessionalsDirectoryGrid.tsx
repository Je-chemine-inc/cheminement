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
    `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
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
        <ul className="mt-8 grid gap-6 md:grid-cols-2 md:gap-8">
          {shown.map((card) => {
            const tint = directoryTint(card.tint);
            return (
              <li key={card.id}>
                <article className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E4E1DA] bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_56px_-28px_rgba(23,80,95,0.35)]">
                  <div className="relative aspect-[16/10] overflow-hidden">
                    {card.photoUrl ? (
                      <Image
                        src={card.photoUrl}
                        alt={card.photoAlt}
                        fill
                        sizes="(min-width: 768px) 560px, 100vw"
                        className="object-cover transition duration-700 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div
                        className="relative flex size-full items-center justify-center"
                        style={{ background: `linear-gradient(135deg, ${tint.from}, ${tint.to})` }}
                      >
                        <div
                          aria-hidden
                          className="absolute inset-0 opacity-50"
                          style={{
                            backgroundImage:
                              "repeating-radial-gradient(circle at 85% 115%, transparent 0 26px, rgba(255,255,255,0.45) 26px 27px)",
                          }}
                        />
                        <span
                          aria-hidden
                          style={{ ...SERIF, color: tint.ink }}
                          className="relative flex size-28 items-center justify-center rounded-full bg-white/75 text-4xl shadow-[0_12px_32px_-16px_rgba(31,42,46,0.45)] transition duration-500 group-hover:scale-105 md:size-32 md:text-5xl"
                        >
                          {card.initials}
                        </span>
                      </div>
                    )}
                    {card.experience && (
                      <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[#1F2A2E] shadow-sm backdrop-blur">
                        {card.experience}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-6 sm:p-8">
                    {card.eyebrow && (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#17505F]">{card.eyebrow}</p>
                    )}
                    <h2 style={SERIF} className="mt-2 text-[28px] leading-tight text-[#1F2A2E]">
                      {card.name}
                    </h2>
                    {card.summary && <p className="mt-4 line-clamp-4 text-[15px] leading-7 text-[#5B6566]">{card.summary}</p>}

                    {(card.languages.length > 0 || card.modalities.length > 0) && (
                      <dl className="mt-6 space-y-4 border-t border-[#EEEBE4] pt-5 text-sm">
                        {card.languages.length > 0 && (
                          <div className="flex items-start gap-3">
                            <dt className="sr-only">{labels.languages}</dt>
                            <Languages aria-hidden className="mt-0.5 size-4 shrink-0 text-[#17505F]" />
                            <dd className="text-[#1F2A2E]">{card.languages.join(" · ")}</dd>
                          </div>
                        )}
                        {card.modalities.length > 0 && (
                          <div>
                            <dt className="sr-only">{labels.modalities}</dt>
                            <dd>
                              <ul className="flex flex-wrap gap-2">
                                {card.modalities.map((modality) => {
                                  const Icon = MODALITY_ICONS[modality.key];
                                  return (
                                    <li
                                      key={modality.key}
                                      className="inline-flex items-center gap-1.5 rounded-full bg-[#F3F1EC] px-3 py-1 text-xs text-[#1F2A2E]"
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
                      <div className="mt-auto pt-7">
                        <Link
                          href={card.profileHref}
                          aria-label={card.profileLabel}
                          className="inline-flex items-center gap-2 text-sm font-semibold text-[#17505F] underline-offset-4 hover:underline"
                        >
                          {labels.viewProfile}
                          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </div>
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
