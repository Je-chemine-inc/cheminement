import { describe, it, expect } from "vitest";
import {
  absoluteShowcaseUrl,
  classifyHost,
  cityHostFor,
  internalShowcasePath,
  normalizeHost,
  parseInternalShowcasePath,
  parseShowcaseHost,
  routeRequest,
} from "@/lib/showcase-hosts";

describe("classifyHost", () => {
  it("recognises the site's own hosts", () => {
    expect(classifyHost("www.jechemine.ca")).toEqual({ kind: "canonical" });
    expect(classifyHost("jechemine.ca")).toEqual({ kind: "apex" });
    expect(classifyHost("psymascouche.jechemine.ca")).toEqual({ kind: "city", cityKey: "mascouche" });
  });

  it("normalises case, port and a trailing dot", () => {
    expect(normalizeHost(" PsyMascouche.JeChemine.ca.:3100 ")).toBe("psymascouche.jechemine.ca");
    expect(parseShowcaseHost("PsyMascouche.jechemine.ca:443")).toBe("mascouche");
  });

  it("tells an unknown city from any other subdomain", () => {
    expect(classifyHost("psyatlantis.jechemine.ca")).toEqual({ kind: "unknown-city" });
    expect(classifyHost("mail.jechemine.ca")).toEqual({ kind: "other-subdomain" });
    expect(classifyHost("psy-mascouche.jechemine.ca")).toEqual({ kind: "other-subdomain" });
    // Retired on 2026-09-13: now just another subdomain.
    expect(classifyHost("staging.jechemine.ca")).toEqual({ kind: "other-subdomain" });
  });

  it("never mistakes a lookalike domain for ours", () => {
    expect(classifyHost("psymascouche.jechemine.ca.evil.com")).toEqual({ kind: "foreign" });
    expect(classifyHost("psymascouchejechemine.ca")).toEqual({ kind: "foreign" });
    expect(classifyHost("evil-jechemine.ca")).toEqual({ kind: "foreign" });
    expect(parseShowcaseHost("psymascouche.jechemine.ca.evil.com")).toBeNull();
  });

  it("treats the internal and header-less hosts as foreign", () => {
    expect(classifyHost("127.0.0.1:3000")).toEqual({ kind: "foreign" });
    expect(classifyHost("localhost:3100")).toEqual({ kind: "foreign" });
    expect(classifyHost("")).toEqual({ kind: "foreign" });
    expect(classifyHost(null)).toEqual({ kind: "foreign" });
  });
});

describe("URLs", () => {
  it("builds city hosts and absolute URLs", () => {
    expect(cityHostFor("troisrivieres")).toBe("psytroisrivieres.jechemine.ca");
    expect(absoluteShowcaseUrl("mascouche")).toBe("https://psymascouche.jechemine.ca/");
    expect(absoluteShowcaseUrl("mascouche", "sassi")).toBe("https://psymascouche.jechemine.ca/sassi");
  });

  it("maps public paths to the internal segment and back", () => {
    const cases: Array<[string, string]> = [
      ["/", "/showcase/mascouche"],
      ["/sassi", "/showcase/mascouche/sassi"],
      ["/specialite/anxiete", "/showcase/mascouche/specialite/anxiete"],
      ["/robots.txt", "/showcase/mascouche/robots-txt"],
      ["/sitemap.xml", "/showcase/mascouche/sitemap-xml"],
    ];
    for (const [publicPath, internal] of cases) {
      expect(internalShowcasePath("mascouche", publicPath)).toBe(internal);
      expect(parseInternalShowcasePath(internal)).toEqual({ cityKey: "mascouche", publicPath });
    }
    expect(parseInternalShowcasePath("/showcase")).toBeNull();
    expect(parseInternalShowcasePath("/showcases/x")).toBeNull();
    expect(parseInternalShowcasePath("/book/showcase/x")).toBeNull();
  });
});

describe("routeRequest", () => {
  const city = "psymascouche.jechemine.ca";

  it("moves the bare domain to www, path and query kept", () => {
    expect(routeRequest({ host: "jechemine.ca", pathname: "/book", search: "?a=1" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/book?a=1",
      status: 308,
    });
  });

  it("leaves www and internal hosts alone", () => {
    for (const host of ["www.jechemine.ca", "127.0.0.1:3000", "", "localhost:3100"]) {
      expect(routeRequest({ host, pathname: "/appointment" })).toEqual({ action: "next" });
    }
  });

  it("rewrites a city host to its internal segment", () => {
    expect(routeRequest({ host: city, pathname: "/" })).toEqual({
      action: "rewrite",
      pathname: "/showcase/mascouche",
      cityKey: "mascouche",
    });
    expect(routeRequest({ host: city, pathname: "/sassi", search: "?utm_source=x" })).toEqual({
      action: "rewrite",
      pathname: "/showcase/mascouche/sassi",
      cityKey: "mascouche",
    });
    expect(routeRequest({ host: city, pathname: "/robots.txt" })).toEqual({
      action: "rewrite",
      pathname: "/showcase/mascouche/robots-txt",
      cityKey: "mascouche",
    });
    expect(routeRequest({ host: city, pathname: "/sitemap.xml" })).toEqual({
      action: "rewrite",
      pathname: "/showcase/mascouche/sitemap-xml",
      cityKey: "mascouche",
    });
  });

  it("marks a known city's internal path on the internal host as a city page (Next's second middleware pass)", () => {
    expect(routeRequest({ host: "localhost:3100", pathname: "/showcase/mascouche/sassi" })).toEqual({
      action: "next",
      cityKey: "mascouche",
    });
    expect(routeRequest({ host: "127.0.0.1:3000", pathname: "/showcase/mascouche" })).toEqual({
      action: "next",
      cityKey: "mascouche",
    });
    expect(routeRequest({ host: "127.0.0.1:3000", pathname: "/showcase/atlantis" })).toEqual({ action: "next" });
  });

  it("lets a city host reach Next's files and its own APIs, and sends any other API to www", () => {
    for (const pathname of [
      "/_next/data/abc/x.json",
      "/api/showcase/sassi/slots",
      "/api/files/0123456789abcdef01234567",
      "/api/auth/session",
      "/api/auth/csrf",
    ]) {
      expect(routeRequest({ host: city, pathname })).toEqual({ action: "next" });
    }
    expect(routeRequest({ host: city, pathname: "/api/admin/users", search: "?x=1" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/api/admin/users?x=1",
      status: 308,
    });
    expect(routeRequest({ host: city, pathname: "/api/auth/signin" })).toMatchObject({ action: "redirect" });
  });

  it("never serves the internal path under its own name", () => {
    for (const host of ["www.jechemine.ca", city, "psyquebec.jechemine.ca", "staging.jechemine.ca"]) {
      expect(routeRequest({ host, pathname: "/showcase/mascouche/sassi", search: "?a=1" })).toEqual({
        action: "redirect",
        location: "https://psymascouche.jechemine.ca/sassi?a=1",
        status: 308,
      });
    }
    expect(routeRequest({ host: "www.jechemine.ca", pathname: "/showcase/mascouche/robots-txt" })).toEqual({
      action: "redirect",
      location: "https://psymascouche.jechemine.ca/robots.txt",
      status: 308,
    });
    // An unknown city falls through to the segment's real 404.
    expect(routeRequest({ host: "www.jechemine.ca", pathname: "/showcase/atlantis/x" })).toEqual({ action: "next" });
  });

  it("sends a host it does not serve to www, temporarily (the registry grows; a cached 308 would outlive that)", () => {
    expect(routeRequest({ host: "psyatlantis.jechemine.ca", pathname: "/sassi" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/psy",
      status: 307,
    });
    expect(routeRequest({ host: "blog.jechemine.ca", pathname: "/x", search: "?q=1" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/x?q=1",
      status: 307,
    });
    // staging.jechemine.ca was retired on 2026-09-13; the wildcard record still answers for it.
    expect(routeRequest({ host: "staging.jechemine.ca", pathname: "/appointment" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/appointment",
      status: 307,
    });
  });

  it("sends the bare domain's internal path straight to its city host", () => {
    expect(routeRequest({ host: "jechemine.ca", pathname: "/showcase/mascouche/sassi" })).toEqual({
      action: "redirect",
      location: "https://psymascouche.jechemine.ca/sassi",
      status: 308,
    });
  });

  it("lands every redirect where no rule redirects again (one hop, never a loop)", () => {
    const hosts = ["www.jechemine.ca", "jechemine.ca", city, "psyatlantis.jechemine.ca", "blog.jechemine.ca", "staging.jechemine.ca"];
    const paths = ["/", "/sassi", "/api/x", "/showcase/mascouche/sassi", "/showcase/atlantis/x", "/psy"];
    for (const host of hosts) {
      for (const pathname of paths) {
        const first = routeRequest({ host, pathname });
        if (first.action !== "redirect") continue;
        const target = new URL(first.location);
        const second = routeRequest({ host: target.host, pathname: target.pathname, search: target.search });
        expect(second.action, `${host}${pathname} → ${first.location}`).not.toBe("redirect");
      }
    }
  });
});
