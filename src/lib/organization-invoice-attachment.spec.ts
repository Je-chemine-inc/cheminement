import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

/**
 * Spec 002 phase 7 — storing an organization's form on an invoice. A form
 * replaced or removed on a draft is deleted (it never left); once the invoice
 * was issued the old file stays (it may have gone out). What goes out is
 * checked byte for byte.
 */

const INV = new mongoose.Types.ObjectId("0123456789abcdef0123456e");
const ORG = new mongoose.Types.ObjectId("0123456789abcdef01234567");
const OLD_FILE = new mongoose.Types.ObjectId("0123456789abcdef01234500");
const NEW_FILE = new mongoose.Types.ObjectId("0123456789abcdef01234501");
const ADMIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-10-01T13:00:00Z");
const BYTES = Buffer.from("%PDF-1.4 formulaire");

const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  // The invoice as findOneAndUpdate({ new: false }) returns it: before the write.
  before: null as Record<string, unknown> | null,
  update: vi.fn(),
  create: vi.fn(),
  fileDelete: vi.fn(async () => ({})),
  file: null as { data: unknown } | null,
  language: "fr",
}));

vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/OrganizationInvoice", () => {
  const findById = () => {
    const doc = h.invoice ? { ...h.invoice } : null;
    return Object.assign(Promise.resolve(doc), {
      select: () => ({ lean: async () => doc }),
      lean: async () => doc,
    });
  };
  return {
    default: {
      findById,
      findOneAndUpdate: (filter: unknown, update: unknown, opts: unknown) => {
        h.update(filter, update, opts);
        return { lean: async () => h.before };
      },
    },
  };
});
vi.mock("@/models/StoredFile", () => ({
  default: {
    create: h.create,
    deleteOne: h.fileDelete,
    findOne: () => ({ select: () => ({ lean: async () => h.file }) }),
  },
}));
vi.mock("@/models/Organization", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => ({ language: h.language }) }) }) },
}));

import {
  attachInvoiceForm,
  formForDelivery,
  readInvoiceForm,
  removeInvoiceForm,
} from "@/lib/organization-invoice-attachment";
import { linesFingerprint, sha256Hex } from "@/lib/organization-invoice-form";

const lines = [
  {
    appointmentId: new mongoose.Types.ObjectId("0123456789abcdef01234561"),
    sessionDate: new Date("2026-09-10T12:00:00Z"),
    patientFullName: "Léa Roy",
    professionalName: "Sam Pro",
    amountCents: 9000,
  },
];
const attached = (over: Record<string, unknown> = {}) => ({
  fileId: OLD_FILE,
  fileName: "ancien.pdf",
  size: BYTES.length,
  sha256: sha256Hex(BYTES),
  scanStatus: "clean",
  linesFingerprint: linesFingerprint(lines as never),
  uploadedAt: NOW,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.invoice = { _id: INV, status: "draft", lines, organizationId: ORG, number: undefined };
  h.before = { ...h.invoice, attachment: attached() };
  h.create.mockImplementation(async () => ({ _id: NEW_FILE }));
  h.file = { data: BYTES };
  h.language = "fr";
});

const attach = () =>
  attachInvoiceForm({ invoiceId: String(INV), bytes: BYTES, originalName: "Formulaire Léa.pdf", scanStatus: "skipped", byUserId: ADMIN, now: NOW });

describe("attachInvoiceForm", () => {
  it("stores the PDF as a private organization form and records what it was filled in from", async () => {
    const r = await attach();
    expect(r.ok).toBe(true);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "organization-form", fileType: "application/pdf", scanStatus: "skipped", data: BYTES }),
    );
    const [filter, update] = h.update.mock.calls[0] as [Record<string, unknown>, { $set: { attachment: Record<string, unknown> } }];
    expect(filter).toMatchObject({ _id: INV, status: { $in: ["draft", "issuing", "sent", "overdue", "partially_paid"] } });
    expect(update.$set.attachment).toMatchObject({
      fileId: NEW_FILE,
      fileName: "Formulaire Léa.pdf",
      sha256: sha256Hex(BYTES),
      scanStatus: "skipped",
      linesFingerprint: linesFingerprint(lines as never),
      uploadedAt: NOW,
    });
    expect(String(update.$set.attachment.uploadedBy)).toBe(ADMIN);
  });

  it("replacing on a draft deletes the old file: it never left", async () => {
    await attach();
    expect(h.fileDelete).toHaveBeenCalledWith({ _id: OLD_FILE, kind: "organization-form" });
  });

  it("replacing once the invoice was issued keeps the old file: it may have gone out", async () => {
    h.invoice = { ...h.invoice, status: "sent" };
    h.before = { ...h.invoice, attachment: attached() };
    expect((await attach()).ok).toBe(true);
    expect(h.fileDelete).not.toHaveBeenCalled();
  });

  it("an invoice paid or voided meanwhile: the new file goes, nothing changes", async () => {
    h.before = null;
    expect(await attach()).toMatchObject({ ok: false, status: 409, code: "CHANGED_MEANWHILE" });
    expect(h.fileDelete).toHaveBeenCalledWith({ _id: NEW_FILE, kind: "organization-form" });
  });

  it("refuses an invoice that can no longer be sent, before storing anything", async () => {
    h.invoice = { ...h.invoice, status: "paid" };
    expect(await attach()).toMatchObject({ status: 409, code: "NOT_EDITABLE" });
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("removeInvoiceForm", () => {
  it("on a draft the file is deleted", async () => {
    expect((await removeInvoiceForm({ invoiceId: String(INV) })).ok).toBe(true);
    expect(h.update.mock.calls[0][1]).toEqual({ $unset: { attachment: 1 } });
    expect(h.fileDelete).toHaveBeenCalledWith({ _id: OLD_FILE, kind: "organization-form" });
  });

  it("on an issued invoice the file stays", async () => {
    h.before = { ...h.invoice, status: "overdue", attachment: attached() };
    expect((await removeInvoiceForm({ invoiceId: String(INV) })).ok).toBe(true);
    expect(h.fileDelete).not.toHaveBeenCalled();
  });

  it("refuses on an invoice that can no longer be sent", async () => {
    h.before = null;
    h.invoice = { ...h.invoice, status: "void" };
    expect(await removeInvoiceForm({ invoiceId: String(INV) })).toMatchObject({ code: "NOT_EDITABLE" });
  });
});

describe("formForDelivery", () => {
  const inv = (over: Record<string, unknown> = {}) =>
    ({ lines, number: "JCO-2026-000007", attachment: attached(), ...over }) as never;

  it("hands over the bytes, logged under the fixed outgoing name", async () => {
    const r = await formForDelivery(inv(), { requiresOwnForm: true, language: "fr" }, false);
    expect(r).toMatchObject({
      ok: true,
      withoutOwnForm: false,
      form: { log: { fileId: OLD_FILE, fileName: "JCO-2026-000007-formulaire.pdf", size: BYTES.length, sha256: sha256Hex(BYTES) } },
    });
  });

  it("refuses a missing file, or one whose bytes changed", async () => {
    h.file = null;
    expect(await formForDelivery(inv(), { requiresOwnForm: true, language: "fr" }, false)).toEqual({
      ok: false,
      code: "OWN_FORM_UNAVAILABLE",
    });
    h.file = { data: Buffer.from("autre chose") };
    expect(await formForDelivery(inv(), { requiresOwnForm: true, language: "fr" }, false)).toEqual({
      ok: false,
      code: "OWN_FORM_UNAVAILABLE",
    });
  });

  it("decides again on the invoice as it is now", async () => {
    expect(await formForDelivery(inv({ attachment: undefined }), { requiresOwnForm: true, language: "fr" }, false)).toEqual({
      ok: false,
      code: "OWN_FORM_MISSING",
    });
    expect(await formForDelivery(inv({ attachment: undefined }), { requiresOwnForm: true, language: "fr" }, true)).toEqual({
      ok: true,
      form: null,
      withoutOwnForm: true,
    });
  });
});

describe("readInvoiceForm", () => {
  it("gives the billing admin the form under the name it goes out with", async () => {
    h.invoice = { ...h.invoice, number: "JCO-2026-000007", attachment: attached() };
    h.language = "en";
    const r = await readInvoiceForm(String(INV));
    expect(r?.fileName).toBe("JCO-2026-000007-form.pdf");
    expect(r?.bytes.toString()).toBe(BYTES.toString());
  });

  it("nothing when no form is attached", async () => {
    expect(await readInvoiceForm(String(INV))).toBeNull();
  });
});
