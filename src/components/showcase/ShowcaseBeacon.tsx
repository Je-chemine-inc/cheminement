"use client";

import { useEffect } from "react";

/**
 * Counts a visit to a showcase page, and clicks on its « Demander un
 * rendez-vous » links (any element marked `data-showcase-cta`), for the light
 * statistics (spec 003). Sends only the page's city and address; the endpoint
 * stores anonymous daily counts. Never rendered in previews.
 */
export function ShowcaseBeacon({ city, slug }: { city: string; slug?: string }) {
  useEffect(() => {
    const send = (event: "view" | "cta") => {
      const body = JSON.stringify(slug ? { event, city, slug } : { event, city });
      try {
        const queued = navigator.sendBeacon?.(
          "/api/showcase/beacon",
          new Blob([body], { type: "application/json" }),
        );
        if (!queued) {
          void fetch("/api/showcase/beacon", {
            method: "POST",
            body,
            headers: { "Content-Type": "application/json" },
            keepalive: true,
          }).catch(() => {
            // statistics never get in the visitor's way
          });
        }
      } catch {
        // statistics never get in the visitor's way
      }
    };
    send("view");
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[data-showcase-cta]") : null;
      if (target) send("cta");
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [city, slug]);
  return null;
}
