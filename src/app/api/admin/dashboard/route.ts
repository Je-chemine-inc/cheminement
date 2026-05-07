import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { getAppointmentStartAt } from "@/lib/appointment-start";
import { clientLacksPaymentGuaranteeForAppointment } from "@/lib/client-payment-guarantee";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    // Get current date for calculations
    const now = new Date();
    const lastMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      now.getDate(),
    );
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch all required data in parallel
    const [
      totalProfessionals,
      totalPatients,
      totalSessions,
      totalRevenue,
      recentUsers,
      recentAppointments,
      topProfessionalsData,
    ] = await Promise.all([
      // Total professionals
      User.countDocuments({
        role: "professional",
        status: { $ne: "inactive" },
      }),

      // Total patients
      User.countDocuments({ role: "client", status: { $ne: "inactive" } }),

      // Total sessions (all time)
      Appointment.countDocuments(),

      // Calculate revenue (assuming $80 per session)
      Appointment.countDocuments({ status: "completed" }).then(
        (count) => count * 80,
      ),

      // Recent users (last 7 days)
      User.find({
        createdAt: { $gte: lastWeek },
      })
        .select("firstName lastName role createdAt")
        .sort({ createdAt: -1 })
        .limit(10),

      // Recent appointments (last 7 days)
      Appointment.find({
        createdAt: { $gte: lastWeek },
      })
        .populate("professionalId", "firstName lastName")
        .populate("clientId", "firstName lastName")
        .sort({ createdAt: -1 })
        .limit(10),

      // Top professionals by completed sessions
      Appointment.aggregate([
        {
          $match: { status: "completed" },
        },
        {
          $group: {
            _id: "$professionalId",
            sessionsCount: { $sum: 1 },
            totalRevenue: { $sum: 80 }, // Assuming $80 per session
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "professional",
          },
        },
        {
          $unwind: "$professional",
        },
        {
          $project: {
            name: {
              $concat: [
                "$professional.firstName",
                " ",
                "$professional.lastName",
              ],
            },
            sessions: "$sessionsCount",
            revenue: "$totalRevenue",
            // Mock rating for now - in real app, this would come from reviews
            rating: {
              $add: [4.5, { $divide: [{ $mod: ["$sessionsCount", 5] }, 10] }],
            },
          },
        },
        {
          $sort: { sessions: -1 },
        },
        {
          $limit: 5,
        },
      ]),
    ]);

    // Calculate growth percentages (comparing to last month)
    const lastMonthProfessionals = await User.countDocuments({
      role: "professional",
      status: { $ne: "inactive" },
      createdAt: { $lt: lastMonth },
    });
    const lastMonthPatients = await User.countDocuments({
      role: "client",
      status: { $ne: "inactive" },
      createdAt: { $lt: lastMonth },
    });
    const lastMonthSessions = await Appointment.countDocuments({
      createdAt: { $lt: lastMonth },
    });

    const professionalsChange =
      lastMonthProfessionals > 0
        ? ((totalProfessionals - lastMonthProfessionals) /
            lastMonthProfessionals) *
          100
        : 0;
    const patientsChange =
      lastMonthPatients > 0
        ? ((totalPatients - lastMonthPatients) / lastMonthPatients) * 100
        : 0;
    const sessionsChange =
      lastMonthSessions > 0
        ? ((totalSessions - lastMonthSessions) / lastMonthSessions) * 100
        : 0;

    // Calculate revenue change
    const lastMonthRevenue = await Appointment.countDocuments({
      status: "completed",
      createdAt: { $lt: lastMonth },
    }).then((count) => count * 80);
    const revenueChange =
      lastMonthRevenue > 0
        ? ((totalRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
        : 0;

    // Format recent activity
    const recentActivity = [
      ...recentUsers.map((user, index) => ({
        id: `user_${index}`,
        type: "user_joined",
        message: `${user.firstName} ${user.lastName} joined as ${user.role}`,
        time: `${Math.floor((now.getTime() - user.createdAt.getTime()) / (1000 * 60 * 60))} hours ago`,
        icon: "CheckCircle2",
        color: "text-green-600",
      })),
      ...recentAppointments.slice(0, 3).map((appointment, index) => {
        const professional = appointment.professionalId as any;
        return {
          id: `appointment_${index}`,
          type: "session_completed",
          message: `Session completed with ${professional?.firstName} ${professional?.lastName}`,
          time: `${Math.floor((now.getTime() - appointment.createdAt.getTime()) / (1000 * 60 * 60))} hours ago`,
          icon: "Activity",
          color: "text-blue-600",
        };
      }),
    ]
      .sort((a, b) => {
        // Sort by time (most recent first)
        const aHours = parseInt(a.time.split(" ")[0]);
        const bHours = parseInt(b.time.split(" ")[0]);
        return aHours - bHours;
      })
      .slice(0, 5);

    // Add pending professionals count
    const pendingProfessionals = await User.countDocuments({
      role: "professional",
      status: "pending",
    });

    // Payment-method flags: clients with an upcoming session within 48h who
    // have not configured a payment method (card / PAD / approved Interac).
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
    const upcomingCutoff = new Date(now.getTime() + TWO_DAYS_MS);
    const upcomingForFlags = await Appointment.find({
      status: "scheduled",
      $or: [
        { scheduledStartAt: { $gte: now, $lte: upcomingCutoff } },
        { date: { $gte: now, $lte: upcomingCutoff } },
      ],
    })
      .populate("clientId", "firstName lastName email paymentGuaranteeStatus paymentGuaranteeSource")
      .populate("professionalId", "firstName lastName")
      .lean();

    const flagSeenClients = new Set<string>();
    const paymentFlags: Array<{
      appointmentId: string;
      clientId: string;
      clientName: string;
      clientEmail: string;
      professionalName: string | null;
      sessionAt: string | null;
      hoursUntilSession: number | null;
    }> = [];

    for (const apt of upcomingForFlags) {
      const start = getAppointmentStartAt({
        date: apt.date as Date | undefined,
        time: apt.time as string | undefined,
        scheduledStartAt: apt.scheduledStartAt as Date | undefined,
      });
      if (!start) continue;
      const msUntil = start.getTime() - now.getTime();
      if (msUntil < 0 || msUntil > TWO_DAYS_MS) continue;

      const clientPop = apt.clientId as unknown as {
        _id: { toString: () => string };
        firstName?: string;
        lastName?: string;
        email?: string;
        paymentGuaranteeStatus?: string;
        paymentGuaranteeSource?: string;
      } | null;
      if (!clientPop) continue;
      const clientIdStr = clientPop._id.toString();
      if (flagSeenClients.has(clientIdStr)) continue;

      const lacks = clientLacksPaymentGuaranteeForAppointment(
        apt as { payment?: { stripePaymentMethodId?: string; method?: string } },
        {
          paymentGuaranteeStatus: clientPop.paymentGuaranteeStatus,
          paymentGuaranteeSource: clientPop.paymentGuaranteeSource,
        } as never,
      );
      if (!lacks) continue;

      flagSeenClients.add(clientIdStr);

      const professionalPop = apt.professionalId as unknown as {
        firstName?: string;
        lastName?: string;
      } | null;
      const professionalName = professionalPop
        ? [professionalPop.firstName, professionalPop.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || null
        : null;

      paymentFlags.push({
        appointmentId: (apt._id as { toString: () => string }).toString(),
        clientId: clientIdStr,
        clientName:
          [clientPop.firstName, clientPop.lastName].filter(Boolean).join(" ").trim() ||
          clientPop.email ||
          clientIdStr,
        clientEmail: clientPop.email || "",
        professionalName,
        sessionAt: start.toISOString(),
        hoursUntilSession: Math.max(0, Math.round(msUntil / (60 * 60 * 1000))),
      });
    }

    paymentFlags.sort((a, b) => {
      const aH = a.hoursUntilSession ?? Number.POSITIVE_INFINITY;
      const bH = b.hoursUntilSession ?? Number.POSITIVE_INFINITY;
      return aH - bH;
    });

    if (pendingProfessionals > 0) {
      recentActivity.unshift({
        id: "pending_professionals",
        type: "pending_approval",
        message: `${pendingProfessionals} professional${pendingProfessionals > 1 ? "s" : ""} pending approval`,
        time: "Recently",
        icon: "Clock",
        color: "text-yellow-600",
      });
    }

    const dashboardData = {
      stats: {
        totalProfessionals,
        professionalsChange: Math.round(professionalsChange * 100) / 100,
        totalPatients,
        patientsChange: Math.round(patientsChange * 100) / 100,
        totalSessions,
        sessionsChange: Math.round(sessionsChange * 100) / 100,
        totalRevenue,
        revenueChange: Math.round(revenueChange * 100) / 100,
      },
      recentActivity,
      topProfessionals: topProfessionalsData,
      pendingApprovals: pendingProfessionals,
      paymentFlags,
    };

    return NextResponse.json(dashboardData);
  } catch (error: any) {
    console.error("Admin dashboard API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch dashboard data",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
