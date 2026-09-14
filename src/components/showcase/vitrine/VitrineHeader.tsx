"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * The header of a professional's page: a floating rounded bar with Je chemine's
 * logo (the page lives on the platform), the professional's photo, name and
 * title, links to the page's sections with the current one highlighted, and
 * the booking button. Sticky on the public page, with a soft shadow once the
 * page scrolls; plain in the dashboard previews. Every text comes from the server.
 */
export function VitrineHeader({
  name,
  title,
  photoUrl,
  photoUnoptimized,
  initials,
  brandHref,
  brandLabel,
  links,
  bookHref,
  bookLabel,
  bookIsFunnel,
  navLabel,
  sticky,
}: {
  name: string;
  title: string | null;
  photoUrl: string | null;
  /** The dashboard previews load an unpublished photo directly (Next's optimizer cannot see it). */
  photoUnoptimized: boolean;
  initials: string;
  /** Je chemine's home page on www. */
  brandHref: string;
  brandLabel: string;
  links: { href: string; label: string }[];
  bookHref: string;
  bookLabel: string;
  /** The button leaves for the booking funnel (counted as a booking click). */
  bookIsFunnel: boolean;
  navLabel: string;
  sticky: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!sticky) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      setScrolled(window.scrollY > 24);
      let current: string | null = null;
      for (const link of links) {
        const target = document.getElementById(link.href.slice(1));
        if (target && target.getBoundingClientRect().top <= 180) current = link.href;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [links, sticky]);

  return (
    <header className={`${sticky ? "sticky top-3" : "relative"} z-40 mt-3`}>
      <div className="mx-auto w-full max-w-[2240px] px-[clamp(12px,3.4vw,112px)]">
        <div
          className={`flex h-[clamp(64px,4vw,80px)] items-center gap-[clamp(8px,1vw,20px)] rounded-full border px-2 transition-all duration-300 ${
            scrolled
              ? "border-[#E4E1DA] bg-white/85 shadow-[0_20px_44px_-26px_rgba(31,42,46,0.4)] backdrop-blur-xl"
              : "border-[#ECE8E1] bg-white"
          }`}
        >
          <a
            href={brandHref}
            className="flex flex-none items-center rounded-full py-2 pl-[clamp(10px,1vw,18px)] pr-1 transition-opacity hover:opacity-80"
          >
            <Image src="/Logo.png" alt={brandLabel} width={423} height={84} className="h-[clamp(22px,1.5vw,30px)] w-auto" priority />
          </a>
          <span aria-hidden="true" className="h-8 w-px flex-none bg-[#E4E1DA]" />

          <a href="#haut" className="flex min-w-0 items-center gap-3 rounded-full py-1 pl-1 pr-2">
            <span className="relative h-[clamp(40px,2.6vw,52px)] w-[clamp(40px,2.6vw,52px)] flex-none overflow-hidden rounded-full bg-[#E6EFEA] ring-2 ring-white">
              {photoUrl ? (
                <Image src={photoUrl} alt="" fill sizes="52px" className="object-cover" loading="eager" unoptimized={photoUnoptimized} />
              ) : (
                <span className="flex h-full items-center justify-center font-[family-name:var(--font-vitrine-serif)] text-[17px] text-[#17505F]">
                  {initials}
                </span>
              )}
            </span>
            <span className="block min-w-0">
              <span className="block truncate font-[family-name:var(--font-vitrine-serif)] text-[clamp(17px,calc(0.3vw+11px),23px)] leading-tight text-[#1F2A2E]">
                {name}
              </span>
              {title ? <span className="block truncate text-[clamp(12px,calc(0.15vw+9px),14px)] font-semibold text-[#17505F]">{title}</span> : null}
            </span>
          </a>

          <nav aria-label={navLabel} className="mx-auto hidden min-w-0 items-center gap-0.5 rounded-full bg-[#F3F1EC] p-1 min-[1360px]:flex">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={active === link.href ? "location" : undefined}
                className={`whitespace-nowrap rounded-full px-[clamp(12px,1vw,22px)] py-2.5 text-[clamp(14px,calc(0.25vw+10.5px),17px)] font-medium transition-all duration-300 ${
                  active === link.href
                    ? "bg-white text-[#17505F] shadow-[0_6px_16px_-10px_rgba(31,42,46,0.5)]"
                    : "text-[#3E494B] hover:bg-white/60 hover:text-[#1F2A2E]"
                }`}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <a
            href={bookHref}
            {...(bookIsFunnel ? { "data-showcase-cta": "" } : {})}
            className="ml-auto hidden flex-none items-center rounded-full bg-[#17505F] px-[clamp(18px,1.4vw,28px)] py-[clamp(12px,0.8vw,16px)] text-[clamp(14px,calc(0.25vw+10.5px),17px)] font-semibold text-white shadow-[0_12px_24px_-14px_rgba(23,80,95,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#0E3A46] hover:text-white motion-reduce:hover:translate-y-0 sm:inline-flex min-[1360px]:ml-0"
          >
            {bookLabel}
          </a>
        </div>
      </div>
    </header>
  );
}
