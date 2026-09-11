import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { isOrganizationBillingEnabled } from "@/lib/session-payer-plan";
import { beneficiaryKeyOf } from "@/lib/organization-coverage";

/**
 * GET /api/client/coverages — the signed-in client's own coverages: who pays,
 * for whom, and how many covered sessions are used (spec 002, phase 6).
 *
 * Empty while organization billing is off: closure then charges the client as
 * usual, so telling them a session is "covered" would be false. Never returns
 * the organization's rate, amounts, case number or consent record.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await connectToDatabase();
    if (!(await isOrganizationBillingEnabled())) return NextResponse.json({ coverages: [] });

    const coverages = await OrganizationCoverage.find({
      clientId: session.user.id,
      status: { $in: ["active", "exhausted"] },
    })
      .select("beneficiaryKey organizationId mode maxSessions consumedAppointmentIds status validUntil")
      .sort({ createdAt: -1 })
      .lean();
    if (coverages.length === 0) return NextResponse.json({ coverages: [] });

    const orgs = await Organization.find({ _id: { $in: coverages.map((c) => c.organizationId) } })
      .select("name")
      .lean();
    const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));

    // The coverage key holds a loved one's name folded (no accents, lower
    // case); the client's own bookings give it back as they typed it.
    const lovedOneNames = new Map<string, string>();
    if (coverages.some((c) => c.beneficiaryKey !== "self")) {
      const bookings = await Appointment.find({ clientId: session.user.id, bookingFor: "loved-one" })
        .select("bookingFor lovedOneInfo.firstName lovedOneInfo.lastName")
        .sort({ date: -1 })
        .limit(100)
        .lean();
      for (const b of bookings) {
        const key = beneficiaryKeyOf(b);
        if (!lovedOneNames.has(key)) {
          lovedOneNames.set(key, `${b.lovedOneInfo?.firstName ?? ""} ${b.lovedOneInfo?.lastName ?? ""}`.trim());
        }
      }
    }

    return NextResponse.json({
      coverages: coverages.map((c) => ({
        id: String(c._id),
        organizationName: orgName.get(String(c.organizationId)) ?? "",
        forLovedOne: c.beneficiaryKey === "self" ? null : (lovedOneNames.get(c.beneficiaryKey) ?? ""),
        mode: c.mode,
        used: c.consumedAppointmentIds?.length ?? 0,
        max: c.maxSessions ?? null,
        status: c.status,
        validUntil: c.validUntil ?? null,
      })),
    });
  } catch (error) {
    console.error("Client coverages error:", error);
    return NextResponse.json({ error: "Failed to load coverages" }, { status: 500 });
  }
}
