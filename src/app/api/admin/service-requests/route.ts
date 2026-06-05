import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/admin/service-requests
 * Pending appointment requests without an assigned professional (admin jumelage queue).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();

    const perms = adminRecord?.permissions;
    if (perms && !perms.managePatients && !perms.manageBilling) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    // All pending requests: unassigned (awaiting jumelage) AND matched-but-not-
    // yet-scheduled (routingStatus "accepted" + a professionalId). Surfacing the
    // matched ones lets admins reassign a request a pro accepted but never
    // scheduled (the escalation email points here).
    const requests = await Appointment.find({ status: "pending" })
      .populate("clientId", "firstName lastName email phone")
      .populate("professionalId", "firstName lastName")
      // Urgent "Consultation ponctuelle rapide" requests float to the top so
      // admins triage/reassign them first (client spec §2), then by recency.
      .sort({ isEmergency: -1, createdAt: -1 })
      .limit(200)
      .lean();

    const serialized = requests.map((a) => {
      const client = a.clientId as unknown as {
        firstName?: string;
        lastName?: string;
        email?: string;
      } | null;
      const pro = a.professionalId as unknown as {
        _id?: { toString: () => string };
        firstName?: string;
        lastName?: string;
      } | null;
      return {
        id: a._id.toString(),
        createdAt: a.createdAt,
        issueType: a.issueType,
        notes: a.notes,
        type: a.type,
        therapyType: a.therapyType,
        bookingFor: a.bookingFor,
        routingStatus: a.routingStatus,
        cascadeAttempts: a.cascadeAttempts ?? 0,
        isReturningClient: Boolean(a.isReturningClient),
        isEmergency: Boolean(a.isEmergency),
        preferredAvailability: a.preferredAvailability,
        clientName: client
          ? `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim()
          : "—",
        clientEmail: client?.email ?? "—",
        professionalId: pro?._id ? pro._id.toString() : null,
        professionalName: pro
          ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
          : null,
        matchedAt: a.matchedAt ?? null,
      };
    });

    return NextResponse.json({ requests: serialized });
  } catch (e: unknown) {
    console.error("admin service-requests GET:", e);
    return NextResponse.json(
      { error: "Failed to load service requests" },
      { status: 500 },
    );
  }
}
