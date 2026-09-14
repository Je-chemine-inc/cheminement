import { describe, expect, it } from "vitest";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";
import { PROFESSIONAL_TITLES } from "@/data/professionalTitles";
import { PROFESSIONAL_ORDER_CODES, SHOWCASE_HISTORY_ACTIONS } from "@/lib/showcase-constants";
import { SHOWCASE_REGIONS } from "@/lib/showcase-cities";
import {
  SHOWCASE_LANGUAGE_KEYS,
  SHOWCASE_MODALITY_KEYS,
  SHOWCASE_THERAPY_TYPES,
} from "@/lib/showcase-public";
import { SHOWCASE_REQUIREMENTS } from "@/lib/showcase-workflow";
import { SHOWCASE_ADMIN_WORDED_KEYS, SHOWCASE_ERROR_CODES } from "@/lib/showcase-editor-types";
import { SHOWCASE_BADGES } from "@/lib/showcase-badges";

/**
 * The showcase screens build message keys from these lists (spec 003). A value
 * added to a list without its wording renders as a raw key, on a public page
 * too, so every value needs a string in both languages.
 */
type Tree = { [key: string]: unknown };

function stringAt(messages: unknown, path: string): string | undefined {
  let node: unknown = messages;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Tree)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const LISTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Showcase.titles", PROFESSIONAL_TITLES.map((title) => title.value)],
  ["Showcase.titlesPlural", PROFESSIONAL_TITLES.map((title) => title.value)],
  ["Showcase.regionIn", SHOWCASE_REGIONS.map((region) => region.key)],
  ["Showcase.orders", PROFESSIONAL_ORDER_CODES.filter((code) => code !== "other")],
  ["Showcase.modalities", SHOWCASE_MODALITY_KEYS],
  ["Showcase.languages", SHOWCASE_LANGUAGE_KEYS],
  ["Showcase.therapyTypes", SHOWCASE_THERAPY_TYPES],
  ["ShowcasePro.missing", SHOWCASE_REQUIREMENTS],
  ["ShowcasePro.errors", [...SHOWCASE_ERROR_CODES, "generic", "network"]],
  // A professional's page always exists, so their screen never says « not invited ».
  ["ShowcasePro.status", SHOWCASE_BADGES.filter((badge) => badge !== "notInvited")],
  ["ShowcaseAdmin.badges", SHOWCASE_BADGES],
  // Editor texts worded for the professional, and again for an admin (audience prop).
  ["ShowcasePro", SHOWCASE_ADMIN_WORDED_KEYS],
  ["ShowcaseAdmin.editor", SHOWCASE_ADMIN_WORDED_KEYS],
  ["ShowcaseAdmin.detail.history", SHOWCASE_HISTORY_ACTIONS],
];

const LANGUAGES = [
  ["fr", fr],
  ["en", en],
] as const;

describe("showcase messages", () => {
  for (const [prefix, values] of LISTS) {
    it(`has a wording for every value of ${prefix}`, () => {
      const missing: string[] = [];
      for (const [lang, messages] of LANGUAGES) {
        for (const value of values) {
          if (!stringAt(messages, `${prefix}.${value}`)) missing.push(`${lang}:${prefix}.${value}`);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it("keeps every showcase string readable by next-intl", () => {
    const problems: string[] = [];
    const check = (lang: string, path: string, value: string) => {
      let depth = 0;
      for (const char of value) {
        if (char === "{") depth++;
        if (char === "}") depth--;
        if (depth < 0) break;
      }
      if (depth !== 0) problems.push(`${lang}:${path} has unbalanced braces`);
      // next-intl reads angle brackets as rich-text tags.
      if (/[<>]/.test(value)) problems.push(`${lang}:${path} has an angle bracket`);
      // An apostrophe right before a brace or # quotes it.
      if (/'[{}#]/.test(value)) problems.push(`${lang}:${path} has an apostrophe before a syntax character`);
    };
    const walk = (lang: string, value: unknown, path: string) => {
      if (typeof value === "string") check(lang, path, value);
      else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) walk(lang, child, `${path}.${key}`);
      }
    };
    for (const [lang, messages] of LANGUAGES) {
      for (const ns of Object.keys(messages).filter((key) => key.startsWith("Showcase"))) {
        walk(lang, (messages as Tree)[ns], ns);
      }
    }
    expect(problems).toEqual([]);
  });
});
