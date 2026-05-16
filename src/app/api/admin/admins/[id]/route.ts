import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin, { ADMIN_ROLE_PERMISSIONS, type AdminRole } from "@/models/Admin";
import { authOptions } from "@/lib/auth";

// GET - Get specific admin details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Check admin permissions
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentAdmin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });

    if (!currentAdmin?.permissions.manageAdmins) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const admin = await Admin.findById(id)
      .populate("userId", "firstName lastName email createdAt")
      .populate("createdBy", "firstName lastName")
      .lean();

    if (!admin) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    const adminData = {
      id: admin._id.toString(),
      userId: admin.userId._id.toString(),
      role: admin.role,
      permissions: admin.permissions,
      user: {
        firstName: (admin.userId as any).firstName,
        lastName: (admin.userId as any).lastName,
        email: (admin.userId as any).email,
        createdAt: (admin.userId as any).createdAt,
      },
      createdBy: admin.createdBy
        ? {
            firstName: (admin.createdBy as any).firstName,
            lastName: (admin.createdBy as any).lastName,
          }
        : null,
      createdAt: admin.createdAt,
      lastLogin: admin.lastLogin,
      isActive: admin.isActive,
    };

    return NextResponse.json(adminData);
  } catch (error: any) {
    console.error("Get admin error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch admin",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

// PUT - Update admin
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentAdmin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });

    if (!currentAdmin?.permissions.manageAdmins) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const body = await req.json();
    const { role, permissions, isActive } = body;

    // Find the admin to update
    const adminToUpdate = await Admin.findById(id);
    if (!adminToUpdate) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    // Prevent self-modification (any admin)
    if (id === (currentAdmin._id as any).toString()) {
      return NextResponse.json(
        { error: "You cannot modify your own admin account" },
        { status: 400 },
      );
    }

    // Hierarchy: only a super_admin can modify another super_admin
    if (
      adminToUpdate.role === "super_admin" &&
      currentAdmin.role !== "super_admin"
    ) {
      return NextResponse.json(
        { error: "Only a super admin can modify another super admin" },
        { status: 403 },
      );
    }

    // Hierarchy: only a super_admin can promote anyone TO super_admin
    if (role === "super_admin" && currentAdmin.role !== "super_admin") {
      return NextResponse.json(
        { error: "Only a super admin can assign the super admin role" },
        { status: 403 },
      );
    }

    // Update role and permissions
    const updates: any = {};

    if (role && role !== adminToUpdate.role) {
      updates.role = role;
      // Reset permissions to match new role unless custom permissions provided
      if (!permissions) {
        updates.permissions = ADMIN_ROLE_PERMISSIONS[role as AdminRole];
      }
    }

    if (permissions) {
      updates.permissions = { ...adminToUpdate.permissions, ...permissions };
    }

    if (typeof isActive === "boolean") {
      updates.isActive = isActive;

      // Update user's admin status
      await User.findByIdAndUpdate(adminToUpdate.userId, {
        isAdmin: isActive,
      });
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(id, updates, {
      new: true,
    }).populate("userId", "firstName lastName email");

    return NextResponse.json({
      message: "Admin updated successfully",
      admin: {
        id: (updatedAdmin as any)._id.toString(),
        role: (updatedAdmin as any).role,
        permissions: (updatedAdmin as any).permissions,
        isActive: (updatedAdmin as any).isActive,
      },
    });
  } catch (error: any) {
    console.error("Update admin error:", error);
    return NextResponse.json(
      {
        error: "Failed to update admin",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

// DELETE - Deactivate admin (soft delete)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentAdmin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });

    // Additional check for delete permissions
    if (!currentAdmin?.permissions.deleteAdmins) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete admins" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const adminToDelete = await Admin.findById(id);
    if (!adminToDelete) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    // Prevent self-deletion
    if (id === (currentAdmin._id as any).toString()) {
      return NextResponse.json(
        { error: "Cannot delete your own admin account" },
        { status: 400 },
      );
    }

    // Hierarchy: only a super_admin can deactivate another super_admin
    if (
      adminToDelete.role === "super_admin" &&
      currentAdmin.role !== "super_admin"
    ) {
      return NextResponse.json(
        { error: "Only a super admin can deactivate another super admin" },
        { status: 403 },
      );
    }

    // Soft delete - deactivate admin and remove admin status from user
    await Admin.findByIdAndUpdate(id, { isActive: false });
    await User.findByIdAndUpdate(adminToDelete.userId, {
      isAdmin: false,
      adminId: null,
    });

    return NextResponse.json({ message: "Admin deactivated successfully" });
  } catch (error: any) {
    console.error("Delete admin error:", error);
    return NextResponse.json(
      {
        error: "Failed to delete admin",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
