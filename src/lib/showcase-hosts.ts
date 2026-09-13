import { APEX_HOST, CANONICAL_HOST, SITE_URL } from "@/lib/site-url";
import { SHOWCASE_HOST_PREFIX, isShowcaseCityKey } from "@/lib/showcase-cities";

/**
 * Which host a request came in on, and what the middleware does about it.
 *
 * The showcase pages live on one host per city (psymascouche.jechemine.ca),
 * served by the same Next app as www: the middleware rewrites a city host's
 * request to the internal segment src/app/showcase/[cityKey]/…, so
 * psymascouche.jechemine.ca/sassi renders /showcase/mascouche/sassi.
 *
 * Everything here keys on the HOST, never on the scheme: behind Apache the
 * connection is plain http and a scheme-based rule loops forever (debt-map
 * 2026-09-07). Pure, so the rules are tested without a server.
 */

/** Internal route segment the city hosts are rewritten to. */
export const SHOWCASE_INTERNAL_PREFIX = "/showcase";

/** The directory of cities and regions on www. */
export const SHOWCASE_HUB_PATH = "/psy";

/**
 * Request header the middleware sets, with the city key, on a city host's
 * rewrite — and strips from every other request, so a client cannot set it.
 * The root layout reads it to send a city page only the messages it uses.
 */
export const SHOWCASE_CITY_HEADER = "x-showcase-city";

/**
 * Files crawlers ask each host for, mapped to the route-handler folders that
 * serve them per city. A folder named robots.txt or sitemap.xml would be taken
 * by Next for a metadata route, which gets no route params.
 */
export const SHOWCASE_SPECIAL_FILES: Readonly<Record<string, string>> = {
  "/robots.txt": "/robots-txt",
  "/sitemap.xml": "/sitemap-xml",
};

/**
 * APIs a city page may call on its own host. The CSP only allows same-origin
 * requests (connect-src 'self'), so these must answer there; every other API
 * path is sent to www.
 *  - /api/showcase/*: the showcase's own public endpoints.
 *  - /api/files/*: photos (public kinds only; the route checks).
 *  - /api/auth/session|csrf|_log: the root layout's SessionProvider asks on
 *    every page. No cookie exists on a city host, so it answers "signed out".
 */
const CITY_HOST_API_PREFIXES = ["/api/showcase/", "/api/files/"];
const CITY_HOST_API_EXACT = new Set(["/api/auth/session", "/api/auth/csrf", "/api/auth/_log"]);

export type HostKind =
  | { kind: "canonical" }
  | { kind: "apex" }
  | { kind: "city"; cityKey: string }
  /** psy<something>.jechemine.ca that is not in the registry. */
  | { kind: "unknown-city" }
  /** Any other *.jechemine.ca name (the wildcard DNS record answers for all),
   *  staging.jechemine.ca included since it was retired on 2026-09-13. */
  | { kind: "other-subdomain" }
  /** 127.0.0.1:3000 (watchdog, deploy health check), localhost, or no host at
   *  all (Next's image optimizer fetches /api/files in-process, headerless). */
  | { kind: "foreign" };

const escapedApex = APEX_HOST.replace(/\./g, "\\.");
const CITY_HOST_RE = new RegExp(`^${SHOWCASE_HOST_PREFIX}([a-z0-9]+)\\.${escapedApex}$`);

/** Lowercase, no port, no trailing dot. */
export function normalizeHost(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().split(":")[0].replace(/\.$/, "");
}

export function classifyHost(raw: string | null | undefined): HostKind {
  const host = normalizeHost(raw);
  if (host === CANONICAL_HOST) return { kind: "canonical" };
  if (host === APEX_HOST) return { kind: "apex" };
  const match = CITY_HOST_RE.exec(host);
  if (match) {
    return isShowcaseCityKey(match[1])
      ? { kind: "city", cityKey: match[1] }
      : { kind: "unknown-city" };
  }
  if (host.endsWith(`.${APEX_HOST}`)) return { kind: "other-subdomain" };
  return { kind: "foreign" };
}

/** The city a host serves, or null. */
export function parseShowcaseHost(raw: string | null | undefined): string | null {
  const kind = classifyHost(raw);
  return kind.kind === "city" ? kind.cityKey : null;
}

export function cityHostFor(cityKey: string): string {
  return `${SHOWCASE_HOST_PREFIX}${cityKey}.${APEX_HOST}`;
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Absolute public URL of a page on a city host. */
export function absoluteShowcaseUrl(cityKey: string, path = "/"): string {
  return `https://${cityHostFor(cityKey)}${withLeadingSlash(path)}`;
}

/** Absolute URL on the canonical host. */
export function canonicalSiteUrl(path = "/"): string {
  return `${SITE_URL}${withLeadingSlash(path)}`;
}

/** The internal path a city host's public path is rewritten to. */
export function internalShowcasePath(cityKey: string, publicPath: string): string {
  const path = withLeadingSlash(publicPath);
  const mapped = SHOWCASE_SPECIAL_FILES[path] ?? path;
  return `${SHOWCASE_INTERNAL_PREFIX}/${cityKey}${mapped === "/" ? "" : mapped}`;
}

const INTERNAL_RE = new RegExp(`^${SHOWCASE_INTERNAL_PREFIX}/([^/]+)(/.*)?$`);
const SPECIAL_BY_FOLDER: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SHOWCASE_SPECIAL_FILES).map(([file, folder]) => [folder, file]),
);

/** The inverse of internalShowcasePath, for an internal path reached directly. */
export function parseInternalShowcasePath(
  pathname: string,
): { cityKey: string; publicPath: string } | null {
  const match = INTERNAL_RE.exec(pathname);
  if (!match) return null;
  const rest = match[2] ?? "/";
  return { cityKey: match[1], publicPath: SPECIAL_BY_FOLDER[rest] ?? rest };
}

function isCityHostApi(pathname: string): boolean {
  return (
    CITY_HOST_API_EXACT.has(pathname) ||
    CITY_HOST_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export type HostRouting =
  /** `cityKey`: the request renders a city page (see the foreign-host rule). */
  | { action: "next"; cityKey?: string }
  /** 308: a permanent move to the canonical URL. 307: a host we do not serve
   *  (yet) — temporary, so browsers do not cache it (see routeRequest). */
  | { action: "redirect"; location: string; status: 307 | 308 }
  | { action: "rewrite"; pathname: string; cityKey: string };

/**
 * What the middleware does with a request. In order:
 *  1. Foreign hosts are left alone — except that a foreign host's internal
 *     path of a known city is marked as a city page: Next runs the middleware
 *     a second time for a rewrite's destination, on the internal host
 *     (localhost:3000/showcase/<city>/…), and that pass must say again what
 *     the first one said, or the render never hears it. Derived from the
 *     path, never from a header a client could send.
 *  2. The internal /showcase/<city>/… path is never served under its own
 *     name on a public host: it moves to its city host, so Google sees one
 *     URL per page. An unknown city there falls through to a real 404.
 *  3. The bare domain moves to www (unchanged behaviour).
 *  4. A city host: Next's own files pass; its allowed APIs pass; any other
 *     API moves to www; everything else is rewritten to its city segment.
 *  5. An unknown psy* host goes to the city directory on www (/psy), any
 *     other subdomain to the same path on www — both TEMPORARILY (307): the
 *     city registry grows, and a permanent redirect cached by a browser would
 *     keep sending a future city's host away.
 * A redirect always lands where no rule redirects again (one hop, no loop).
 */
export function routeRequest(input: {
  host: string | null | undefined;
  pathname: string;
  search?: string;
}): HostRouting {
  const { pathname } = input;
  const search = input.search ?? "";
  const host = classifyHost(input.host);

  const internal = parseInternalShowcasePath(pathname);
  if (host.kind === "foreign") {
    return internal && isShowcaseCityKey(internal.cityKey)
      ? { action: "next", cityKey: internal.cityKey }
      : { action: "next" };
  }
  if (internal && isShowcaseCityKey(internal.cityKey)) {
    return {
      action: "redirect",
      location: `${absoluteShowcaseUrl(internal.cityKey, internal.publicPath)}${search}`,
      status: 308,
    };
  }

  if (host.kind === "apex") {
    return { action: "redirect", location: canonicalSiteUrl(`${pathname}${search}`), status: 308 };
  }
  if (host.kind === "canonical" || (internal && host.kind === "city")) return { action: "next" };

  if (host.kind === "city") {
    if (pathname.startsWith("/_next/") || pathname.startsWith("/__next")) {
      return { action: "next" };
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return isCityHostApi(pathname)
        ? { action: "next" }
        : { action: "redirect", location: canonicalSiteUrl(`${pathname}${search}`), status: 308 };
    }
    return {
      action: "rewrite",
      pathname: internalShowcasePath(host.cityKey, pathname),
      cityKey: host.cityKey,
    };
  }

  if (host.kind === "unknown-city") {
    return { action: "redirect", location: canonicalSiteUrl(SHOWCASE_HUB_PATH), status: 307 };
  }
  // other-subdomain
  return { action: "redirect", location: canonicalSiteUrl(`${pathname}${search}`), status: 307 };
}
