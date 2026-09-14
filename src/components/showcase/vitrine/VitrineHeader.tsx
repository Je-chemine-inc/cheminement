"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The header of a professional's page: their name and title, links to the
 * page's sections, and the booking button. Sticky on the public page, with a
 * reading-progress line and the current section highlighted; plain in the
 * dashboard previews. Every text comes from the server.
 */
export function VitrineHeader({
  name,
  title,
  links,
  bookHref,
  bookLabel,
  bookIsFunnel,
  navLabel,
  sticky,
}: {
  name: string;
  title: string | null;
  links: { href: string; label: string }[];
  bookHref: string;
  bookLabel: string;
  /** The button leaves for the booking funnel (counted as a booking click). */
  bookIsFunnel: boolean;
  navLabel: string;
  sticky: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!sticky) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, y / max)) : 0})`;
      }
      setScrolled(y > 12);
      let current: string | null = null;
      for (const link of links) {
        const target = document.getElementById(link.href.slice(1));
        if (target && target.getBoundingClientRect().top <= 150) current = link.href;
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
    <header
      className={`${sticky ? "sticky top-0" : "relative"} z-40 border-b border-[#EDE6DA] bg-[rgba(250,247,242,0.92)] backdrop-blur-md transition-shadow duration-300 ${
        scrolled ? "shadow-[0_14px_32px_-26px_rgba(16,51,61,0.62)]" : ""
      }`}
    >
      <div className="relative mx-auto flex h-[68px] w-full max-w-[1180px] items-center gap-[clamp(12px,2vw,28px)] px-[clamp(14px,3vw,28px)]">
        <a href="#haut" className="min-w-0 flex-none">
          <span className="block truncate font-[family-name:var(--font-vitrine-serif)] text-[clamp(18px,2.4vw,22px)] font-medium leading-[1.1] tracking-[-0.015em] text-[#0F3540]">
            {name}
          </span>
          {title ? (
            <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#666E62]">{title}</span>
          ) : null}
        </a>
        <nav
          aria-label={navLabel}
          // On a phone the links scroll sideways; the fade shows there is more.
          className="flex min-w-0 flex-1 gap-[clamp(10px,1.4vw,22px)] overflow-x-auto py-1 pr-6 [mask-image:linear-gradient(90deg,#000_80%,transparent)] [scrollbar-width:none] md:pr-0 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={active === link.href ? "location" : undefined}
              className={`whitespace-nowrap text-sm transition-colors hover:text-[#17505F] ${
                active === link.href ? "font-semibold text-[#17505F]" : "text-[#4C5A55]"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <a
          href={bookHref}
          {...(bookIsFunnel ? { "data-showcase-cta": "" } : {})}
          className="hidden flex-none items-center gap-2 whitespace-nowrap rounded-xl bg-[#17505F] px-[18px] py-[11px] text-[14.5px] font-semibold text-[#F8F5EE] transition hover:-translate-y-0.5 hover:bg-[#0E3A46] hover:text-[#F8F5EE] sm:inline-flex"
        >
          {bookLabel}
        </a>
        {sticky ? (
          <div
            ref={barRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 origin-left scale-x-0 bg-[linear-gradient(90deg,#17505F,#7E9B6E)] transition-transform duration-100 ease-linear"
          />
        ) : null}
      </div>
    </header>
  );
}
