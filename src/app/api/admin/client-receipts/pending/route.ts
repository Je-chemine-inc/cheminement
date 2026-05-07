import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import ClientReceipt from "@/models/ClientReceipt";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import Admin from "@/models/Admin";

export async function GET() {
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
    const perms = adminRecord?.permissions;
    if (perms && !perms.manageBilling && !perms.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const pending = await ClientReceipt.find({ status: "pending_transfer" })
      .sort({ issuedAt: -1 })
      .limit(200)
      .lean();

    const enriched = await Promise.all(
      pending.map(async (r) => {
        const [client, apt] = await Promise.all([
          User.findById(r.clientId)
            .select("firstName lastName email")
            .lean<{ firstName?: string; lastName?: string; email?: string }>(),
          Appointment.findById(r.appointmentId)
            .select(
              "date time payment.interacReferenceCode professionalId",
            )
            .populate("professionalId", "firstName lastName")
            .lean<{
              date?: Date;
              time?: string;
              payment?: { interacReferenceCode?: string | null };
              professionalId?: { firstName?: string; lastName?: string };
            }>(),
        ]);

        const professional = apt?.professionalId;
        const proName = professional
          ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim()
          : null;

        return {
          id: String(r._id),
          appointmentId: String(r.appointmentId),
          clientId: String(r.clientId),
          clientName: client
            ? `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim()
            : "—",
          clientEmail: client?.email ?? "—",
          professionalName: proName,
          appointmentDate: apt?.date ? new Date(apt.date).toISOString() : null,
          appointmentTime: apt?.time ?? null,
          interacReference: apt?.payment?.interacReferenceCode ?? null,
          amountCad: r.amountCad,
          issuedAt: r.issuedAt
            ? new Date(r.issuedAt).toISOString()
            : null,
        };
      }),
    );

    return NextResponse.json({ receipts: enriched });
  } catch (error: unknown) {
    console.error("admin/client-receipts/pending GET:", error);
    return NextResponse.json(
      { error: "Failed to load pending receipts" },
      { status: 500 },
    );
  }
}
