import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildReceiptNumber } from "@/lib/receipt-number";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Profile from "@/models/Profile";
import {
  buildFiscalReceiptPdfBuffer,
  buildFiscalReceiptInputFromPopulatedAppointment,
} from "@/lib/receipt-pdf";
import { getPlatformContactInfo } from "@/lib/platform-contact";
import { formatStandardAddressBlock } from "@/lib/format-platform-contact";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const appointmentId = searchParams.get("appointmentId");
    const inline = searchParams.get("inline") === "1";

    if (!appointmentId) {
      return NextResponse.json(
        { error: "Appointment ID is required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const appointment = await Appointment.findById(appointmentId)
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName email");

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    const client = appointment.clientId as unknown as {
      _id: { toString: () => string };
      firstName: string;
      lastName: string;
      email: string;
    };
    const professional = appointment.professionalId as unknown as {
      _id: { toString: () => string };
      firstName: string;
      lastName: string;
      email: string;
    };
    const clientId = client._id.toString();
    const professionalId = professional._id.toString();

    if (
      session.user.id !== clientId &&
      session.user.id !== professionalId &&
      session.user.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Not authorized to access this receipt" },
        { status: 403 },
      );
    }

    // Admins may produce a manual receipt for any appointment regardless of
    // payment/closure state (operational override for support cases). Clients
    // and professionals may only download once payment is actually settled.
    // We intentionally do NOT fall back to `fiscalReceiptIssuedAt`: that flag is
    // stamped at closure for EVERY billable session regardless of whether money
    // was collected — Interac still awaiting transfer, a card/PAD charge that
    // was skipped/failed, or an ACSS debit still in flight all leave it set
    // while payment.status is "pending"/"failed". Honoring it would serve the
    // official fiscal PDF before payment is confirmed (hidden-until-paid rule),
    // for every method. `payment.status === "paid"` is the single source of
    // truth; a refund flips it away from "paid", so refunds are covered too.
    const isAdmin = session.user.role === "admin";
    const canDownload =
      isAdmin ||
      (appointment.payment.status === "paid" && !appointment.payment.disputed);

    if (!canDownload) {
      return NextResponse.json(
        {
          error:
            "Reçu non disponible : paiement en attente ou séance non clôturée.",
        },
        { status: 400 },
      );
    }

    const profile = await Profile.findOne({
      userId: professional._id,
    }).lean();
    const license = profile?.license?.trim();
    const specialty = profile?.specialty?.trim();

    const pdfInput = buildFiscalReceiptInputFromPopulatedAppointment(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appointment.toObject() as any,
      license,
      specialty,
    );

    // Platform coordinates (mandatory on receipts) — pulled live from Admin settings.
    const platformContact = await getPlatformContactInfo();
    pdfInput.platformAddressLines = formatStandardAddressBlock(
      platformContact.physicalAddress,
      platformContact.companyName,
    );
    pdfInput.platformPhoneNumber = platformContact.phoneNumber;
    pdfInput.platformSupportEmail = platformContact.supportEmail;

    // Professionals never see the client's gross amount or the platform fee.
    const audience =
      session.user.id === professionalId
        ? "professional"
        : session.user.role === "admin"
          ? "admin"
          : "client";

    const pdfBuffer = buildFiscalReceiptPdfBuffer({ ...pdfInput, audience });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${buildReceiptNumber(appointmentId)}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Generate receipt error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate receipt",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
