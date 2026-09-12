# ADR-0003 — Per-city showcase hosts on the same application

**Status:** Accepted — 2026-09-12
**Context:** [spec 003](../../../specs/003-professional-showcase/spec.md)

## Context

The owner wants one host per Quebec city (`psymascouche.jechemine.ca/sassi`). Production is a single
Next.js standalone process behind Apache on a cPanel server. Certificates come from AutoSSL (one per
hostname, validated over http), DNS is at Namecheap with three A records, the locale is a cookie, and
the middleware only redirected the bare domain to www.

## Decision

1. **Same application, host-based rewrite.** `src/middleware.ts` applies `routeRequest()`
   (`src/lib/showcase-hosts.ts`, pure and tested): a known city host is rewritten to the internal
   segment `src/app/showcase/[cityKey]/…`. No second deployment, no second process.
2. **Host only, never the scheme.** Behind Apache the app cannot tell http from https, and a
   scheme-based rule loops (debt-map 2026-09-07). Every redirect lands on a URL that no rule redirects
   again — pinned by a spec.
3. **One URL per page.** The internal path redirects (308) to its city host whatever host asked for
   it, and www's robots.txt disallows it. Each showcase page sets an absolute canonical on its city
   host, because the root layout's relative canonical resolves against the rewritten path.
4. **Hosts we do not serve redirect temporarily (307).** An unknown `psy…` host goes to the city directory on www (`/psy`),
   any other subdomain to the same path on www. The city registry grows, and a permanent redirect
   cached by a browser would outlive the day a city is added.
5. **The registry is data, not DNS.** Cities are the Quebec entries of `src/data/canadaCities.ts`
   (host label: the name without accents, spaces or punctuation). Adding a city is a code change; the
   server answers for every name through a wildcard DNS record, a wildcard certificate and a wildcard
   vhost ([HANDOFF §11](../../ops/HANDOFF.md)).
6. **City hosts reach only what they need.** Next's assets, `/api/showcase/*`, `/api/files/*` and the
   session probe answer on the city host, since the CSP only allows same-origin requests; every other
   API redirects to www. Sign-in, dashboards, the booking funnel and checkout stay on www, where the
   session cookie lives.
7. **Per-host robots.txt and sitemap.xml are route handlers** (`robots-txt/`, `sitemap-xml/`): Next's
   metadata files serve one host's root and receive no route params.
8. **Kill switch** `PlatformSettings.showcaseEnabled`, off by default. The middleware runs on the edge
   without the database, so the city layout and each route handler enforce it.

## Consequences

- Browsers keep cookies per host: sign-in, cookie consent and the language choice do not carry over
  from www to a city host, and a first visit is in French. Links from a city host to the rest of the
  platform are absolute to www.
- The internal segment must never start with an underscore: Next 16 treats `_folders` as private and
  never routes them.
- Next's image optimizer fetches local images without headers or cookies, so a photo shown on a public
  page must be stored as a public file kind.
- Before any city host resolves in production: a DNS provider API for the DNS-01 challenge, the
  wildcard certificate with its renewal hook, and the wildcard vhost. Until then the code is inert.
- Search Console needs a Domain property to cover every host.
