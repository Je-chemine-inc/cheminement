import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import Profile from "@/models/Profile";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "all";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    // Build query for professionals
    const query: any = { role: "professional" };

    if (status !== "all") {
      query.status = status;
    }

    // Add search functionality
    if (search.trim()) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { specialty: { $regex: search, $options: "i" } },
      ];
    }

    // Get professionals with pagination
    const skip = (page - 1) * limit;
    const professionals = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const total = await User.countDocuments(query);

    // Whether each pro is currently accepting new clients / emergency
    // consultations (Profile flags). Legacy/undefined profiles default to
    // accepting (only an explicit false opts out).
    const profileFlags = await Profile.find({
      userId: { $in: professionals.map((p) => p._id) },
    }).select("userId acceptingNewClients acceptingEmergencyConsultations");
    const acceptingById = new Map(
      profileFlags.map((p) => [
        String(p.userId),
        p.acceptingNewClients !== false,
      ]),
    );
    const acceptingEmergencyById = new Map(
      profileFlags.map((p) => [
        String(p.userId),
        p.acceptingEmergencyConsultations !== false,
      ]),
    );

    // Get session and client counts for each professional
    const professionalsWithStats = await Promise.all(
      professionals.map(async (professional) => {
        const prof = professional as any; // Cast to any to access optional fields that may not be in the type
        const totalSessions = await Appointment.countDocuments({
          professionalId: professional._id,
          status: "completed",
        });

        const activeClients = await Appointment.distinct("clientId", {
          professionalId: professional._id,
          status: { $in: ["scheduled", "completed"] },
        });

        return {
          id: professional._id.toString(),
          name: `${professional.firstName} ${professional.lastName}`,
          email: professional.email,
          specialty: prof.specialty || "General Practice",
          license: prof.license || "Pending",
          status: professional.status,
          acceptingNewClients:
            acceptingById.get(professional._id.toString()) ?? true,
          acceptingEmergencyConsultations:
            acceptingEmergencyById.get(professional._id.toString()) ?? true,
          joinedDate: professional.createdAt.toISOString().split("T")[0],
          totalClients: activeClients.length,
          totalSessions,
        };
      }),
    );

    // Get summary stats
    const totalProfessionals = await User.countDocuments({
      role: "professional",
    });
    const activeProfessionals = await User.countDocuments({
      role: "professional",
      status: "active",
    });
    const pendingProfessionals = await User.countDocuments({
      role: "professional",
      status: "pending",
    });
    const totalSessions = await Appointment.countDocuments({
      status: "completed",
    });

    return NextResponse.json({
      professionals: professionalsWithStats,
      summary: {
        totalProfessionals,
        activeProfessionals,
        pendingProfessionals,
        totalSessions,
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Admin professionals API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch professionals data",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
