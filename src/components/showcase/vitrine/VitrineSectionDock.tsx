"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A professional's page carries the platform's own navigation bar at the top, so its sections need
 * their own way of being reached: a small dock that floats at the bottom of the screen, names each
 * section, and marks the one being read.
 *
 * It stays fixed at the bottom of the screen the whole way down the page. It is hidden below `md`,
 * where the page already has a fixed bar carrying the price and the booking button, and two docks
 * would fight for the same corner.
 *
 * Every label is handed in from the server, so this component reads no translations of its own and a
 * professional's page keeps sending the browser only the few namespaces it already sends.
 */
export interface DockLink {
  /** The section's anchor, "#a-propos". */
  href: string;
  label: string;
}

/** How far down the viewport a section's top must be before it counts as the one being read. */
const READING_LINE = 0.38;

export function VitrineSectionDock({ links, navLabel }: { links: DockLink[]; navLabel: string }) {
  const [active, setActive] = useState<string | null>(links[0]?.href ?? null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (links.length === 0) return;

    const read = () => {
      frame.current = null;
      const line = window.innerHeight * READING_LINE;

      // The section being read is the last one whose top has passed the reading line; before any
      // has, it is the first.
      let current = links[0]!.href;
      for (const link of links) {
        const section = document.querySelector(link.href);
        if (!section) continue;
        if (section.getBoundingClientRect().top <= line) current = link.href;
      }
      setActive(current);
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [links]);

  if (links.length === 0) return null;

  return (
    <nav
      aria-label={navLabel}
      className="pointer-events-none fixed inset-x-0 bottom-[clamp(16px,2vw,32px)] z-50 hidden justify-center px-4 md:flex"
    >
      <ul
        className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-full border border-[#E7E2D9] bg-white/85 p-1.5 shadow-[0_18px_44px_-22px_rgba(31,42,46,0.45)] backdrop-blur-xl"
      >
        {links.map((link) => {
          const current = link.href === active;
          return (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={current ? "true" : undefined}
                className={`inline-flex whitespace-nowrap rounded-full px-[clamp(12px,1.1vw,20px)] py-[clamp(7px,0.6vw,11px)] text-[clamp(12px,0.78vw,14.5px)] font-semibold transition-colors duration-300 ${
                  current
                    ? "bg-primary text-primary-foreground"
                    : "text-[#3E494B] hover:bg-[#F6F3EE] hover:text-[color:var(--vt-accent,#17505F)]"
                }`}
              >
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
