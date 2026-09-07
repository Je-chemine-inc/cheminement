import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Canonical host + the x-pathname header the professional pages read.
 *
 * The site answered on four addresses at once — jechemine.ca and
 * www.jechemine.ca, each over http and https — with no redirect between them.
 * Search engines can treat those as separate duplicate sites and split the
 * ranking, and anything indexed under the bare domain does not count toward
 * the Search Console property, which is registered as https://www.jechemine.ca.
 *
 * This redirects on the HOST ONLY, and only for a host we explicitly list.
 * That is what makes a loop impossible: the target host is never itself in the
 * alias list, so the redirected request cannot match again. If Apache does not
 * forward the original Host (it would arrive as 127.0.0.1:3000) nothing fires
 * at all — a missed redirect is an SEO annoyance, a redirect loop is an outage.
 *
 * Deliberately NOT handled here: http -> https. Behind the proxy the connection
 * is genuinely http, and Next fills in `x-forwarded-proto: http` itself, so a
 * scheme-based rule here loops forever whenever Apache does not override that
 * header. HSTS (already sent, with preload) forces https in browsers; doing it
 * properly for the remaining clients belongs in the Apache vhost.
 */

const CANONICAL_HOST = "www.jechemine.ca";
/** Hosts that should move to the canonical one. Exact matches only. */
const ALIAS_HOSTS = new Set(["jechemine.ca"]);

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase().split(":")[0] ?? "";

  if (ALIAS_HOSTS.has(host)) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    // 308 keeps the method and is permanent, which is what tells a crawler to
    // transfer the ranking rather than treat this as a temporary detour.
    return NextResponse.redirect(url, 308);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Runs on pages, not on build assets or files served straight from public/.
  // The Google Search Console verification file must stay reachable untouched.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|html)$).*)",
  ],
};
