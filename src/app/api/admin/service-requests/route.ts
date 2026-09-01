import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import {
  triggerDueCascadeCron,
  triggerDuePaymentReminders,
  triggerDueAppointmentReminders,
} from "@/lib/lazy-cron";
import { resolveServiceRequestParties } from "@/lib/service-request-parties";

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

    // Opportunistically advance the matching cascade (24h/12h proposal timeouts:
    // Pro 1 → expire → Pro 2 → expire → general pool) off this admin poll, so it
    // progresses without an external scheduler. Throttled + idempotent — see
    // lazy-cron.ts. after() runs it post-response so it never slows the queue.
    after(() => triggerDueCascadeCron());
    // Same opportunistic trigger for the post-session invoice dunning
    // (H+12/H+36 reminders, H+48 overdue). Separately throttled (30 min).
    after(() => triggerDuePaymentReminders());
    // And the pre-appointment H-72 (cancel/reschedule) / H-48 reminders, which
    // the Vercel Hobby daily cron doesn't reliably run. Throttled (30 min).
    after(() => triggerDueAppointmentReminders());

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
        phone?: string;
      } | null;
      // For a doctor's referral the ACCOUNT is the referrer — the patient the
      // request is for lives in referralInfo. Resolve both so the queue shows
      // the patient as the client and still lets an admin reach the referrer.
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
        // All selected motifs (1–3) + the referral's desired approaches —
        // surfaced in the admin "Voir les détails" modal so the admin can decide
        // whom to assign.
        needs: a.needs ?? [],
        desiredApproaches: a.referralInfo?.desiredApproaches ?? [],
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
        // Who referred this patient, when the request came from a professional.
        referrer: parties.referrer,
        isReferredPatient: parties.isReferredPatient,
        // The referral form leaves the patient's email optional; the UI says
        // "contact the referrer" instead of showing a bare dash.
        patientEmailMissing: parties.patientEmailMissing,
        professionalId: pro?._id ? pro._id.toString() : null,
        professionalName: pro
          ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
          : null,
        matchedAt: a.matchedAt ?? null,
        // Referral attachment (doctor-initiated bookingFor="patient" requests):
        // surface the uploaded reference document so admins can open it from the
        // queue. Minimal projection — no patient phone/email leaks here.
        // Previously gated on documentUrl, so a referral WITHOUT an uploaded
        // document surfaced nothing at all. The referrer and the reason matter
        // whether or not a PDF was attached.
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
    console.error("admin service-requests GET:", e);
    return NextResponse.json(
      { error: "Failed to load service requests" },
      { status: 500 },
    );
  }
}
