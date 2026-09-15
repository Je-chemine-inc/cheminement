import { APEX_HOST, CANONICAL_HOST, SITE_URL } from "@/lib/site-url";
import { SHOWCASE_HOST_PREFIX, isShowcaseCityKey } from "@/lib/showcase-cities";
import { isValidShowcaseSlug } from "@/lib/showcase-slug";

/**
 * Which host a request came in on, what the middleware does about it, and the
 * address of a professional's page (spec 003).
 *
 * A professional's page lives on www: www.jechemine.ca/<slug>, served by
 * src/app/[proSlug]. Until 2026-09-15 the pages lived on one host per city
 * (psymascouche.jechemine.ca/sassi); the owner then chose a single address on
 * www. The wildcard DNS record, its certificate and the city registry stay for
 * a later use, and such a host now sends its visitor to the same path on www.
 *
 * Everything here keys on the HOST, never on the scheme: behind Apache the
 * connection is plain http and a scheme-based rule loops forever (debt-map
 * 2026-09-07). Pure, so the rules are tested without a server.
 */

/**
 * Request header the middleware sets on a path that can only be a
 * professional's page — and strips from every other request, so a client
 * cannot set it. The root layout reads it to send such a page only the
 * messages its client components use (src/lib/client-messages.ts).
 */
export const SHOWCASE_PAGE_HEADER = "x-showcase-page";

export type HostKind =
  | { kind: "canonical" }
  | { kind: "apex" }
  /** psy<city>.jechemine.ca for a city of the registry (kept for a later use). */
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

/** The city a host names, or null. */
export function parseShowcaseHost(raw: string | null | undefined): string | null {
  const kind = classifyHost(raw);
  return kind.kind === "city" ? kind.cityKey : null;
}

/** A city's own host name (not served since 2026-09-15; kept for a later use). */
export function cityHostFor(cityKey: string): string {
  return `${SHOWCASE_HOST_PREFIX}${cityKey}.${APEX_HOST}`;
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Absolute URL on the canonical host. */
export function canonicalSiteUrl(path = "/"): string {
  return `${SITE_URL}${withLeadingSlash(path)}`;
}

/** The public address of a professional's page. */
export function showcasePageUrl(slug: string): string {
  return canonicalSiteUrl(`/${slug}`);
}

/**
 * Whether a path can only be a professional's page: a single segment shaped
 * like a slug that no route of the site reserves. It may still be a 404.
 */
export function isShowcasePagePath(pathname: string): boolean {
  const match = /^\/([^/]+)$/.exec(pathname);
  return match !== null && isValidShowcaseSlug(match[1]);
}

export type HostRouting =
  /** `showcasePage`: the path can only be a professional's page (see isShowcasePagePath). */
  | { action: "next"; showcasePage: boolean }
  /** 308: a permanent move to the canonical URL. 307: a host we do not serve
   *  (now) — temporary, so browsers do not cache it and a host can return. */
  | { action: "redirect"; location: string; status: 307 | 308 };

/**
 * What the middleware does with a request:
 *  1. www and foreign hosts go through.
 *  2. The bare domain moves to www, permanently (unchanged behaviour).
 *  3. Every other *.jechemine.ca host — a city host too — goes to the same
 *     path on www, temporarily: psymascouche.jechemine.ca/amel-sassi lands on
 *     www.jechemine.ca/amel-sassi.
 * A redirect always lands on www, where no rule redirects again (one hop, no loop).
 */
export function routeRequest(input: {
  host: string | null | undefined;
  pathname: string;
  search?: string;
}): HostRouting {
  const host = classifyHost(input.host);
  const target = canonicalSiteUrl(`${input.pathname}${input.search ?? ""}`);
  switch (host.kind) {
    case "canonical":
    case "foreign":
      return { action: "next", showcasePage: isShowcasePagePath(input.pathname) };
    case "apex":
      return { action: "redirect", location: target, status: 308 };
    default:
      return { action: "redirect", location: target, status: 307 };
  }
}
