"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A professional's page carries the platform's own navigation bar at the top, so its sections need
 * their own way of being reached: a small dock that floats at the bottom of the screen, names each
 * section, and marks the one being read.
 *
 * It stays fixed at the bottom of the screen the whole way down the page. It is hidden below `md`,
 * where the page already has a fixed bar carrying the price and the booking button, and two docks
 * would fight for the same corner.
 *
 * The mark on the section being read is one pill that slides between the links rather than a colour
 * that jumps from one to the next, and the dock itself rises into place once the hero has had its
 * moment. Both settle instantly under `prefers-reduced-motion`.
 *
 * The pill is placed by writing to its node rather than through state: its position is a fact about
 * the rendered layout, it changes on every scroll, and re-rendering the dock to carry two numbers
 * would cost a render each time.
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

/** How long the hero keeps the screen to itself before the dock rises. */
const HERO_MOMENT = 900;

export function VitrineSectionDock({ links, navLabel }: { links: DockLink[]; navLabel: string }) {
  const [active, setActive] = useState<string | null>(links[0]?.href ?? null);
  const [risen, setRisen] = useState(false);
  const list = useRef<HTMLUListElement | null>(null);
  const pill = useRef<HTMLSpanElement | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setRisen(true), HERO_MOMENT);
    return () => window.clearTimeout(timer);
  }, []);

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

  /** Puts the sliding pill over the link being read. Writes to the node; never sets state. */
  const place = useCallback(() => {
    const bar = pill.current;
    if (!bar) return;
    const current = list.current?.querySelector<HTMLElement>("[data-dock-current]");
    if (!current) {
      bar.style.opacity = "0";
      return;
    }
    bar.style.left = `${current.offsetLeft}px`;
    bar.style.width = `${current.offsetWidth}px`;
    bar.style.opacity = "1";
  }, []);

  useEffect(place, [place, active, links]);

  useEffect(() => {
    // The labels are laid out with the page's fluid type, so their widths change with the viewport,
    // and again once the page's own fonts have loaded.
    window.addEventListener("resize", place);
    const fonts = typeof document !== "undefined" && "fonts" in document ? document.fonts : null;
    fonts?.addEventListener("loadingdone", place);
    return () => {
      window.removeEventListener("resize", place);
      fonts?.removeEventListener("loadingdone", place);
    };
  }, [place]);

  if (links.length === 0) return null;

  return (
    <nav
      aria-label={navLabel}
      className={`pointer-events-none fixed inset-x-0 bottom-[clamp(16px,2vw,32px)] z-50 hidden justify-center px-4 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none md:flex ${
        risen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      <ul
        ref={list}
        className="pointer-events-auto relative flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-full border border-[#E7E2D9] bg-white/85 p-1.5 shadow-[0_18px_44px_-22px_rgba(31,42,46,0.45)] backdrop-blur-xl"
      >
        {/* One pill slides between the links instead of a colour jumping from one to the next. */}
        <span
          ref={pill}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1.5 left-0 w-0 rounded-full bg-primary opacity-0 transition-[left,width,opacity] duration-500 ease-[cubic-bezier(.2,.8,.24,1)] motion-reduce:transition-none"
        />
        {links.map((link) => {
          const current = link.href === active;
          return (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={current ? "true" : undefined}
                data-dock-current={current ? "" : undefined}
                className={`relative inline-flex whitespace-nowrap rounded-full px-[clamp(12px,1.1vw,20px)] py-[clamp(7px,0.6vw,11px)] text-[clamp(12px,0.78vw,14.5px)] font-semibold transition-colors duration-300 ${
                  current ? "text-primary-foreground" : "text-[#3E494B] hover:text-[color:var(--vt-accent,#17505F)]"
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
