import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";

// POST - Demote an admin back to employee (revoke admin rights, keep User record)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const currentAdmin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });

    if (!currentAdmin?.permissions.deleteAdmins) {
      return NextResponse.json(
        { error: "Insufficient permissions to demote admins" },
        { status: 403 },
      );
    }

    const adminToDemote = await Admin.findById(id);
    if (!adminToDemote) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    // Prevent self-demotion
    if (id === (currentAdmin._id as any).toString()) {
      return NextResponse.json(
        { error: "You cannot demote your own admin account" },
        { status: 400 },
      );
    }

    // Hierarchy: only a super_admin can demote another super_admin
    if (
      adminToDemote.role === "super_admin" &&
      currentAdmin.role !== "super_admin"
    ) {
      return NextResponse.json(
        { error: "Only a super admin can demote another super admin" },
        { status: 403 },
      );
    }

    // Deactivate admin record and revert user back to "employee"
    await Admin.findByIdAndUpdate(id, { isActive: false });
    await User.findByIdAndUpdate(adminToDemote.userId, {
      isAdmin: false,
      adminId: null,
      role: "employee",
    });

    return NextResponse.json({
      message: "Admin demoted back to employee successfully",
    });
  } catch (error) {
    console.error("Demote admin error:", error);
    return NextResponse.json(
      {
        error: "Failed to demote admin",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
