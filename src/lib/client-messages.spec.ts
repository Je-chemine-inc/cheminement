import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import fr from "../../messages/fr.json";
import { SHOWCASE_PAGE_CLIENT_NAMESPACES, clientMessagesFor } from "@/lib/client-messages";

const ROOT = join(__dirname, "..", "..");

/** Client components rendered on a professional's page itself (besides the global providers). */
const SHOWCASE_PAGE_CLIENT_COMPONENTS = [
  "src/components/showcase/ShowcaseBeacon.tsx",
  "src/components/showcase/ShowcaseWaitlistForm.tsx",
  "src/components/showcase/vitrine/VitrineBooking.tsx",
  "src/components/showcase/vitrine/VitrineHeader.tsx",
  "src/components/showcase/vitrine/VitrineMotion.tsx",
];

function namespacesIn(source: string): Set<string> {
  const used = new Set<string>();
  for (const match of source.matchAll(/(?:useTranslations|getTranslations)\(\s*"([^"]+)"/g)) {
    used.add(match[1].split(".")[0]);
  }
  return used;
}

describe("clientMessagesFor", () => {
  it("gives the site's pages the whole bundle", () => {
    expect(clientMessagesFor(fr, false)).toBe(fr);
  });

  it("gives a professional's page only the namespaces its client components read", () => {
    const picked = clientMessagesFor(fr, true);
    expect(Object.keys(picked).sort()).toEqual([...SHOWCASE_PAGE_CLIENT_NAMESPACES].sort());
    expect(JSON.stringify(picked).length).toBeLessThan(JSON.stringify(fr).length / 20);
  });

  it("lists every namespace the global providers' components translate with", () => {
    const providers = readFileSync(join(ROOT, "src/components/providers.tsx"), "utf8");
    const imported = [...providers.matchAll(/import\s*\{[^}]*\}\s*from\s*"@\/components\/([\w/-]+)"/g)].map(
      (match) => match[1],
    );
    expect(imported.length).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const component of imported) {
      const source = readFileSync(join(ROOT, "src/components", `${component}.tsx`), "utf8");
      for (const namespace of namespacesIn(source)) used.add(namespace);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const namespace of used) {
      expect(SHOWCASE_PAGE_CLIENT_NAMESPACES as readonly string[], `${namespace} is missing on professional pages`).toContain(namespace);
    }
  });

  it("lists every namespace the professional page's own client components translate with", () => {
    for (const file of SHOWCASE_PAGE_CLIENT_COMPONENTS) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source.trimStart().startsWith('"use client"'), `${file} is a client component`).toBe(true);
      for (const namespace of namespacesIn(source)) {
        expect(
          SHOWCASE_PAGE_CLIENT_NAMESPACES as readonly string[],
          `${namespace} (${file}) is missing on professional pages`,
        ).toContain(namespace);
      }
    }
  });

  it("renders the 404 of a marked path with server-side translations only", () => {
    const notFound = readFileSync(join(ROOT, "src/app/not-found.tsx"), "utf8");
    expect(notFound).not.toContain('"use client"');
    expect(notFound).not.toContain("useTranslations");
  });
});
