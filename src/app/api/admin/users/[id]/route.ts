import { NextRequest, NextResponse } from "next/server"; // Trivial change for HMR
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import Appointment from "@/models/Appointment";
import MedicalProfile from "@/models/MedicalProfile";
import Admin from "@/models/Admin";
import ClientDocument from "@/models/ClientDocument";
import ClientReceipt from "@/models/ClientReceipt";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import Review from "@/models/Review";
import { ResourcePurchase } from "@/models/Resource";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";

// GET /api/admin/users/[id] — Full user detail
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();
    
    // Use granular permissions if Admin record exists, otherwise skip (rely on session.user.role === "admin")
    const adminRecord = await Admin.findOne({ userId: session.user.id, isActive: true })
      .select("permissions")
      .lean();
    
    if (adminRecord?.permissions && !adminRecord.permissions.managePatients && !adminRecord.permissions.manageBilling) {
      return NextResponse.json({ error: "Forbidden - Insufficient permissions" }, { status: 403 });
    }

    const { id: userId } = await params;

    if (!userId || userId === "undefined" || userId.length !== 24) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const user = await User.findById(userId).select("-password").lean();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get profile (professional)
    const profile = await Profile.findOne({ userId: userId }).lean();

    // Get medical profile (client)
    const medicalProfile = await MedicalProfile.findOne({ userId: userId }).lean();

    // Get appointment stats
    const totalAppointments = await Appointment.countDocuments({
      $or: [{ clientId: userId }, { professionalId: userId }],
    });
    const completedSessions = await Appointment.countDocuments({
      $or: [{ clientId: userId }, { professionalId: userId }],
      status: "completed",
    });
    const noShowCount = await Appointment.countDocuments({
      $or: [{ clientId: userId }, { professionalId: userId }],
      status: "no-show",
    });

    return NextResponse.json({
      user: {
        id: (user._id as any).toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        status: user.status,
        location: user.location || "",
        gender: user.gender || "",
        dateOfBirth: user.dateOfBirth || null,
        language: user.language || "fr",
        paymentGuaranteeStatus: user.paymentGuaranteeStatus || "none",
        paymentGuaranteeSource: user.paymentGuaranteeSource || null,
        stripeCustomerId: user.stripeCustomerId || null,
        stripeConnectAccountId: user.stripeConnectAccountId || null,
        professionalLicenseStatus: user.professionalLicenseStatus || "not_applicable",
        emailVerified: user.emailVerified || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      adminStatus: await (async () => {
        let color = "gray";
        let label = "Nouveau prospect";

        // Check for failed payments or late Interac
        const hasFailedPayment = await Appointment.exists({
          clientId: userId,
          "payment.status": "failed",
        });

        const hasLateInterac = await Appointment.exists({
          clientId: userId,
          "payment.status": { $ne: "paid" },
          "payment.transferDueAt": { $lt: new Date() },
        });

        if (hasFailedPayment || hasLateInterac) {
          color = "red";
          label = "Échec de paiement";
        } else if (user.paymentGuaranteeStatus === "green") {
          color = "green";
          label = "Ok";
        } else {
          const scheduledAppointment = await Appointment.findOne({
            clientId: userId,
            status: "scheduled",
          }).lean();

          if (scheduledAppointment) {
            color = "yellow";
            label = "RDV fixé sans carte";
          } else {
            color = "gray";
            label = "Nouveau prospect";
          }
        }
        return { color, label };
      })(),

      profile: profile || null,
      medicalProfile: medicalProfile || null,
      stats: {
        totalAppointments,
        completedSessions,
        noShowCount,
      },
    });
  } catch (error) {
    console.error("Admin user detail error:", error);
    return NextResponse.json(
      { error: "Failed to fetch user", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}

// PUT /api/admin/users/[id] — Update user fields
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();
    
    // Check granular permissions if Admin record exists
    const adminRecord = await Admin.findOne({ userId: session.user.id, isActive: true })
      .select("permissions")
      .lean();
    
    if (adminRecord?.permissions && !adminRecord.permissions.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: userId } = await params;
    const body = await req.json();

    const userToUpdate = await User.findById(userId);
    if (!userToUpdate) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Allowed user fields to update
    const allowedUserFields = [
      "firstName", "lastName", "email", "phone", "location",
      "gender", "dateOfBirth", "language", "status",
      "professionalLicenseStatus", "paymentGuaranteeStatus", "paymentGuaranteeSource",
      "image", "stripeCustomerId", "stripeConnectAccountId"
    ];
    // Allowed profile fields
    const allowedProfileFields = [
      "specialty", "license", "bio", "approaches", "problematics",
      "languages", "yearsOfExperience", "certifications",
      "ageCategories", "diagnosedConditions", "skills", "availability",
      "sessionTypes", "modalities", "paymentAgreement", "paymentFrequency",
      "pricing", "education", "profileCompleted"
    ];
    // Allowed medical profile fields
    const allowedMedicalProfileFields = [
      "concernedPerson", "accountFor", "childFirstName", "childLastName",
      "childDateOfBirth", "childServiceType", "medicalConditions", "currentMedications",
      "allergies", "consultationMotifs", "substanceUse", "previousTherapy",
      "previousTherapyDetails", "psychiatricHospitalization", "currentTreatment",
      "diagnosedConditions", "primaryIssue", "secondaryIssues", "issueDescription",
      "severity", "duration", "triggeringSituation", "symptoms", "dailyLifeImpact",
      "sleepQuality", "appetiteChanges", "treatmentGoals", "therapyApproach",
      "concernsAboutTherapy", "availability", "modality", "location", "sessionFrequency",
      "notes", "emergencyContactName", "emergencyContactPhone", "emergencyContactEmail", "emergencyContactRelation",
      "preferredGender", "preferredAge", "languagePreference",
      "culturalConsiderations", "paymentMethod", "profileCompleted"
    ];

    const userUpdates: Record<string, unknown> = {};
    const profileUpdates: Record<string, unknown> = {};
    const medicalProfileUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (allowedUserFields.includes(key)) {
        userUpdates[key] = value;
      }

      if (userToUpdate.role === "professional" || userToUpdate.role === "admin") {
        if (allowedProfileFields.includes(key) && key !== "location") {
          profileUpdates[key] = value;
        }
      } else if (userToUpdate.role === "client") {
        if (allowedMedicalProfileFields.includes(key) && key !== "location") {
          medicalProfileUpdates[key] = value;
        }
      }
    }

    if (
      userToUpdate.role === "professional" &&
      userUpdates.status === "active" &&
      userToUpdate.status === "pending" &&
      userUpdates.professionalLicenseStatus === undefined
    ) {
      userUpdates.professionalLicenseStatus = "verified";
    }
    if (
      userToUpdate.role === "professional" &&
      userUpdates.status === "inactive" &&
      userToUpdate.status === "pending" &&
      userUpdates.professionalLicenseStatus === undefined
    ) {
      userUpdates.professionalLicenseStatus = "rejected";
    }

    // Update user
    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(userId, { $set: userUpdates }, { new: true, runValidators: true });
    }

    // Update profile if there are profile fields
    if (Object.keys(profileUpdates).length > 0) {
      await Profile.findOneAndUpdate(
        { userId: userId },
        { $set: profileUpdates },
        { new: true, upsert: true }
      );
    }
    
    // Update medical profile if there are medical profile fields
    if (Object.keys(medicalProfileUpdates).length > 0) {
      await MedicalProfile.findOneAndUpdate(
        { userId: userId },
        { $set: medicalProfileUpdates },
        { new: true, upsert: true }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin user update error:", error);
    return NextResponse.json(
      { error: "Failed to update user", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/users/[id] — Hard-delete the user and all related records.
// Soft-deactivation lives on the status field ("inactive") and is performed via PUT.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    // Check granular permissions if Admin record exists
    const adminRecord = await Admin.findOne({ userId: session.user.id, isActive: true })
      .select("permissions")
      .lean();

    if (adminRecord?.permissions && !adminRecord.permissions.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: userId } = await params;

    if (!userId || userId === "undefined" || userId.length !== 24) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Prevent admin from deleting themselves
    if (userId === session.user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 },
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    await Promise.all([
      User.deleteOne({ _id: userObjectId }),
      Profile.deleteMany({ userId: userObjectId }),
      MedicalProfile.deleteMany({ userId: userObjectId }),
      Admin.deleteMany({ userId: userObjectId }),
      Appointment.deleteMany({
        $or: [{ clientId: userObjectId }, { professionalId: userObjectId }],
      }),
      ClientDocument.deleteMany({ clientId: userObjectId }),
      ClientReceipt.deleteMany({ clientId: userObjectId }),
      ProfessionalLedgerEntry.deleteMany({ professionalId: userObjectId }),
      Review.deleteMany({
        $or: [{ clientId: userObjectId }, { professionalId: userObjectId }],
      }),
      ResourcePurchase.deleteMany({ userId: userObjectId }),
      Message.deleteMany({ senderId: userObjectId }),
      Conversation.deleteMany({ participants: userObjectId }),
    ]);

    return NextResponse.json({ success: true, message: "User deleted" });
  } catch (error) {
    console.error("Admin user delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete user", details: error instanceof Error ? error.message : error },
      { status: 500 },
    );
  }
}
