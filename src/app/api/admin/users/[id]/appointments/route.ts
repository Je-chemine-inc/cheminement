import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Admin from "@/models/Admin";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { authOptions } from "@/lib/auth";
import { beneficiaryKeyOf } from "@/lib/organization-coverage";
import { isOrganizationBillingEnabled } from "@/lib/session-payer-plan";

/** A reference's id, populated or not. */
const refIdOf = (ref: unknown): string =>
  ref && typeof ref === "object" && "_id" in ref
    ? String((ref as { _id: unknown })._id)
    : ref
      ? String(ref)
      : "";

// GET /api/admin/users/[id]/appointments — Appointment history for a user
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const admin = await Admin.findOne({ userId: session.user.id, isActive: true })
      .select("permissions")
      .lean();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const appointments = await Appointment.find({
      $or: [{ clientId: id }, { professionalId: id }],
    })
      // Admin-only: who pays (spec 002). Both fields are select:false.
      .select("+thirdPartyBilling +billingOverride")
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName email")
      .sort({ date: -1, createdAt: -1 })
      .limit(100)
      .lean();

    // The payer choice defaults to the client; « Selon la couverture » only
    // where a coverage applies — and only while organization billing is on,
    // since closure ignores coverages when it is off.
    const organizationBilling = await isOrganizationBillingEnabled();
    const covered = new Set<string>();
    if (organizationBilling) {
      const clientIds = [
        ...new Set(appointments.map((a) => refIdOf(a.clientId)).filter(Boolean)),
      ];
      const coverages = await OrganizationCoverage.find({
        clientId: { $in: clientIds },
        status: "active",
      })
        .select("clientId beneficiaryKey")
        .lean();
      for (const c of coverages) covered.add(`${String(c.clientId)}|${c.beneficiaryKey}`);
    }

    const mapped = appointments.map((apt) => {
      const client = apt.clientId as unknown as {
        _id: { toString: () => string };
        firstName: string;
        lastName: string;
        email: string;
      } | null;
      const pro = apt.professionalId as unknown as {
        _id: { toString: () => string };
        firstName: string;
        lastName: string;
        email: string;
      } | null;

      return {
        id: (apt._id as any).toString(),
        date: apt.date || null,
        time: apt.time || null,
        duration: apt.duration,
        type: apt.type,
        therapyType: apt.therapyType,
        status: apt.status,
        sessionOutcome: apt.sessionOutcome || null,
        sessionActNature: apt.sessionActNature || null,
        routingStatus: apt.routingStatus,
        sessionCompletedAt: apt.sessionCompletedAt ?? null,
        // Spec 002: who pays, as decided at closure, and any admin choice.
        payer: apt.thirdPartyBilling
          ? {
              kind: apt.thirdPartyBilling.kind,
              state: apt.thirdPartyBilling.state,
              reason: apt.thirdPartyBilling.reason,
              orgAmount: (apt.thirdPartyBilling.orgAmountCents ?? 0) / 100,
              caseNumber: apt.thirdPartyBilling.caseNumber ?? null,
              onOrganizationInvoice: !!apt.thirdPartyBilling.orgInvoiceId,
            }
          : null,
        billingOverride: apt.billingOverride?.payer ?? null,
        coverageApplies: covered.has(`${refIdOf(apt.clientId)}|${beneficiaryKeyOf(apt)}`),
        client: client
          ? {
              id: client._id.toString(),
              name: `${client.firstName} ${client.lastName}`,
              email: client.email,
            }
          : null,
        professional: pro
          ? {
              id: pro._id.toString(),
              name: `${pro.firstName} ${pro.lastName}`,
              email: pro.email,
            }
          : null,
        payment: {
          price: apt.payment?.price || 0,
          status: apt.payment?.status || "pending",
          method: apt.payment?.method,
          paidAt: apt.payment?.paidAt ?? null,
        },
        createdAt: apt.createdAt,
        // Referral attachment (doctor-initiated bookingFor="patient" requests) so
        // the patient detail page can show/open the uploaded reference document.
        referralInfo: apt.referralInfo?.documentUrl
          ? {
              referrerName: apt.referralInfo.referrerName,
              referralReason: apt.referralInfo.referralReason,
              desiredApproaches: apt.referralInfo.desiredApproaches ?? [],
              documentUrl: apt.referralInfo.documentUrl,
              documentName: apt.referralInfo.documentName,
            }
          : null,
      };
    });

    return NextResponse.json({
      appointments: mapped,
      // The payer actions need manageBilling; the page hides them otherwise.
      canManagePayer: !!admin.permissions?.manageBilling,
      organizationBilling,
    });
  } catch (error) {
    console.error("Admin user appointments error:", error);
    return NextResponse.json(
      { error: "Failed to fetch appointments", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}
