"use client";

import { useEffect } from "react";

const EASE = "cubic-bezier(.22,.8,.26,1)";

/**
 * Cards rise into place as they scroll into view (elements marked
 * `data-reveal`, the value being their place in a row). Only what starts below
 * the fold is hidden, and only once this runs: without JavaScript, for a
 * crawler, or with reduced motion, everything is simply there.
 *
 * Each one is given the class `vt-seen` when it arrives — at once when it was
 * already in view — so a section can animate its own insides from that moment
 * (« En bref »). Those animations must be additions: with reduced motion, or
 * without JavaScript, the class never comes.
 *
 * An element marked `data-appear` instead of `data-reveal` is only told when it
 * arrives: nothing about it is hidden or moved, because it carries its own
 * animation (a heading's cascade, a run of paragraphs). That makes it safe on
 * something already positioned, which `data-reveal` is not.
 */
export function VitrineMotion({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const fold = window.innerHeight * 0.92;
    const timers: number[] = [];
    // Only what this component hid is put back; everything else is just told it arrived.
    const hidden = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          if (hidden.has(element)) {
            element.style.opacity = "1";
            element.style.transform = "none";
            // Hand the element back to its own hover transitions once it has arrived.
            timers.push(window.setTimeout(() => (element.style.transition = ""), 1100));
          }
          element.classList.add("vt-seen");
          observer.unobserve(element);
        }
      },
      { rootMargin: "0px 0px -7% 0px", threshold: 0.01 },
    );

    for (const element of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (element.getBoundingClientRect().top < fold) {
        // Already in view: nothing to rise, but what it carries inside still plays.
        element.classList.add("vt-seen");
        continue;
      }
      const delay = `${Math.min((Number(element.dataset.reveal) || 0) * 70, 280)}ms`;
      element.style.opacity = "0";
      element.style.transform = "translateY(20px)";
      element.style.transition = `opacity .75s ${EASE} ${delay}, transform .75s ${EASE} ${delay}`;
      hidden.add(element);
      observer.observe(element);
    }

    for (const element of root.querySelectorAll<HTMLElement>("[data-appear]")) {
      if (element.getBoundingClientRect().top < fold) {
        element.classList.add("vt-seen");
        continue;
      }
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [rootId]);

  return null;
}
