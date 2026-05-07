import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import { sendPaymentGuaranteeDay1Reminder } from "@/lib/notifications";

function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

export async function POST(
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
    const user = await User.findById(id).lean();
    
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const billingUrl = `${getBaseUrl()}/client/dashboard/billing?action=addPaymentMethod`;

    await sendPaymentGuaranteeDay1Reminder({
      clientName: `${user.firstName} ${user.lastName}`,
      clientEmail: user.email,
      billingUrl,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin resend guarantee reminder error:", error);
    return NextResponse.json(
      { error: "Failed to resend guarantee reminder", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}
