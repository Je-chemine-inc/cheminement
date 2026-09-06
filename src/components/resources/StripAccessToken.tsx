"use client";

import { useEffect } from "react";

/**
 * Removes `?token=` from the address bar once the page has rendered.
 *
 * The guest access token is a bearer credential. Left in the URL it rides the
 * Referer header to every third party the page embeds (YouTube, Spotify), and
 * it ends up in screenshots and pasted links. The server has already read it
 * by the time this runs, so dropping it costs nothing.
 *
 * `replaceState` rather than `push`: the reader should not have to press Back
 * twice to leave the page.
 */
export default function StripAccessToken() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("token")) return;
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  return null;
}
