import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  calculatePlatformFee,
  calculateProfessionalPayout,
} from "@/lib/stripe";
import {
  roundMoney,
  SESSION_ACT_NATURE_VALUES,
  type SessionActNature,
} from "@/lib/session-closure";
import { parseAppointmentDate } from "@/lib/appointment-date";
import { runSessionClosureSideEffects } from "@/lib/session-post-closure";

// Headroom for Mongo + the receipt PDF / SMTP that the side effects run.
export const maxDuration = 30;

/**
 * Admin-only manual invoice/receipt generator (launched from the professional
 * schedule). Creates — or, when launched from an existing appointment, reuses —
 * a billable appointment, then runs the SAME post-closure pipeline as a normal
 * session so the golden rule holds:
 *
 *  - action "request" → payment stays pending → a clean payment-request email
 *    (+ SMS) with the Card/Interac options is sent; NO receipt yet.
 *  - action "paid" (backup mode) → payment marked paid → the official receipt
 *    PDF is generated + emailed immediately.
 *
 * runSessionClosureSideEffects handles the unique invoice number, the
 * professional ledger entry, and the request-vs-receipt branch.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();
    if (
      adminRecord?.permissions &&
      !adminRecord.permissions.manageBilling &&
      !adminRecord.permissions.managePatients
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      professionalId,
      clientId,
      appointmentId,
      date,
      time,
      serviceAct,
      serviceOther,
      amount,
      action,
    } = body as {
      professionalId?: string;
      clientId?: string;
      appointmentId?: string;
      date?: string;
      time?: string;
      serviceAct?: string;
      serviceOther?: string;
      amount?: number | string;
      action?: "request" | "paid";
    };

    if (action !== "request" && action !== "paid") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    if (
      !professionalId ||
      !mongoose.Types.ObjectId.isValid(professionalId) ||
      !clientId ||
      !mongoose.Types.ObjectId.isValid(clientId)
    ) {
      return NextResponse.json(
        { error: "Invalid professionalId or clientId" },
        { status: 400 },
      );
    }
    const price = roundMoney(Number(amount));
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (
      serviceAct &&
      !SESSION_ACT_NATURE_VALUES.includes(serviceAct as SessionActNature)
    ) {
      return NextResponse.json({ error: "Invalid serviceAct" }, { status: 400 });
    }
    const apptDate = parseAppointmentDate(date ?? "");
    if (!apptDate) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const [client, professional] = await Promise.all([
      User.findById(clientId),
      User.findOne({ _id: professionalId, role: "professional" }),
    ]);
    if (!client || client.role !== "client") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }

    const platformFee = calculatePlatformFee(price);
    const professionalPayout = calculateProfessionalPayout(price);
    const now = new Date();
    const cleanTime = time?.trim() || "12:00";
    const paid = action === "paid";

    let appointment;
    if (appointmentId) {
      if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
        return NextResponse.json(
          { error: "Invalid appointmentId" },
          { status: 400 },
        );
      }
      appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return NextResponse.json(
          { error: "Appointment not found" },
          { status: 404 },
        );
      }
      if (appointment.professionalId?.toString() !== professionalId) {
        return NextResponse.json(
          { error: "Appointment does not belong to this professional" },
          { status: 400 },
        );
      }
      // A receipt was already issued — refuse to re-bill (avoid duplicates).
      if (appointment.fiscalReceiptIssuedAt) {
        return NextResponse.json(
          { error: "A receipt has already been issued for this appointment" },
          { status: 409 },
        );
      }
      appointment.clientId = new mongoose.Types.ObjectId(clientId);
      appointment.date = apptDate;
      appointment.time = cleanTime;
      appointment.status = "completed";
      appointment.sessionOutcome = "completed";
      appointment.sessionCompletedAt = appointment.sessionCompletedAt ?? now;
      if (serviceAct) appointment.sessionActNature = serviceAct;
      if (serviceOther?.trim())
        appointment.sessionActNatureOther = serviceOther.trim();
      appointment.payment.price = price;
      appointment.payment.listPrice = appointment.payment.listPrice ?? price;
      appointment.payment.platformFee = platformFee;
      appointment.payment.professionalPayout = professionalPayout;
      appointment.payment.status = paid ? "paid" : "pending";
      if (paid) {
        appointment.payment.paidAt = now;
        appointment.payment.method = "manual";
      }
    } else {
      appointment = new Appointment({
        clientId,
        professionalId,
        date: apptDate,
        time: cleanTime,
        duration: 60,
        type: "in-person",
        therapyType: "solo",
        bookingFor: "self",
        status: "completed",
        routingStatus: "accepted",
        sessionOutcome: "completed",
        sessionCompletedAt: now,
        sessionActNature: serviceAct || undefined,
        sessionActNatureOther: serviceOther?.trim() || undefined,
        payment: {
          price,
          listPrice: price,
          platformFee,
          professionalPayout,
          status: paid ? "paid" : "pending",
          ...(paid ? { paidAt: now, method: "manual" } : {}),
        },
      });
    }

    await appointment.save();
    const savedId = appointment._id.toString();

    // Reuse the post-closure pipeline: invoice number + ledger + branch
    // (paid → issue receipt; pending → payment request email + SMS). Best-effort
    // after the response so SMTP / PDF generation doesn't block the admin.
    after(() =>
      runSessionClosureSideEffects(savedId).catch((err) =>
        console.error("manual-invoice side effects:", err),
      ),
    );

    return NextResponse.json(
      { success: true, appointmentId: savedId, action },
      { status: 201 },
    );
  } catch (error) {
    console.error("Manual invoice error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate manual invoice",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
