"use client";

import { useEffect } from "react";

const EASE = "cubic-bezier(.22,.8,.26,1)";

/**
 * Cards rise into place as they scroll into view (elements marked
 * `data-reveal`, the value being their place in a row). Only what starts below
 * the fold is hidden, and only once this runs: without JavaScript, for a
 * crawler, or with reduced motion, everything is simply there.
 */
export function VitrineMotion({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const fold = window.innerHeight * 0.92;
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          element.style.opacity = "1";
          element.style.transform = "none";
          observer.unobserve(element);
          // Hand the element back to its own hover transitions once it has arrived.
          timers.push(window.setTimeout(() => (element.style.transition = ""), 1100));
        }
      },
      { rootMargin: "0px 0px -7% 0px", threshold: 0.01 },
    );

    for (const element of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (element.getBoundingClientRect().top < fold) continue;
      const delay = `${Math.min((Number(element.dataset.reveal) || 0) * 70, 280)}ms`;
      element.style.opacity = "0";
      element.style.transform = "translateY(20px)";
      element.style.transition = `opacity .75s ${EASE} ${delay}, transform .75s ${EASE} ${delay}`;
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [rootId]);

  return null;
}
