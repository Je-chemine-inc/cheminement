import { describe, it, expect } from "vitest";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";

/**
 * FR and EN must carry the same keys (AGENTS.md §6, bilingual lockstep). A key
 * present in one file only renders as its raw key name for the other language.
 *
 * KNOWN_GAPS lists the drift that predates this spec; it may only shrink.
 */
const KNOWN_GAPS = new Set(["Auth.memberSignup.reviewPhone"]);

type Messages = { [key: string]: string | Messages | Messages[] | unknown };

function keysOf(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix.slice(0, -1)];
  return Object.entries(value as Messages).flatMap(([k, v]) =>
    v && typeof v === "object" ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("messages lockstep", () => {
  const frKeys = new Set(keysOf(fr));
  const enKeys = new Set(keysOf(en));

  it("has every French key in English and every English key in French", () => {
    const onlyFr = [...frKeys].filter((k) => !enKeys.has(k) && !KNOWN_GAPS.has(k));
    const onlyEn = [...enKeys].filter((k) => !frKeys.has(k) && !KNOWN_GAPS.has(k));
    expect({ onlyFr, onlyEn }).toEqual({ onlyFr: [], onlyEn: [] });
  });

  it("keeps the list of known gaps honest", () => {
    for (const key of KNOWN_GAPS) {
      expect(frKeys.has(key) && enKeys.has(key), `${key} is fixed: remove it from KNOWN_GAPS`).toBe(false);
    }
  });

  it("never leaves a showcase string empty", () => {
    const namespaces = Object.keys(fr).filter((ns) => ns.startsWith("Showcase"));
    expect(namespaces.length).toBeGreaterThan(0);
    for (const [lang, messages] of [["fr", fr], ["en", en]] as const) {
      for (const ns of namespaces) {
        const walk = (value: unknown, path: string) => {
          if (typeof value === "string") {
            expect(value.trim(), `${lang}:${path}`).not.toBe("");
          } else if (value && typeof value === "object") {
            for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
          }
        };
        walk((messages as Record<string, unknown>)[ns], ns);
      }
    }
  });
});
