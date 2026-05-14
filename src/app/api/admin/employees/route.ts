import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import User from "@/models/User";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireUsersAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "admin") {
    return { error: "Unauthorized", status: 401 as const };
  }
  await connectToDatabase();
  const admin = await Admin.findOne({
    userId: session.user.id,
    isActive: true,
  });
  if (!admin?.permissions?.manageUsers) {
    return { error: "Insufficient permissions", status: 403 as const };
  }
  return { ok: true as const };
}

export async function GET() {
  try {
    const auth = await requireUsersAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const employees = await User.find({ role: "employee" })
      .select(
        "firstName lastName email phone address dateOfBirth diploma experience cvDocumentUrl cvDocumentName status isAdmin createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({
      employees: employees.map((e) => ({
        id: e._id.toString(),
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        address: e.address,
        dateOfBirth: e.dateOfBirth,
        diploma: e.diploma,
        experience: e.experience,
        cvDocumentUrl: e.cvDocumentUrl,
        cvDocumentName: e.cvDocumentName,
        status: e.status,
        isAdmin: e.isAdmin === true,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    console.error("List employees error:", error);
    return NextResponse.json(
      { error: "Failed to list employees" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUsersAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      address,
      dateOfBirth,
      diploma,
      experience,
      cvDocumentUrl,
      cvDocumentName,
      password,
    } = body as Record<string, string | undefined>;

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: "firstName, lastName and email are required" },
        { status: 400 },
      );
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email" },
        { status: 400 },
      );
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 },
      );
    }

    const employee = new User({
      email: normalizedEmail,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role: "employee",
      status: "active",
      phone: phone?.trim() || undefined,
      address: address?.trim() || undefined,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      diploma: diploma?.trim() || undefined,
      experience: experience?.trim() || undefined,
      cvDocumentUrl: cvDocumentUrl?.trim() || undefined,
      cvDocumentName: cvDocumentName?.trim() || undefined,
      password:
        password && password.length >= 8
          ? await bcrypt.hash(password, 10)
          : undefined,
    });
    await employee.save();

    return NextResponse.json(
      {
        id: employee._id.toString(),
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create employee error:", error);
    return NextResponse.json(
      {
        error: "Failed to create employee",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
