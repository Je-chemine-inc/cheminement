import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { sendWelcomeEmail } from "@/lib/notifications";

// POST /api/admin/users — Create a new user profile (admin-simplified form)
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const admin = await Admin.findOne({ userId: session.user.id, isActive: true })
      .select("role permissions")
      .lean();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { firstName, lastName, email, phone, role, specialty, location } = body;

    // Validation
    if (!firstName || !lastName || !email || !role) {
      return NextResponse.json(
        { error: "firstName, lastName, email, and role are required" },
        { status: 400 },
      );
    }

    if (!["client", "professional"].includes(role)) {
      return NextResponse.json(
        { error: "Role must be 'client' or 'professional'" },
        { status: 400 },
      );
    }

    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return NextResponse.json(
        { error: "Un utilisateur avec cet email existe déjà" },
        { status: 409 },
      );
    }

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Admin-created accounts are pre-verified AND (for professionals)
    // pre-approved: setting status="active" without also flipping adminApproved
    // and professionalLicenseStatus leaves the pro in a half-validated state
    // where the admin UI cannot show the "Valider" button anymore.
    const isProfessional = role === "professional";
    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      phone: phone?.trim() || undefined,
      location: location?.trim() || undefined,
      role,
      status: "active",
      emailVerified: new Date(),
      phoneVerifiedAt: new Date(),
      ...(isProfessional
        ? {
            adminApproved: true,
            professionalLicenseStatus: "verified" as const,
          }
        : {}),
    });

    // Create profile for professionals
    if (role === "professional" && specialty) {
      await Profile.create({
        userId: user._id,
        specialty: specialty.trim(),
        profileCompleted: false,
      });
    }

    // Professionals get a dedicated welcome email on profile completion
    // (sendProfessionalProfileCompletedEmail in /api/profile). Sending the
    // generic welcome here for a pro would be a duplicate, so skip it.
    if (role !== "professional") {
      try {
        await sendWelcomeEmail({
          name: `${firstName} ${lastName}`,
          email: email.toLowerCase().trim(),
          role,
          locale: user.language === "en" ? "en" : "fr",
        });
      } catch (emailErr) {
        console.error("Failed to send welcome email:", emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Admin create user error:", error);
    return NextResponse.json(
      { error: "Failed to create user", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}
