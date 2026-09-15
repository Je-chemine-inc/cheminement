import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";

/**
 * The middleware with the real NextRequest/NextResponse, as the standalone
 * server calls it: the request URL is the internal one (127.0.0.1:3000) and
 * only the Host header says which site was asked for. The routing table
 * itself is covered in showcase-hosts.spec.ts; this checks it is applied.
 */
function run(host: string, path = "/", headers: Record<string, string> = {}) {
  return middleware(
    new NextRequest(`http://127.0.0.1:3000${path}`, { headers: { host, ...headers } }),
  );
}

describe("middleware", () => {
  it("keeps the apex redirect to www exactly as before", () => {
    const res = run("jechemine.ca", "/book?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://www.jechemine.ca/book?x=1");
  });

  it("sends a former city host to the same path on www, temporarily", () => {
    const res = run("psymascouche.jechemine.ca", "/amel-sassi?utm_source=x");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.jechemine.ca/amel-sassi?utm_source=x");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("sends the retired staging host to www like any other subdomain, temporarily", () => {
    const res = run("staging.jechemine.ca", "/professional/dashboard?x=1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.jechemine.ca/professional/dashboard?x=1");
  });

  it("passes www and the internal host through with x-pathname", () => {
    for (const host of ["www.jechemine.ca", "127.0.0.1:3000"]) {
      const res = run(host, "/professional/dashboard");
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/professional/dashboard");
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("tells the layout a request is for a professional's page, and never lets a client say so", () => {
    const page = run("www.jechemine.ca", "/amel-sassi");
    expect(page.headers.get("x-middleware-next")).toBe("1");
    expect(page.headers.get("x-middleware-request-x-showcase-page")).toBe("1");
    const site = run("www.jechemine.ca", "/contact", { "x-showcase-page": "1" });
    expect(site.headers.get("x-middleware-request-x-showcase-page")).toBeNull();
    expect(site.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-showcase-page,");
  });

  it("ignores the scheme header entirely (no redirect loop behind Apache)", () => {
    for (const proto of ["http", "https"]) {
      const www = run("www.jechemine.ca", "/amel-sassi", { "x-forwarded-proto": proto });
      expect(www.headers.get("location")).toBeNull();
      expect(run("psymascouche.jechemine.ca", "/", { "x-forwarded-proto": proto }).status).toBe(307);
    }
  });

  it("lets robots.txt, sitemap.xml and pages reach it, but not the Search Console file or images", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/robots.txt")).toBe(true);
    expect(matcher.test("/sitemap.xml")).toBe(true);
    expect(matcher.test("/amel-sassi")).toBe(true);
    expect(matcher.test("/googlee3c453eaae69bd1a.html")).toBe(false);
    expect(matcher.test("/Logo.png")).toBe(false);
    expect(matcher.test("/chem1.avif")).toBe(false);
    expect(matcher.test("/_next/static/chunks/a.js")).toBe(false);
  });
});
