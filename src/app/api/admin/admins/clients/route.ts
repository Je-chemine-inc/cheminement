import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";

// GET - List all non-admin users (clients) that can be promoted to admin
export async function GET() {
  try {
    // Check admin permissions
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    });

    if (!admin?.permissions.createAdmins) {
      return NextResponse.json(
        { error: "Insufficient permissions to promote users to admin" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    // Only employees (staff records) are promotable to admin. Clients and
    // professionals are no longer eligible — an admin must be an employee
    // first ("dossier employé" workflow).
    const users = await User.find({
      isAdmin: { $ne: true },
      status: "active",
      role: "employee",
    })
      .select("firstName lastName email role _id createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const userData = users.map((user) => ({
      _id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    }));

    return NextResponse.json({
      clients: userData,
    });
  } catch (error) {
    console.error("Get clients error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch clients",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}