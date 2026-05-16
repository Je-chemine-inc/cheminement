import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const admin = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    }).lean();

    if (!admin) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: admin._id.toString(),
      userId: admin.userId.toString(),
      role: admin.role,
      permissions: admin.permissions,
      isActive: admin.isActive,
    });
  } catch (error) {
    console.error("Get current admin error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch current admin",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
