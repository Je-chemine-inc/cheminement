import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SHOWCASE_CITY_HEADER, routeRequest } from "@/lib/showcase-hosts";

/**
 * Canonical host, the showcase city hosts, and the x-pathname header the
 * professional pages read.
 *
 * The site answered on four addresses at once — jechemine.ca and
 * www.jechemine.ca, each over http and https — with no redirect between them.
 * Search engines can treat those as separate duplicate sites and split the
 * ranking, and anything indexed under the bare domain does not count toward
 * the Search Console property, which is registered as https://www.jechemine.ca.
 *
 * Since spec 003 the showcase pages also live on one host per Quebec city
 * (psymascouche.jechemine.ca/sassi). Such a request is rewritten to the
 * internal segment /showcase/<city>/…; the rules live in routeRequest
 * (lib/showcase-hosts.ts), where they are tested.
 *
 * Every rule keys on the HOST ONLY, and only for hosts we recognise. That is
 * what makes a loop impossible: a redirect target is never itself redirected.
 * If Apache does not forward the original Host (it would arrive as
 * 127.0.0.1:3000) nothing fires at all — a missed redirect is an SEO
 * annoyance, a redirect loop is an outage.
 *
 * Deliberately NOT handled here: http -> https. Behind the proxy the connection
 * is genuinely http, and Next fills in `x-forwarded-proto: http` itself, so a
 * scheme-based rule here loops forever whenever Apache does not override that
 * header. HSTS (already sent, with preload) forces https in browsers; doing it
 * properly for the remaining clients belongs in the Apache vhost.
 */
export function middleware(request: NextRequest) {
  const decision = routeRequest({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });

  if (decision.action === "redirect") {
    // 308 (a move to the canonical URL) keeps the method and is permanent,
    // which is what tells a crawler to transfer the ranking rather than treat
    // it as a temporary detour. 307 is for hosts we do not serve (yet).
    return NextResponse.redirect(decision.location, decision.status);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // Only this middleware may say a request is for a city host.
  requestHeaders.delete(SHOWCASE_CITY_HEADER);

  if (decision.action === "rewrite") {
    // Same origin, new path: an internal rewrite, the query string kept.
    requestHeaders.set(SHOWCASE_CITY_HEADER, decision.cityKey);
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  // Next runs this middleware again for a rewrite's destination, on the
  // internal host: keep telling the render it is a city page.
  if (decision.cityKey) requestHeaders.set(SHOWCASE_CITY_HEADER, decision.cityKey);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Runs on pages, not on build assets or images served straight from public/.
  // The Google Search Console verification file must stay reachable untouched.
  // robots.txt and sitemap.xml do go through: each city host serves its own.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|html)$).*)",
  ],
};
