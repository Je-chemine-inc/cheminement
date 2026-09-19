import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression pins for the « la demande est perdue » report (2026-09-18).
 *
 * An admin assigned a request directly to a professional. The pro got the
 * generic « Nouvelle demande de rendez-vous » email, whose button opened the
 * first tab of the proposals page, « Proposées pour vous ». A direct
 * assignment is already accepted, so it is never listed there: the pro found
 * an empty list. It waits in « À planifier ».
 */

const h = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject?: string; html?: string; text?: string }>,
}));

vi.mock("@/lib/email-transport", () => ({
  sendMail: vi.fn(async (opts: { to: string; subject?: string; html?: string; text?: string }) => {
    h.sent.push(opts);
    return { backend: "smtp", messageId: "test-id" };
  }),
  resolveFromAddress: () => "support@jechemine.ca",
  emailTransportStatus: () => ({ configured: true }),
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));

vi.mock("@/models/PlatformSettings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/models/PlatformSettings")>();
  const chain = {
    select: () => chain,
    lean: async () => ({ emailSettings: { enabled: true, templates: {} } }),
  };
  return { ...actual, default: { findOne: () => chain } };
});

const base = {
  professionalName: "Julie Gagnon",
  professionalEmail: "pro@example.com",
  clientName: "Marie Tremblay",
  clientEmail: "client@example.com",
  type: "video" as const,
};

beforeEach(() => {
  vi.resetModules();
  h.sent = [];
  process.env.NEXTAUTH_URL = "https://www.jechemine.ca";
});

describe("sendProfessionalAssignedEmail", () => {
  it("says the client is assigned and its button opens « À planifier »", async () => {
    const mod = await import("@/lib/notifications");
    await mod.sendProfessionalAssignedEmail(base);

    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0];
    expect(mail.to).toBe("pro@example.com");
    expect(mail.subject).toContain("Un client vous a été assigné");
    expect(mail.subject).toContain("Marie Tremblay");
    expect(mail.html).toContain("À planifier");
    expect(mail.html).toContain(
      "https://www.jechemine.ca/professional/dashboard/proposals?tab=awaiting",
    );
    expect(mail.text).toContain(
      "https://www.jechemine.ca/professional/dashboard/proposals?tab=awaiting",
    );
    // Not the generic « new request » wording that sent the pro to accept it.
    expect(mail.subject).not.toContain("Nouvelle demande");
  });

  it("writes in English for an English-speaking pro", async () => {
    const mod = await import("@/lib/notifications");
    await mod.sendProfessionalAssignedEmail({ ...base, locale: "en" });
    expect(h.sent[0].subject).toContain("A client was assigned to you");
    expect(h.sent[0].html).toContain("To Schedule");
  });

  it("the path is the tab the proposals page opens from ?tab=", async () => {
    const mod = await import("@/lib/notifications");
    expect(mod.PROFESSIONAL_TO_SCHEDULE_PATH).toBe(
      "/professional/dashboard/proposals?tab=awaiting",
    );
  });
});
