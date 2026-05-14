import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
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

function serialize(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any,
) {
  return {
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
    updatedAt: e.updatedAt,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireUsersAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const employee = await User.findOne({ _id: id, role: "employee" });
    if (!employee) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(serialize(employee));
  } catch (error) {
    console.error("Get employee error:", error);
    return NextResponse.json(
      { error: "Failed to load employee" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireUsersAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
      status,
    } = body as Record<string, string | undefined>;

    const employee = await User.findOne({ _id: id, role: "employee" });
    if (!employee) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (typeof firstName === "string" && firstName.trim()) {
      employee.firstName = firstName.trim();
    }
    if (typeof lastName === "string" && lastName.trim()) {
      employee.lastName = lastName.trim();
    }
    if (typeof email === "string") {
      const normalized = email.trim().toLowerCase();
      if (normalized && !EMAIL_RE.test(normalized)) {
        return NextResponse.json({ error: "Invalid email" }, { status: 400 });
      }
      if (normalized && normalized !== employee.email) {
        const conflict = await User.findOne({
          email: normalized,
          _id: { $ne: employee._id },
        });
        if (conflict) {
          return NextResponse.json(
            { error: "A user with this email already exists" },
            { status: 409 },
          );
        }
        employee.email = normalized;
      }
    }
    if (typeof phone === "string") {
      employee.phone = phone.trim() || undefined;
    }
    if (typeof address === "string") {
      employee.address = address.trim() || undefined;
    }
    if (typeof dateOfBirth === "string") {
      employee.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : undefined;
    }
    if (typeof diploma === "string") {
      employee.diploma = diploma.trim() || undefined;
    }
    if (typeof experience === "string") {
      employee.experience = experience.trim() || undefined;
    }
    if (typeof cvDocumentUrl === "string") {
      employee.cvDocumentUrl = cvDocumentUrl.trim() || undefined;
    }
    if (typeof cvDocumentName === "string") {
      employee.cvDocumentName = cvDocumentName.trim() || undefined;
    }
    if (typeof password === "string" && password.length >= 8) {
      employee.password = await bcrypt.hash(password, 10);
    }
    if (
      typeof status === "string" &&
      ["active", "pending", "inactive"].includes(status)
    ) {
      employee.status = status as "active" | "pending" | "inactive";
    }

    await employee.save();
    return NextResponse.json(serialize(employee));
  } catch (error) {
    console.error("Update employee error:", error);
    return NextResponse.json(
      { error: "Failed to update employee" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireUsersAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const employee = await User.findOne({ _id: id, role: "employee" });
    if (!employee) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (employee.isAdmin) {
      return NextResponse.json(
        {
          error:
            "This employee is also an admin. Revoke admin rights before deletion.",
        },
        { status: 409 },
      );
    }
    await employee.deleteOne();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete employee error:", error);
    return NextResponse.json(
      { error: "Failed to delete employee" },
      { status: 500 },
    );
  }
}
