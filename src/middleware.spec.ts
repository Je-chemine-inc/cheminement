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

const rewriteOf = (res: Response) => {
  const header = res.headers.get("x-middleware-rewrite");
  return header ? new URL(header) : null;
};

describe("middleware", () => {
  it("rewrites a city host to its segment, query kept, and still sets x-pathname", () => {
    const res = run("psymascouche.jechemine.ca", "/sassi?utm_source=x");
    const target = rewriteOf(res);
    expect(target?.pathname).toBe("/showcase/mascouche/sassi");
    expect(target?.search).toBe("?utm_source=x");
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/sassi");
    expect(res.headers.get("location")).toBeNull();
  });

  it("serves each city its own robots.txt and sitemap.xml", () => {
    expect(rewriteOf(run("psymascouche.jechemine.ca", "/robots.txt"))?.pathname).toBe(
      "/showcase/mascouche/robots-txt",
    );
    expect(rewriteOf(run("psytroisrivieres.jechemine.ca", "/sitemap.xml"))?.pathname).toBe(
      "/showcase/troisrivieres/sitemap-xml",
    );
  });

  it("keeps the apex redirect to www exactly as before", () => {
    const res = run("jechemine.ca", "/book?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://www.jechemine.ca/book?x=1");
  });

  it("passes www, staging and the internal host through with x-pathname", () => {
    for (const host of ["www.jechemine.ca", "staging.jechemine.ca", "127.0.0.1:3000"]) {
      const res = run(host, "/professional/dashboard");
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/professional/dashboard");
      expect(rewriteOf(res)).toBeNull();
    }
  });

  it("moves the internal path to its city host", () => {
    const res = run("www.jechemine.ca", "/showcase/mascouche/sassi");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://psymascouche.jechemine.ca/sassi");
  });

  it("sends a host it does not serve to the city directory on www, temporarily", () => {
    const res = run("psyatlantis.jechemine.ca", "/sassi");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.jechemine.ca/psy");
  });

  it("keeps the city marker when Next runs the middleware again for the rewrite, from the path, not a sent value", () => {
    // What production does: the rewrite's destination re-enters the middleware on the internal host.
    const second = run("localhost:3100", "/showcase/mascouche", {
      "x-showcase-city": "laval",
      "x-forwarded-host": "psymascouche.jechemine.ca",
    });
    expect(second.headers.get("x-middleware-next")).toBe("1");
    expect(second.headers.get("x-middleware-request-x-showcase-city")).toBe("mascouche");
    const internalApi = run("127.0.0.1:3000", "/api/showcase/status", { "x-showcase-city": "mascouche" });
    expect(internalApi.headers.get("x-middleware-request-x-showcase-city")).toBeNull();
  });

  it("tells the layout a request is for a city host, and never lets a client say so", () => {
    const city = run("psymascouche.jechemine.ca", "/sassi", { "x-showcase-city": "laval" });
    expect(city.headers.get("x-middleware-request-x-showcase-city")).toBe("mascouche");
    const www = run("www.jechemine.ca", "/", { "x-showcase-city": "mascouche" });
    expect(www.headers.get("x-middleware-request-x-showcase-city")).toBeNull();
    expect(www.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-showcase-city,");
  });

  it("ignores the scheme header entirely (no redirect loop behind Apache)", () => {
    for (const proto of ["http", "https"]) {
      const city = run("psymascouche.jechemine.ca", "/", { "x-forwarded-proto": proto });
      expect(rewriteOf(city)?.pathname).toBe("/showcase/mascouche");
      const www = run("www.jechemine.ca", "/", { "x-forwarded-proto": proto });
      expect(www.headers.get("location")).toBeNull();
    }
  });

  it("lets robots.txt and sitemap.xml reach it, but not the Search Console file or images", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/robots.txt")).toBe(true);
    expect(matcher.test("/sitemap.xml")).toBe(true);
    expect(matcher.test("/sassi")).toBe(true);
    expect(matcher.test("/googlee3c453eaae69bd1a.html")).toBe(false);
    expect(matcher.test("/Logo.png")).toBe(false);
    expect(matcher.test("/chem1.avif")).toBe(false);
    expect(matcher.test("/_next/static/chunks/a.js")).toBe(false);
  });
});
