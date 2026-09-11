import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { serializeInvoice } from "@/lib/organization-invoice-serialize";
import { linesFingerprint } from "@/lib/organization-invoice-form";

/**
 * What the admin invoice screen receives. The organization's form: its state,
 * never the stored file's id or hash (they stay server-side).
 */

const FILE = new mongoose.Types.ObjectId("0123456789abcdef01234500");
const lines = [
  {
    appointmentId: new mongoose.Types.ObjectId("0123456789abcdef01234561"),
    sessionDate: new Date("2026-09-10T12:00:00Z"),
    patientFullName: "Léa Roy",
    professionalName: "Sam Pro",
    amountCents: 9000,
  },
];
const invoice = (over: Record<string, unknown> = {}) =>
  ({
    _id: new mongoose.Types.ObjectId(),
    kind: "session",
    organizationId: new mongoose.Types.ObjectId(),
    status: "sent",
    lines,
    totalCents: 9000,
    paidCents: 0,
    balanceCents: 9000,
    payments: [],
    paymentEvents: [],
    sendLog: [],
    attachment: {
      fileId: FILE,
      fileName: "Formulaire.pdf",
      size: 2048,
      sha256: "secret-hash",
      scanStatus: "skipped",
      linesFingerprint: linesFingerprint(lines as never),
      uploadedAt: new Date("2026-09-11T12:00:00Z"),
    },
    ...over,
  }) as never;

const org = { name: "PAE Desjardins", requiresOwnForm: true, formNotes: "Formulaire PAE-12" };

describe("serializeInvoice — the organization's form", () => {
  it("shows the form's state and the organization's notes, never the file id or hash", () => {
    const s = serializeInvoice(invoice(), org as never);
    expect(s.requiresOwnForm).toBe(true);
    expect(s.formNotes).toBe("Formulaire PAE-12");
    expect(s.attachmentEditable).toBe(true);
    expect(s.attachment).toEqual({
      fileName: "Formulaire.pdf",
      size: 2048,
      scanStatus: "skipped",
      uploadedAt: new Date("2026-09-11T12:00:00Z"),
      stale: false,
      sent: false,
    });
    const json = JSON.stringify(s);
    expect(json).not.toContain("secret-hash");
    expect(json).not.toContain(String(FILE));
  });

  it("says when the lines changed since it was attached", () => {
    const s = serializeInvoice(invoice({ lines: [{ ...lines[0], amountCents: 12000 }] }), org as never);
    expect(s.attachment?.stale).toBe(true);
  });

  it("says when this very file already went out, and how each send went", () => {
    const s = serializeInvoice(
      invoice({
        sendLog: [
          { at: new Date(), to: ["a@b.ca"], kind: "sent", withoutOwnForm: true },
          { at: new Date(), to: ["a@b.ca"], kind: "resent", attachment: { fileId: FILE, fileName: "x", size: 1, sha256: "h" } },
        ],
      }),
      org as never,
    );
    expect(s.attachment?.sent).toBe(true);
    expect(s.sendLog.map((l) => [l.withForm, l.withoutOwnForm])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it("a paid invoice's form can no longer change", () => {
    expect(serializeInvoice(invoice({ status: "paid" }), org as never).attachmentEditable).toBe(false);
  });
});

describe("serializeInvoice — refunds", () => {
  const PAY = new mongoose.Types.ObjectId("0123456789abcdef01234591");
  const refunded = () =>
    invoice({
      status: "paid",
      totalCents: 9000,
      paidCents: 4000,
      creditedCents: 5000,
      balanceCents: 0,
      payments: [
        { paymentId: PAY, amountCents: 9000, refundedCents: 5000, method: "card", source: "stripe", receivedAt: new Date(), reference: "pi_1", externalRef: "pi_1" },
        { amountCents: 100, method: "cheque", source: "admin", receivedAt: new Date() },
      ],
      refunds: [
        {
          refundId: new mongoose.Types.ObjectId(),
          paymentId: PAY,
          amountCents: 5000,
          creditCents: 5000,
          owed: "no_longer",
          via: "stripe",
          reason: "Séance annulée",
          status: "succeeded",
          requestKey: "secret-request-key",
          stripeRefundId: "re_secret",
          refundedAt: new Date(),
          at: new Date(),
          byUserId: new mongoose.Types.ObjectId(),
        },
      ],
    });

  it("each payment says what can still be refunded, and how", () => {
    const s = serializeInvoice(refunded(), org as never);
    expect(s.creditedCents).toBe(5000);
    expect(s.payments[0]).toMatchObject({ id: String(PAY), refundableCents: 4000, refundVia: "stripe", refundBlocked: null });
    // A row from before rows had ids cannot be refunded from the screen.
    expect(s.payments[1]).toMatchObject({ id: null, refundVia: "outside", refundBlocked: "NO_ID" });
  });

  it("shows the refunds, never Stripe's refund id or the request key", () => {
    const s = serializeInvoice(refunded(), org as never);
    expect(s.refunds[0]).toMatchObject({ amountCents: 5000, creditCents: 5000, owed: "no_longer", via: "stripe", status: "succeeded", reason: "Séance annulée" });
    const json = JSON.stringify(s);
    expect(json).not.toContain("re_secret");
    expect(json).not.toContain("secret-request-key");
  });
});
