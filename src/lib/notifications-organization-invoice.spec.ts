import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 002 phase 7 — the invoice email to an organization carries its own
 * claim form as a second PDF, under a fixed name: never the name the admin
 * uploaded it under (it may hold a patient's name or an internal note).
 */

type Sent = {
  to: string;
  tags?: string[];
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

const h = vi.hoisted(() => ({
  sent: [] as Sent[],
  settings: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/email-transport", () => ({
  sendMail: vi.fn(async (opts: Sent) => {
    h.sent.push(opts);
    return { backend: "smtp", messageId: "test-id" };
  }),
  resolveFromAddress: () => "support@jechemine.ca",
  emailTransportStatus: () => ({ configured: true }),
}));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/email-template-registry", () => ({
  getEmailTemplate: async () => {
    throw new Error("no template row");
  },
  renderTemplate: (s: string) => s,
}));
vi.mock("@/lib/interac-deposit-email", () => ({ getInteracDepositEmail: async () => "paiement@jechemine.ca" }));
vi.mock("@/models/User", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
vi.mock("@/models/PlatformSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/models/PlatformSettings")>();
  const chain = { select: () => chain, lean: async () => h.settings };
  return { ...actual, default: { findOne: () => chain } };
});

const INVOICE_PDF = Buffer.from("%PDF invoice");
const FORM_PDF = Buffer.from("%PDF formulaire");

async function sendInvoice(over: Record<string, unknown> = {}) {
  const mod = await import("@/lib/notifications");
  return mod.sendOrganizationInvoiceEmail({
    to: "factu@pae.ca",
    kind: "session",
    organizationName: "PAE Desjardins",
    number: "JCO-2026-000007",
    totalCents: 9000,
    balanceCents: 9000,
    dueAt: new Date("2026-10-31T12:00:00Z"),
    periodKey: null,
    pdf: INVOICE_PDF,
    locale: "fr",
    ...over,
  });
}

beforeEach(() => {
  // getEmailSettings caches at module scope: a fresh module per case.
  vi.resetModules();
  h.sent = [];
  h.settings = {
    adminAlertEmail: "equipe@jechemine.ca",
    emailSettings: {
      enabled: true,
      templates: {},
      branding: { primaryColor: "#000", secondaryColor: "#111", companyName: "Je chemine", footerText: "" },
    },
  };
});

describe("sendOrganizationInvoiceEmail — the organization's own form", () => {
  it("attaches the form as a second PDF under a fixed name, and says so", async () => {
    expect(await sendInvoice({ formPdf: FORM_PDF })).toBe(true);
    const [mail] = h.sent;
    expect(mail.attachments?.map((a) => a.filename)).toEqual([
      "JCO-2026-000007.pdf",
      "JCO-2026-000007-formulaire.pdf",
    ]);
    expect(Buffer.compare(mail.attachments![1].content, FORM_PDF)).toBe(0);
    expect(mail.attachments![1].contentType).toBe("application/pdf");
    expect(mail.html).toContain("Le formulaire demandé par votre organisme est également joint.");
    expect(mail.text).toContain("La facture et le formulaire de votre organisme sont joints");
  });

  it("names it in the organization's language", async () => {
    await sendInvoice({ formPdf: FORM_PDF, locale: "en" });
    expect(h.sent[0].attachments?.[1].filename).toBe("JCO-2026-000007-form.pdf");
    expect(h.sent[0].html).toContain("The form your organization asked for is also attached.");
  });

  it("without a form: the invoice alone, worded as before", async () => {
    await sendInvoice();
    const [mail] = h.sent;
    expect(mail.attachments?.map((a) => a.filename)).toEqual(["JCO-2026-000007.pdf"]);
    expect(mail.text).toContain("Le document est joint à ce courriel.");
    expect(mail.html).not.toContain("formulaire");
  });
});

describe("sendOrganizationRefundEmail", () => {
  const send = async (over: Record<string, unknown> = {}) => {
    const mod = await import("@/lib/notifications");
    return mod.sendOrganizationRefundEmail({
      to: "factu@pae.ca",
      organizationName: "PAE Desjardins",
      number: "JCO-2026-000007",
      amountCents: 5000,
      via: "card",
      pending: false,
      balanceCents: 0,
      payUrl: null,
      locale: "fr",
      ...over,
    });
  };

  it("says how much went back and how, under its own email type", async () => {
    await send();
    const [mail] = h.sent;
    expect(mail.tags).toEqual(["organization_refund"]);
    expect(mail.html).toContain("50,00 $");
    expect(mail.html).toContain("carte qui a servi au paiement");
    expect(mail.html).toContain("Rien ne reste à régler");
  });

  it("when money is owed again, gives the balance and the pay link", async () => {
    await send({ balanceCents: 5000, payUrl: "https://x/org-pay?token=t" });
    expect(h.sent[0].html).toContain("Il reste 50,00 $ à régler");
    expect(h.sent[0].html).toContain("https://x/org-pay?token=t");
  });

  it("a refund made outside the platform, in English", async () => {
    await send({ via: "outside", locale: "en" });
    expect(h.sent[0].html).toContain("made outside the platform");
  });
});

describe("sendAdminOrganizationInvoicesReview — drafts waiting for a form", () => {
  const review = async (needsOwnForm: boolean) => {
    const mod = await import("@/lib/notifications");
    return mod.sendAdminOrganizationInvoicesReview({
      items: [{ organizationName: "PAE Desjardins", kind: "session", sessions: 1, totalCents: 9000, needsOwnForm }],
    });
  };

  it("says which drafts wait for the organization's form, and why nothing leaves", async () => {
    await review(true);
    expect(h.sent[0].html).toContain("formulaire de l’organisme à joindre");
    expect(h.sent[0].html).toContain("rien ne leur part, même automatiquement");
  });

  it("says nothing about a form when none is needed", async () => {
    await review(false);
    expect(h.sent[0].html).not.toContain("formulaire");
  });
});
