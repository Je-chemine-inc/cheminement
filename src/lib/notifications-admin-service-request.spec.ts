import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression pins for the "on ne reçoit pas les emails de nouvelles demandes"
 * incident (2026-09-09).
 *
 * The alert was tagged with the CLIENT's email type,
 * `service_request_onboarding` — the one Admin → Settings labels "Courriel de
 * bienvenue (formulaire de demande)". Turning that off to stop a client email
 * would also have silenced the team's own new-demande alerts, with nothing in
 * the logs to say so. It also made the two indistinguishable in the logs, which
 * is what made the incident hard to diagnose.
 */

const h = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; tags?: string[] }>,
  settings: null as Record<string, unknown> | null,
  template: null as Record<string, string> | null,
}));

vi.mock("@/lib/email-transport", () => ({
  sendMail: vi.fn(async (opts: { to: string; tags?: string[] }) => {
    h.sent.push(opts);
    return { backend: "smtp", messageId: "test-id" };
  }),
  resolveFromAddress: () => "support@jechemine.ca",
  emailTransportStatus: () => ({ configured: true }),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));

vi.mock("@/lib/email-template-registry", () => ({
  // Production has ZERO adminNewServiceRequest rows, so the real code takes the
  // hardcoded fallback. Throwing here reproduces that exactly.
  getEmailTemplate: async () => {
    if (!h.template) throw new Error("no template row");
    return h.template;
  },
  renderTemplate: (s: string) => s,
}));

vi.mock("@/models/User", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

vi.mock("@/models/PlatformSettings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/models/PlatformSettings")>();
  const chain = {
    select: () => chain,
    lean: async () => h.settings,
  };
  return { ...actual, default: { findOne: () => chain } };
});

const BRANDING = {
  primaryColor: "#000",
  secondaryColor: "#111",
  companyName: "Je chemine",
  footerText: "",
};

function settingsWith(templates: Record<string, unknown>) {
  return {
    adminAlertEmail: "support@jechemine.ca",
    emailSettings: { enabled: true, templates, branding: BRANDING },
  };
}

async function callAlert() {
  const mod = await import("@/lib/notifications");
  await mod.sendAdminNewServiceRequestAlert({
    clientName: "Marie Tremblay",
    clientEmail: "marie@example.com",
    bookingFor: "self",
    motifs: ["Anxiété"],
    appointmentId: "abc123",
  });
}

beforeEach(() => {
  // getEmailSettings caches at module scope, so each case needs a fresh module.
  vi.resetModules();
  h.sent = [];
  h.template = null;
  h.settings = settingsWith({});
});


describe("sendAdminNewServiceRequestAlert", () => {
  it("sends under its own email type, not the client's", async () => {
    await callAlert();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("support@jechemine.ca");
    expect(h.sent[0].tags).toEqual(["admin_new_service_request"]);
    expect(h.sent[0].tags).not.toContain("service_request_onboarding");
  });

  it("still reaches the team when the CLIENT welcome email is disabled", async () => {
    // The incident scenario: an admin switches off "Courriel de bienvenue
    // (formulaire de demande)". That must not silence the team's alert.
    h.settings = settingsWith({
      service_request_onboarding: { enabled: false, subject: "x" },
    });
    await callAlert();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].tags).toEqual(["admin_new_service_request"]);
  });

  it("is silenced only by its own toggle", async () => {
    h.settings = settingsWith({
      admin_new_service_request: { enabled: false, subject: "x" },
    });
    await callAlert();
    expect(h.sent).toHaveLength(0);
  });

  it("uses its own type on the admin-editable template path too", async () => {
    h.template = {
      subject: "Nouvelle demande",
      title: "Nouvelle demande",
      bodyHtml: "<p>corps</p>",
      ctaText: "Voir",
    };
    await callAlert();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].tags).toEqual(["admin_new_service_request"]);
  });

  it("warns loudly instead of returning silently when nobody is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      h.settings = {
        adminAlertEmail: "",
        emailSettings: { enabled: true, templates: {}, branding: BRANDING },
      };
      await callAlert();
      expect(h.sent).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("admin_new_service_request");
    } finally {
      warn.mockRestore();
    }
  });

  it("delivers to every configured recipient", async () => {
    h.settings = settingsWith({});
    h.settings.adminAlertEmail = "support@jechemine.ca, direction@jechemine.ca";
    await callAlert();
    expect(h.sent.map((s) => s.to)).toEqual([
      "support@jechemine.ca",
      "direction@jechemine.ca",
    ]);
    expect(h.sent.every((s) => s.tags?.[0] === "admin_new_service_request")).toBe(true);
  });
});
