import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import Review from "@/models/Review";
import { ResourcePurchase } from "@/models/Resource";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "month";

    // Calculate date ranges based on period
    const now = new Date();
    let startDate: Date;
    let previousStartDate: Date;

    switch (period) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        previousStartDate = new Date(
          startDate.getTime() - 7 * 24 * 60 * 60 * 1000,
        );
        break;
      case "quarter":
        startDate = new Date(
          now.getFullYear(),
          Math.floor(now.getMonth() / 3) * 3,
          1,
        );
        previousStartDate = new Date(startDate);
        previousStartDate.setMonth(previousStartDate.getMonth() - 3);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        previousStartDate = new Date(now.getFullYear() - 1, 0, 1);
        break;
      case "month":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        previousStartDate = new Date(startDate);
        previousStartDate.setMonth(previousStartDate.getMonth() - 1);
        break;
    }

    // Get current period metrics
    const [currentMetrics, previousMetrics] = await Promise.all([
      // Current period
      Promise.all([
        User.countDocuments({
          role: "professional",
          status: { $ne: "inactive" },
          createdAt: { $gte: startDate },
        }),
        User.countDocuments({
          role: "client",
          status: { $ne: "inactive" },
          createdAt: { $gte: startDate },
        }),
        Appointment.countDocuments({
          status: "completed",
          date: { $gte: startDate },
        }),
        Appointment.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: startDate },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$payment.price" }, // Use actual payment price
            },
          },
        ]),
      ]),
      // Previous period
      Promise.all([
        User.countDocuments({
          role: "professional",
          status: { $ne: "inactive" },
          createdAt: { $gte: previousStartDate, $lt: startDate },
        }),
        User.countDocuments({
          role: "client",
          status: { $ne: "inactive" },
          createdAt: { $gte: previousStartDate, $lt: startDate },
        }),
        Appointment.countDocuments({
          status: "completed",
          date: { $gte: previousStartDate, $lt: startDate },
        }),
        Appointment.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: previousStartDate, $lt: startDate },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$payment.price" }, // Use actual payment price
            },
          },
        ]),
      ]),
    ]);

    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100 * 100) / 100;
    };

    const currentRevenue = currentMetrics[3][0]?.totalRevenue || 0;
    const previousRevenue = previousMetrics[3][0]?.totalRevenue || 0;

    const metrics = {
      totalRevenue: currentRevenue,
      revenueChange: calculateChange(currentRevenue, previousRevenue),
      totalSessions: currentMetrics[2],
      sessionsChange: calculateChange(currentMetrics[2], previousMetrics[2]),
      activeProfessionals: currentMetrics[0],
      professionalsChange: calculateChange(
        currentMetrics[0],
        previousMetrics[0],
      ),
      activePatients: currentMetrics[1],
      patientsChange: calculateChange(currentMetrics[1], previousMetrics[1]),
    };

    // Get revenue breakdown
    const [appointmentRevenue, resourceRevenue, entitlementRevenue] =
      await Promise.all([
      // Session fees from appointments
      Appointment.aggregate([
        {
          $match: {
            status: "completed",
            date: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: null,
            sessionFees: { $sum: "$payment.price" },
          },
        },
      ]),
      // Resource sales revenue (when implemented)
      ResourcePurchase.aggregate([
        {
          $match: {
            paymentStatus: "completed",
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: null,
            resourceRevenue: { $sum: "$price" },
          },
        },
      ]).catch(() => [{ resourceRevenue: 0 }]), // Fallback if collection doesn't exist yet
      // Premium ContentEntry resources (the live path; the aggregate above is
      // the dormant Resource model and has no rows).
      //
      // Two deliberate differences from it: this filters on paidAt rather than
      // createdAt, so a pending row's creation date is not counted as revenue;
      // and status "paid" means a later refund removes the sale from its
      // original period. That is right for "revenue we still hold", but it does
      // make past periods mutable — do not "fix" it by counting refunded rows.
      ResourceEntitlement.aggregate([
        { $match: { status: "paid", paidAt: { $gte: startDate } } },
        { $group: { _id: null, cents: { $sum: "$amountCents" } } },
      ]).catch(() => [{ cents: 0 }]),
    ]);

    const breakdown = {
      sessionFees: appointmentRevenue[0]?.sessionFees || 0,
      resourceSales:
        (resourceRevenue[0]?.resourceRevenue || 0) +
        (entitlementRevenue[0]?.cents || 0) / 100,
    };
    const totalRevenue = breakdown.sessionFees + breakdown.resourceSales;

    // Get top issue types
    const issueTypes = await Appointment.aggregate([
      {
        $match: {
          status: "completed",
          date: { $gte: startDate },
          issueType: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$issueType",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: 5,
      },
    ]);

    // Get professional performance data
    const professionalPerformance = await Appointment.aggregate([
      {
        $match: {
          status: "completed",
          date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            professionalId: "$professionalId",
            clientId: "$clientId",
          },
          sessionsCount: { $sum: 1 },
          totalRevenue: { $sum: "$payment.price" }, // Use actual payment price
        },
      },
      {
        $group: {
          _id: "$_id.professionalId",
          totalSessions: { $sum: "$sessionsCount" },
          totalRevenue: { $sum: "$totalRevenue" },
          activeClients: { $addToSet: "$_id.clientId" },
        },
      },
      {
        $project: {
          _id: 1,
          totalSessions: 1,
          totalRevenue: 1,
          activeClientsCount: { $size: "$activeClients" },
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
        $lookup: {
          from: "reviews",
          localField: "_id",
          foreignField: "professionalId",
          as: "reviews",
        },
      },
      {
        $project: {
          name: {
            $concat: ["$professional.firstName", " ", "$professional.lastName"],
          },
          totalSessions: 1,
          activeClients: "$activeClientsCount",
          revenueGenerated: "$totalRevenue",
          reviewCount: { $size: "$reviews" },
          avgRating: {
            $cond: {
              if: { $gt: [{ $size: "$reviews" }, 0] },
              then: { $avg: "$reviews.rating" },
              else: {
                // Fallback to calculated mock rating based on performance
                $add: [
                  4.0, // Base rating
                  {
                    $divide: [
                      {
                        $min: [
                          { $multiply: ["$activeClientsCount", 0.1] },
                          0.5,
                        ],
                      },
                      1,
                    ],
                  },
                  {
                    $divide: [
                      { $min: [{ $multiply: ["$totalSessions", 0.01] }, 0.4] },
                      1,
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $sort: { totalSessions: -1 },
      },
      {
        $limit: 5,
      },
    ]);

    return NextResponse.json({
      metrics,
      revenueBreakdown: {
        sessionFees: breakdown.sessionFees,
        resourceSales: breakdown.resourceSales,
        total: totalRevenue,
      },
      topIssueTypes: issueTypes.map((item) => ({
        type: item._id,
        sessions: item.count,
      })),
      professionalPerformance,
    });
  } catch (error: any) {
    console.error("Admin reports API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch reports data",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
