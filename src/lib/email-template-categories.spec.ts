import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Admin → Settings renders email toggles grouped by `TEMPLATE_CATEGORIES`. A
 * toggle whose category is not in that list is silently never shown — which hid
 * the "Alertes administratives" and "Ressources" toggles (found 2026-09-11,
 * including the new-demande alert toggle announced two days earlier). Both
 * constants live inside the page component, so this reads the source.
 */
const PAGE = path.join(
  process.cwd(),
  "src/app/(privilaged)/admin/dashboard/settings/page.tsx",
);

describe("email template categories in Admin → Settings", () => {
  const source = readFileSync(PAGE, "utf8");
  const listed = new Set(
    [...(source.match(/const TEMPLATE_CATEGORIES = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
  const used = new Set([...source.matchAll(/category: "([^"]+)"/g)].map((m) => m[1]));

  it("finds both lists (guards against this test silently passing)", () => {
    expect(listed.size).toBeGreaterThan(3);
    expect(used.size).toBeGreaterThan(3);
  });

  it("lists every category a toggle uses, so no toggle is hidden", () => {
    const hidden = [...used].filter((c) => !listed.has(c));
    expect(hidden).toEqual([]);
  });
});
