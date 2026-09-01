import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import { resolveServiceRequestParties } from "@/lib/service-request-parties";

/**
 * GET /api/admin/general-pool
 * Pending requests currently in the GENERAL pool (routingStatus "general" or
 * legacy "refused") — open for any active professional to self-claim. Powers the
 * admin "Pool Général" tab. Same shape as /api/admin/service-requests so both
 * can share the RequestsQueueTable component and the assign/delete actions.
 *
 * NOTE: this is the APPOINTMENT-level general pool, distinct from the "Patients"
 * tab (which is the client CRM, GET /api/admin/patients).
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

    const requests = await Appointment.find({
      status: "pending",
      routingStatus: { $in: ["general", "refused"] },
    })
      .populate("clientId", "firstName lastName email phone")
      .populate("professionalId", "firstName lastName")
      // Urgent requests first (client spec §2 — réassigner rapidement), then recency.
      .sort({ isEmergency: -1, createdAt: -1 })
      .limit(200)
      .lean();

    const serialized = requests.map((a) => {
      const client = a.clientId as unknown as {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
      } | null;
      // Same rule as the service-requests queue: on a referral the account is
      // the referring professional, so resolve the patient explicitly.
      const parties = resolveServiceRequestParties({
        bookingFor: a.bookingFor,
        referralInfo: a.referralInfo,
        account: client,
      });
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
        clientName: parties.clientName,
        clientEmail: parties.clientEmail ?? "—",
        clientPhone: parties.clientPhone,
        referrer: parties.referrer,
        isReferredPatient: parties.isReferredPatient,
        patientEmailMissing: parties.patientEmailMissing,
        professionalId: pro?._id ? pro._id.toString() : null,
        professionalName: pro
          ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
          : null,
        matchedAt: a.matchedAt ?? null,
        // Referral details (doctor-initiated bookingFor="patient" requests).
        // Previously gated on documentUrl, so a referral without an uploaded
        // document surfaced nothing — the referrer and reason matter regardless.
        referral: a.referralInfo?.referrerName
          ? {
              referrerName: a.referralInfo.referrerName,
              referralReason: a.referralInfo.referralReason,
              documentUrl: a.referralInfo.documentUrl ?? null,
              documentName: a.referralInfo.documentName ?? null,
            }
          : null,
      };
    });

    return NextResponse.json({ requests: serialized });
  } catch (e: unknown) {
    console.error("admin general-pool GET:", e);
    return NextResponse.json(
      { error: "Failed to load general pool" },
      { status: 500 },
    );
  }
}
