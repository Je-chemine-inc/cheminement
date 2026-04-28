import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import {
  getActiveAdminPermissions,
  mustMaskClientContactPII,
  applyClientContactMaskToUserPayload,
} from "@/lib/admin-rbac";
import { logAdminClientAccess } from "@/lib/admin-access-log";
import {
  sendProfessionalApprovalEmail,
  sendProfessionalRejectionEmail,
} from "@/lib/notifications";
import { PROFESSIONAL_CLIENT_APPOINTMENT_STATUSES } from "@/lib/professional-client-access";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/users/[id]">,
) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await ctx.params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admins can view other users' details, or professionals can view clients they have appointments with
    if (session.user.role !== "admin" && session.user.id !== id) {
      if (session.user.role === "professional") {
        // Check if professional has appointments with this client
        const Appointment = (await import("@/models/Appointment")).default;
        const hasAppointment = await Appointment.findOne({
          professionalId: session.user.id,
          clientId: id,
          status: { $in: Array.from(PROFESSIONAL_CLIENT_APPOINTMENT_STATUSES) },
        });
        if (!hasAppointment) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    await connectToDatabase();

    const user = await User.findById(id).select("-password");

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (session.user.role === "admin") {
      const perms = await getActiveAdminPermissions(session.user.id);
      const isClientOrGuest = ["client", "guest", "prospect"].includes(String(user.role));
      if (isClientOrGuest) {
        void logAdminClientAccess({
          actorUserId: session.user.id,
          resourceUserId: id,
          action: "view_client_user",
          req,
        });
      }
      const mask = mustMaskClientContactPII(perms) && isClientOrGuest;
      const plain = user.toObject() as { phone?: string };
      return NextResponse.json(
        applyClientContactMaskToUserPayload(plain, mask),
      );
    }

    return NextResponse.json(user);
  } catch (error: unknown) {
    console.error(
      "Get user by ID error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to fetch user",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/users/[id]">,
) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await ctx.params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admins can update other users
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectToDatabase();

    const adminPerms = await getActiveAdminPermissions(session.user.id);
    if (adminPerms && mustMaskClientContactPII(adminPerms)) {
      return NextResponse.json(
        { error: "Insufficient permissions to modify user records" },
        { status: 403 },
      );
    }

    // Get the user before update to check for status changes
    const existingUser = await User.findById(id);
    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();

    // Validate and sanitize the update data
    const allowedUpdates = [
      "status",
      "firstName",
      "lastName",
      "phone",
      "location",
      "dateOfBirth",
      "gender",
      "language",
    ];

    const updates: Record<string, string | number | boolean | Date> = {};
    for (const key of Object.keys(body)) {
      if (allowedUpdates.includes(key)) {
        updates[key] = body[key];
      }
    }

    if (
      existingUser.role === "professional" &&
      updates.status === "active" &&
      existingUser.status === "pending"
    ) {
      updates.professionalLicenseStatus = "verified";
    }
    if (
      existingUser.role === "professional" &&
      updates.status === "inactive" &&
      existingUser.status === "pending"
    ) {
      updates.professionalLicenseStatus = "rejected";
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true },
    ).select("-password");

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Send professional approval/rejection emails when status changes
    if (
      existingUser.role === "professional" &&
      updates.status &&
      existingUser.status !== updates.status
    ) {
      const professionalName = `${user.firstName} ${user.lastName}`;

      if (updates.status === "active" && existingUser.status === "pending") {
        // Professional approved
        sendProfessionalApprovalEmail({
          name: professionalName,
          email: user.email,
        }).catch((err) =>
          console.error("Error sending professional approval email:", err),
        );
      } else if (
        updates.status === "rejected" ||
        (updates.status === "inactive" && existingUser.status === "pending")
      ) {
        // Professional rejected
        sendProfessionalRejectionEmail({
          name: professionalName,
          email: user.email,
          reason: body.rejectionReason,
        }).catch((err) =>
          console.error("Error sending professional rejection email:", err),
        );
      }
    }

    return NextResponse.json(user);
  } catch (error: unknown) {
    console.error(
      "Update user error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to update user",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
