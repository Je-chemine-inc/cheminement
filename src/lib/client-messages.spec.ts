import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import fr from "../../messages/fr.json";
import { CITY_HOST_CLIENT_NAMESPACES, clientMessagesFor } from "@/lib/client-messages";

const ROOT = join(__dirname, "..", "..");

describe("clientMessagesFor", () => {
  it("gives www pages the whole bundle", () => {
    expect(clientMessagesFor(fr, false)).toBe(fr);
  });

  it("gives a city host only the namespaces its client components read", () => {
    const picked = clientMessagesFor(fr, true);
    expect(Object.keys(picked).sort()).toEqual([...CITY_HOST_CLIENT_NAMESPACES].sort());
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
      for (const match of source.matchAll(/(?:useTranslations|getTranslations)\(\s*"([^"]+)"/g)) {
        used.add(match[1].split(".")[0]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const namespace of used) {
      expect(CITY_HOST_CLIENT_NAMESPACES as readonly string[], `${namespace} is missing on city hosts`).toContain(namespace);
    }
  });
});
