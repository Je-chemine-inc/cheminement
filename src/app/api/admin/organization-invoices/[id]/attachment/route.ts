import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import { requireBillingAdmin } from "@/lib/organization-admin";
import { prepareAndScanUpload } from "@/lib/upload-pipeline";
import { ORG_FORM_MAX_BYTES } from "@/lib/organization-invoice-form";
import {
  attachInvoiceForm,
  readInvoiceForm,
  removeInvoiceForm,
} from "@/lib/organization-invoice-attachment";
import { serializeInvoice } from "@/lib/organization-invoice-serialize";
import type { InvoiceResult } from "@/lib/organization-invoice";

/**
 * The organization's own claim form on an invoice (spec 002, phase 7). Billing
 * admins only — never through /api/files, which any signed-in user can read.
 *
 *   POST   multipart `file` (one PDF, 5 MB) + `confirmNoClinical=true`
 *   GET    download it, under the name it goes out with
 *   DELETE take it off
 */

type Ctx = { params: Promise<{ id: string }> };

const fail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status });

async function respond(result: InvoiceResult) {
  if (!result.ok) return fail(result.status, result.code, result.error);
  const inv = result.invoice.toObject();
  const org = await Organization.findById(inv.organizationId)
    .select("name requiresOwnForm formNotes")
    .lean();
  return NextResponse.json({ invoice: serializeInvoice(inv, org) });
}

async function invoiceId(ctx: Ctx) {
  const { id } = await ctx.params;
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const id = await invoiceId(ctx);
    if (!id) return fail(400, "INVALID_ID", "Invalid id");

    // Refuse an oversized body before reading it (multipart adds a little).
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > ORG_FORM_MAX_BYTES + 64 * 1024) {
      return fail(413, "FORM_TOO_LARGE", "The form must be a PDF of 5 MB or less.");
    }
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail(400, "FILE_REQUIRED", "Choose the PDF to attach.");
    // The organization sees this document: the admin confirms it holds no
    // reason for consultation, no nature of services, no therapy type.
    if (form?.get("confirmNoClinical") !== "true") {
      return fail(400, "CONFIRMATION_REQUIRED", "Confirm that the form holds no clinical information.");
    }
    if (file.type !== "application/pdf") return fail(400, "FORM_NOT_PDF", "The form must be a PDF.");
    if (file.size > ORG_FORM_MAX_BYTES) {
      return fail(413, "FORM_TOO_LARGE", "The form must be a PDF of 5 MB or less.");
    }

    const prepared = await prepareAndScanUpload(file, {
      allowedTypes: ["application/pdf"],
      maxSize: ORG_FORM_MAX_BYTES,
    });
    if (!prepared.ok) {
      return prepared.status === 422
        ? fail(422, "FORM_INFECTED", "The file was rejected by the antivirus.")
        : fail(400, "FORM_NOT_PDF", "The file is not a readable PDF.");
    }
    // It leaves for a third party: a scanner that could not answer is a refusal.
    if (prepared.value.scanStatus === "error") {
      return fail(503, "SCAN_UNAVAILABLE", "The antivirus could not check the file. Try again in a moment.");
    }

    return respond(
      await attachInvoiceForm({
        invoiceId: id,
        bytes: prepared.value.buffer,
        originalName: prepared.value.fileName,
        scanStatus: prepared.value.scanStatus,
        byUserId: gate.session.user.id,
      }),
    );
  } catch (error) {
    console.error("Admin attach organization form error:", error);
    return fail(500, "FAILED", "Failed to attach the form");
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const id = await invoiceId(ctx);
    if (!id) return fail(400, "INVALID_ID", "Invalid id");
    const found = await readInvoiceForm(id);
    if (!found) return fail(404, "NOT_FOUND", "No form is attached to this invoice.");
    return new NextResponse(new Uint8Array(found.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(found.bytes.length),
        "Content-Disposition": `attachment; filename="${found.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error("Admin download organization form error:", error);
    return fail(500, "FAILED", "Failed to read the form");
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;
  try {
    const id = await invoiceId(ctx);
    if (!id) return fail(400, "INVALID_ID", "Invalid id");
    return respond(await removeInvoiceForm({ invoiceId: id }));
  } catch (error) {
    console.error("Admin remove organization form error:", error);
    return fail(500, "FAILED", "Failed to remove the form");
  }
}
