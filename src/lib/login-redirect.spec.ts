import { describe, it, expect } from "vitest";
import { loginRedirectFor } from "@/lib/login-redirect";

describe("loginRedirectFor", () => {
  it("keeps the page and its query, so an email's ?tab=awaiting survives login", () => {
    expect(
      loginRedirectFor("/professional/dashboard/proposals", "?tab=awaiting"),
    ).toBe(
      "/login?callbackUrl=%2Fprofessional%2Fdashboard%2Fproposals%3Ftab%3Dawaiting",
    );
  });

  it("carries every private area", () => {
    expect(loginRedirectFor("/client/dashboard")).toBe(
      "/login?callbackUrl=%2Fclient%2Fdashboard",
    );
    expect(loginRedirectFor("/admin")).toBe("/login?callbackUrl=%2Fadmin");
  });

  it("carries nothing else", () => {
    expect(loginRedirectFor("")).toBe("/login");
    expect(loginRedirectFor("/professionals-list")).toBe("/login");
    expect(loginRedirectFor("/pay", "?x=1")).toBe("/login");
  });
});
