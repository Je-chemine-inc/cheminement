/**
 * The organization's own claim form on an invoice (spec 002, phase 7): storing
 * it, taking it off, reading it back, and handing it to the send path.
 *
 * Rules held here:
 *  - A form can change only while the invoice can still be sent or resent.
 *  - A form replaced or removed on a DRAFT is deleted: it never left. Once the
 *    invoice was issued, the old file is kept — it may already have gone out,
 *    and the send log points to it (Loi 25: the record of what was disclosed).
 *  - What goes out is decided again on the invoice as it is at send time, and
 *    the bytes must still hash to what was attached.
 *  - The file is a StoredFile of kind "organization-form": /api/files never
 *    serves it; only the billing-admin attachment route does.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Organization, { type IOrganization } from "@/models/Organization";
import OrganizationInvoice, { type IOrganizationInvoice } from "@/models/OrganizationInvoice";
import StoredFile from "@/models/StoredFile";
import type { InvoiceResult } from "@/lib/organization-invoice";
import {
  ORG_FORM_EDITABLE_STATUSES,
  decideFormForSend,
  isFormEditable,
  linesFingerprint,
  organizationFormFileName,
  sha256Hex,
  storedFileBytes,
} from "@/lib/organization-invoice-form";

const FORM_KIND = "organization-form";

const refuse = (status: 400 | 404 | 409, code: string, error: string): InvoiceResult => ({
  ok: false,
  status,
  code,
  error,
});

const notEditable = () =>
  refuse(409, "NOT_EDITABLE", "This invoice can no longer be sent: its form cannot change.");

async function deleteForm(fileId: unknown) {
  if (!fileId) return;
  await StoredFile.deleteOne({ _id: fileId, kind: FORM_KIND });
}

/** Attach (or replace) the form. The bytes were checked and scanned by the route. */
export async function attachInvoiceForm(args: {
  invoiceId: string;
  bytes: Buffer;
  originalName: string;
  scanStatus: "clean" | "skipped";
  byUserId: string;
  now?: Date;
}): Promise<InvoiceResult> {
  const now = args.now ?? new Date();
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(args.invoiceId).select("status lines").lean();
  if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
  if (!isFormEditable(inv.status)) return notEditable();

  const fileName = args.originalName.slice(0, 200) || "formulaire.pdf";
  const stored = await StoredFile.create({
    fileName,
    fileType: "application/pdf",
    fileSize: args.bytes.length,
    data: args.bytes,
    kind: FORM_KIND,
    uploadedBy: new mongoose.Types.ObjectId(args.byUserId),
    scanStatus: args.scanStatus,
  });
  const before = await OrganizationInvoice.findOneAndUpdate(
    { _id: inv._id, status: { $in: ORG_FORM_EDITABLE_STATUSES } },
    {
      $set: {
        attachment: {
          fileId: stored._id,
          fileName,
          size: args.bytes.length,
          sha256: sha256Hex(args.bytes),
          scanStatus: args.scanStatus,
          linesFingerprint: linesFingerprint(inv.lines),
          uploadedAt: now,
          uploadedBy: new mongoose.Types.ObjectId(args.byUserId),
        },
      },
    },
    { new: false },
  ).lean();
  if (!before) {
    // Paid, voided or sent meanwhile: the new file goes, nothing changed.
    await deleteForm(stored._id);
    return refuse(409, "CHANGED_MEANWHILE", "This invoice changed meanwhile.");
  }
  if (before.status === "draft") await deleteForm(before.attachment?.fileId);
  const updated = await OrganizationInvoice.findById(inv._id);
  return { ok: true, invoice: updated! };
}

/** Take the form off. On a draft its file is deleted; once issued it is kept. */
export async function removeInvoiceForm(args: { invoiceId: string }): Promise<InvoiceResult> {
  await connectToDatabase();
  const before = await OrganizationInvoice.findOneAndUpdate(
    {
      _id: args.invoiceId,
      status: { $in: ORG_FORM_EDITABLE_STATUSES },
      "attachment.fileId": { $exists: true },
    },
    { $unset: { attachment: 1 } },
    { new: false },
  ).lean();
  if (before) {
    if (before.status === "draft") await deleteForm(before.attachment?.fileId);
  } else {
    const inv = await OrganizationInvoice.findById(args.invoiceId).select("status").lean();
    if (!inv) return refuse(404, "NOT_FOUND", "Invoice not found");
    if (!isFormEditable(inv.status)) return notEditable();
  }
  const updated = await OrganizationInvoice.findById(args.invoiceId);
  return { ok: true, invoice: updated! };
}

/** The attached form for a billing admin to download, under its outgoing name. */
export async function readInvoiceForm(
  invoiceId: string,
): Promise<{ bytes: Buffer; fileName: string } | null> {
  await connectToDatabase();
  const inv = await OrganizationInvoice.findById(invoiceId)
    .select("attachment number organizationId")
    .lean();
  if (!inv?.attachment?.fileId) return null;
  const file = await StoredFile.findOne({ _id: inv.attachment.fileId, kind: FORM_KIND })
    .select("data")
    .lean();
  if (!file) return null;
  const org = await Organization.findById(inv.organizationId).select("language").lean();
  return {
    bytes: storedFileBytes(file.data),
    fileName: organizationFormFileName(inv.number, org?.language === "en" ? "en" : "fr"),
  };
}

export type FormDelivery =
  | {
      ok: true;
      form: {
        bytes: Buffer;
        log: { fileId: mongoose.Types.ObjectId; fileName: string; size: number; sha256: string };
      } | null;
      withoutOwnForm: boolean;
    }
  | { ok: false; code: "OWN_FORM_MISSING" | "OWN_FORM_STALE" | "OWN_FORM_UNAVAILABLE" };

/**
 * What goes out with this send — decided again on the invoice as it is now
 * (a form removed or replaced a moment ago counts), and checked byte for byte.
 */
export async function formForDelivery(
  inv: Pick<IOrganizationInvoice, "attachment" | "lines" | "number">,
  org: Pick<IOrganization, "requiresOwnForm" | "language">,
  withoutOwnForm: boolean,
): Promise<FormDelivery> {
  const decision = decideFormForSend({
    requiresOwnForm: Boolean(org.requiresOwnForm),
    attachment: inv.attachment,
    lines: inv.lines,
    withoutOwnForm,
  });
  if (decision.kind === "refuse") return { ok: false, code: decision.code };
  if (decision.kind !== "attach") {
    return { ok: true, form: null, withoutOwnForm: decision.kind === "without" };
  }
  const attachment = inv.attachment!;
  const file = await StoredFile.findOne({ _id: attachment.fileId, kind: FORM_KIND })
    .select("data")
    .lean();
  if (!file) return { ok: false, code: "OWN_FORM_UNAVAILABLE" };
  const bytes = storedFileBytes(file.data);
  if (sha256Hex(bytes) !== attachment.sha256) return { ok: false, code: "OWN_FORM_UNAVAILABLE" };
  return {
    ok: true,
    withoutOwnForm: false,
    form: {
      bytes,
      log: {
        fileId: attachment.fileId,
        fileName: organizationFormFileName(inv.number, org.language === "en" ? "en" : "fr"),
        size: bytes.length,
        sha256: attachment.sha256,
      },
    },
  };
}

/** A draft was deleted: its form never left, so it goes too. */
export async function discardUnsentForm(
  doc: { attachment?: { fileId?: unknown } | null } | null | undefined,
): Promise<void> {
  await deleteForm(doc?.attachment?.fileId);
}
