import { describe, it, expect } from "vitest";
import {
  canonicalSiteUrl,
  classifyHost,
  cityHostFor,
  isShowcasePagePath,
  normalizeHost,
  parseShowcaseHost,
  routeRequest,
  showcasePageUrl,
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

describe("addresses", () => {
  it("puts a professional's page on www", () => {
    expect(showcasePageUrl("amel-sassi")).toBe("https://www.jechemine.ca/amel-sassi");
    expect(canonicalSiteUrl("book")).toBe("https://www.jechemine.ca/book");
    expect(cityHostFor("troisrivieres")).toBe("psytroisrivieres.jechemine.ca");
  });

  it("recognises a path that can only be a professional's page", () => {
    for (const path of ["/amel-sassi", "/amel-sassi-2", "/zz"]) expect(isShowcasePagePath(path), path).toBe(true);
    for (const path of ["/", "/contact", "/book", "/login", "/amel-sassi/", "/a/b", "/Amel-Sassi", "/robots.txt", "/_next", "/api"]) {
      expect(isShowcasePagePath(path), path).toBe(false);
    }
  });
});

describe("routeRequest", () => {
  it("moves the bare domain to www, path and query kept", () => {
    expect(routeRequest({ host: "jechemine.ca", pathname: "/book", search: "?a=1" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/book?a=1",
      status: 308,
    });
  });

  it("lets www and internal hosts through, marking a professional's page", () => {
    for (const host of ["www.jechemine.ca", "127.0.0.1:3000", "", "localhost:3100"]) {
      expect(routeRequest({ host, pathname: "/appointment" })).toEqual({ action: "next", showcasePage: false });
      expect(routeRequest({ host, pathname: "/amel-sassi" })).toEqual({ action: "next", showcasePage: true });
    }
  });

  it("sends every city host to the same path on www, temporarily", () => {
    expect(routeRequest({ host: "psymascouche.jechemine.ca", pathname: "/amel-sassi", search: "?utm_source=x" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/amel-sassi?utm_source=x",
      status: 307,
    });
    expect(routeRequest({ host: "psymascouche.jechemine.ca", pathname: "/" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/",
      status: 307,
    });
    expect(routeRequest({ host: "psyatlantis.jechemine.ca", pathname: "/sassi" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/sassi",
      status: 307,
    });
  });

  it("sends any other subdomain to www, temporarily", () => {
    expect(routeRequest({ host: "blog.jechemine.ca", pathname: "/x", search: "?q=1" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/x?q=1",
      status: 307,
    });
    expect(routeRequest({ host: "staging.jechemine.ca", pathname: "/appointment" })).toEqual({
      action: "redirect",
      location: "https://www.jechemine.ca/appointment",
      status: 307,
    });
  });

  it("lands every redirect where no rule redirects again (one hop, never a loop)", () => {
    const hosts = ["www.jechemine.ca", "jechemine.ca", "psymascouche.jechemine.ca", "psyatlantis.jechemine.ca", "blog.jechemine.ca"];
    const paths = ["/", "/amel-sassi", "/api/x", "/showcase/mascouche/sassi", "/psy"];
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
