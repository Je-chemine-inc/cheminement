import { describe, it, expect } from "vitest";
import { visibleNavSections } from "@/lib/admin-nav";

const sections = [
  { title: "Tableau de bord", items: [{ url: "/admin/dashboard" }] },
  {
    title: "Gestion",
    items: [
      { url: "/admin/dashboard/patients" },
      { url: "/admin/dashboard/billing", requires: "manageBilling" as const },
      { url: "/admin/dashboard/accounting", requires: "manageBilling" as const },
    ],
  },
  { title: "Facturation", items: [{ url: "/admin/dashboard/organizations", requires: "manageBilling" as const }] },
];

const urls = (s: typeof sections) => s.map((x) => [x.title, x.items.map((i) => i.url)]);

describe("visibleNavSections", () => {
  it("drops the billing screens for an admin without billing rights", () => {
    expect(urls(visibleNavSections(sections, { manageBilling: false }))).toEqual([
      ["Tableau de bord", ["/admin/dashboard"]],
      ["Gestion", ["/admin/dashboard/patients"]],
    ]);
  });

  it("keeps everything for a billing admin", () => {
    expect(visibleNavSections(sections, { manageBilling: true })).toEqual(sections);
  });

  it("does not change the menu it was given", () => {
    visibleNavSections(sections, { manageBilling: false });
    expect(sections[1].items).toHaveLength(3);
  });
});
