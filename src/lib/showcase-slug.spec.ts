import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { RESERVED_SHOWCASE_SLUGS, isValidShowcaseSlug } from "@/lib/showcase-slug";

const ROOT = join(__dirname, "..", "..");

/** The first path segment of every route of the site: src/app's folders, route groups opened. */
function topLevelRouteSegments(): string[] {
  const segments: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/^\(.+\)$/.test(entry.name)) walk(join(dir, entry.name));
      else if (!/^[[_@]/.test(entry.name)) segments.push(entry.name);
    }
  };
  walk(join(ROOT, "src/app"));
  return segments;
}

describe("professional page addresses (www.jechemine.ca/<slug>)", () => {
  it("serves the pages from a top-level segment", () => {
    expect(existsSync(join(ROOT, "src/app/[proSlug]/page.tsx"))).toBe(true);
  });

  it("reserves every top-level route of the site, so no slug hides a page", () => {
    const segments = topLevelRouteSegments();
    expect(segments).toEqual(expect.arrayContaining(["api", "contact", "login", "admin", "book", "la"]));
    const unreserved = segments.filter((segment) => isValidShowcaseSlug(segment));
    expect(unreserved, "add these to RESERVED_SHOWCASE_SLUGS").toEqual([]);
  });

  it("reserves every folder and extension-less file served from public/", () => {
    const names = readdirSync(join(ROOT, "public")).filter((name) => !name.includes("."));
    expect(names.filter((name) => isValidShowcaseSlug(name))).toEqual([]);
  });

  it("reserves the metadata file names", () => {
    for (const name of ["robots", "sitemap", "favicon", "opengraph-image", "icon", "manifest"]) {
      expect(RESERVED_SHOWCASE_SLUGS.has(name), name).toBe(true);
    }
  });

  it("accepts a full name and refuses anything that is not a plain lowercase slug", () => {
    expect(isValidShowcaseSlug("amel-sassi")).toBe(true);
    expect(isValidShowcaseSlug("amel-sassi-2")).toBe(true);
    for (const bad of ["", "a", "Amel-Sassi", "-sassi", "sassi-", "sa--ssi", "sa_ssi", "amel.sassi", "contact", "x".repeat(61)]) {
      expect(isValidShowcaseSlug(bad), bad).toBe(false);
    }
  });
});
