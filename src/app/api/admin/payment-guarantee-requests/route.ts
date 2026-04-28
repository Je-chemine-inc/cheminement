import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import { mustMaskClientContactPII } from "@/lib/admin-rbac";
import { maskPhoneForDisplay } from "@/lib/contact-mask";

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
    if (
      perms &&
      !perms.manageBilling &&
      !perms.managePatients
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const mask = perms ? mustMaskClientContactPII(perms) : false;

    const pending = await User.find({
      role: { $in: ["client", "guest", "prospect"] },
      paymentGuaranteeStatus: "pending_admin",
    })
      .select("firstName lastName email phone createdAt")
      .sort({ updatedAt: -1 })
      .lean();

    const Appointment = (await import("@/models/Appointment")).default;

    const requests = await Promise.all(
      pending.map(async (u) => {
        const latestInteracApt = await Appointment.findOne({
          clientId: u._id,
          "payment.interacReferenceCode": { $exists: true, $ne: null },
        })
          .sort({ createdAt: -1 })
          .select("payment.interacReferenceCode")
          .lean();

        return {
          id: u._id.toString(),
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: mask ? maskPhoneForDisplay(String(u.phone || "")) : u.phone,
          requestedAt: u.updatedAt?.toISOString() ?? u.createdAt?.toISOString(),
          interacReference: latestInteracApt?.payment?.interacReferenceCode || null,
        };
      }),
    );

    return NextResponse.json({ requests });

  } catch (error: unknown) {
    console.error("payment-guarantee-requests GET:", error);
    return NextResponse.json(
      { error: "Failed to load requests" },
      { status: 500 },
    );
  }
}
