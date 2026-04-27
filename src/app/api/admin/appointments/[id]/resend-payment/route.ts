import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";
import { sendInteracTransferInstructionsEmail } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const apt = await Appointment.findById(params.id)
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName");

    if (!apt) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    if (apt.payment.method !== "transfer") {
      return NextResponse.json(
        { error: "This appointment does not use Interac" },
        { status: 400 },
      );
    }

    const client = apt.clientId as unknown as {
      firstName: string;
      lastName: string;
      email: string;
    };
    const pro = apt.professionalId as unknown as {
      firstName?: string;
      lastName?: string;
    } | null;

    if (!client?.email) {
      return NextResponse.json({ error: "Client email not found" }, { status: 400 });
    }

    const depositEmail = await getInteracDepositEmail();

    const aptDate = apt.date ? new Date(apt.date) : null;
    const dateLabel = aptDate
      ? `${aptDate.toLocaleDateString("fr-CA", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}${apt.time ? ` à ${apt.time}` : ""}`
      : "—";

    const ok = await sendInteracTransferInstructionsEmail({
      clientName: `${client.firstName} ${client.lastName}`,
      clientEmail: client.email,
      clientLegalName: `${client.firstName} ${client.lastName}`,
      depositEmail,
      amountCad: apt.payment.price,
      interacReferenceCode: apt.payment.interacReferenceCode || "",
      professionalName: pro
        ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
        : "—",
      appointmentDateLabel: dateLabel,
    });

    if (!ok) {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("resend-payment admin API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
