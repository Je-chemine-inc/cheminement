import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import crypto from "crypto";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { sendJumelageSuccessEmail } from "@/lib/notifications";
import { provisionGuestAsClient } from "@/lib/provision-guest-as-client";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

/**
 * Manually jumelage a pending service-request: admin picks a professional
 * for an unassigned request and notifies the client (jumelage success email).
 *
 * The request stays at `status: "pending"` (no date/time yet — that's set
 * later by booking) but `routingStatus` jumps to "accepted" and the chosen
 * professional is locked in. If pricing depends on the pro, refresh it here
 * so the pricing reflects the assigned pro's rate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();
    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });
    if (!admin?.permissions?.manageUsers) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { professionalId } = (await req.json()) as {
      professionalId?: string;
    };
    if (!professionalId || !mongoose.Types.ObjectId.isValid(professionalId)) {
      return NextResponse.json(
        { error: "professionalId is required" },
        { status: 400 },
      );
    }

    const [appointment, professional] = await Promise.all([
      Appointment.findById(id).populate(
        "clientId",
        "firstName lastName email language role status",
      ),
      User.findOne({
        _id: professionalId,
        role: "professional",
        status: { $in: ["active", "pending"] },
      }),
    ]);
    if (!appointment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }
    if (appointment.professionalId) {
      return NextResponse.json(
        { error: "Request already assigned to a professional" },
        { status: 409 },
      );
    }

    const pricing = await calculateAppointmentPricing(
      professionalId,
      appointment.therapyType,
    );

    appointment.professionalId = new mongoose.Types.ObjectId(professionalId);
    appointment.routingStatus = "accepted";
    appointment.payment.price = pricing.sessionPrice;
    appointment.payment.platformFee = pricing.platformFee;
    appointment.payment.professionalPayout = pricing.professionalPayout;
    await appointment.save();

    const client = appointment.clientId as unknown as {
      _id: { toString: () => string };
      firstName?: string;
      lastName?: string;
      email?: string;
      language?: string;
      role?: string;
      status?: string;
    } | null;

    if (client?.email) {
      // Provision unclaimed accounts so the "Compléter mon compte" CTA
      // has a valid claim target — mirrors the pro-accept flow.
      const wasProspectOrGuest =
        client.role === "guest" || client.role === "prospect";
      if (wasProspectOrGuest) {
        await provisionGuestAsClient(client._id.toString(), {
          issueType: appointment.issueType,
          activate: false,
        });
      }

      const freshClientUser = await User.findById(client._id)
        .select("role status")
        .lean();
      const isActiveClient =
        (freshClientUser as { role?: string } | null)?.role === "client" &&
        (freshClientUser as { status?: string } | null)?.status === "active";

      // Quebec LSSSS art. 14: route to the beneficiary for adult loved-one bookings.
      const recipient = resolveAppointmentRecipient(
        {
          bookingFor: appointment.bookingFor,
          lovedOneInfo: appointment.lovedOneInfo,
        },
        client,
      );

      const base = getBaseUrl();
      const completeAccountUrl = isActiveClient
        ? `${base}/client/dashboard/profile`
        : `${base}/signup/member?email=${encodeURIComponent(recipient.email)}`;

      // Resolve the "Choose payment method" CTA target. For unclaimed clients
      // we mint a tokenized /pay link so the user can pay without first being
      // forced through a login they cannot complete (no password yet).
      let billingUrl: string;
      if (!isActiveClient) {
        const paymentToken = crypto.randomBytes(32).toString("hex");
        const paymentTokenExpiry = new Date();
        paymentTokenExpiry.setDate(paymentTokenExpiry.getDate() + 7);
        await Appointment.findByIdAndUpdate(appointment._id, {
          "payment.paymentToken": paymentToken,
          "payment.paymentTokenExpiry": paymentTokenExpiry,
        });
        billingUrl = `${base}/pay?token=${paymentToken}`;
      } else {
        billingUrl = `${base}/client/dashboard/billing?action=addPaymentMethod`;
      }

      const jumelageArgs = {
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName: `${professional.firstName ?? ""} ${
          professional.lastName ?? ""
        }`.trim(),
        locale: recipient.language,
        completeAccountUrl,
        billingUrl,
      };
      after(() =>
        sendJumelageSuccessEmail(jumelageArgs).catch((err) =>
          console.error("[admin manual jumelage] email error:", err),
        ),
      );
    }

    return NextResponse.json({
      id: appointment._id.toString(),
      professionalId,
      routingStatus: appointment.routingStatus,
    });
  } catch (error) {
    console.error("Admin manual jumelage error:", error);
    return NextResponse.json(
      {
        error: "Failed to assign professional",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
