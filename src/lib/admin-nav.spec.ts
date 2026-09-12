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
      { url: "/admin/dashboard/showcases", requires: "manageProfessionals" as const },
    ],
  },
  { title: "Facturation", items: [{ url: "/admin/dashboard/organizations", requires: "manageBilling" as const }] },
];

const urls = (s: typeof sections) => s.map((x) => [x.title, x.items.map((i) => i.url)]);

describe("visibleNavSections", () => {
  it("drops the billing screens for an admin without billing rights", () => {
    expect(urls(visibleNavSections(sections, { manageBilling: false, manageProfessionals: true }))).toEqual([
      ["Tableau de bord", ["/admin/dashboard"]],
      ["Gestion", ["/admin/dashboard/patients", "/admin/dashboard/showcases"]],
    ]);
  });

  it("drops the showcase screen for an admin who does not manage professionals", () => {
    expect(urls(visibleNavSections(sections, { manageBilling: true, manageProfessionals: false }))).toEqual([
      ["Tableau de bord", ["/admin/dashboard"]],
      ["Gestion", ["/admin/dashboard/patients", "/admin/dashboard/billing", "/admin/dashboard/accounting"]],
      ["Facturation", ["/admin/dashboard/organizations"]],
    ]);
  });

  it("keeps everything for an admin with both rights", () => {
    expect(visibleNavSections(sections, { manageBilling: true, manageProfessionals: true })).toEqual(sections);
  });

  it("does not change the menu it was given", () => {
    visibleNavSections(sections, { manageBilling: false, manageProfessionals: false });
    expect(sections[1].items).toHaveLength(4);
  });
});
