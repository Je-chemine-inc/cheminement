import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
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
    const paymentMethod = searchParams.get("paymentMethod") || "all";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const query: Record<string, unknown> = {
      status: { $in: ["completed", "scheduled", "cancelled", "no-show"] },
    };

    // Date range filter (appointment date)
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
      query.date = dateFilter;
    }

    // Payment method filter
    if (paymentMethod !== "all") {
      query["payment.method"] = paymentMethod;
    }

    // Status filter
    if (status !== "all") {
      if (status === "paid") {
        query["payment.status"] = "paid";
      } else if (status === "overdue") {
        query["payment.status"] = "overdue";
      } else if (status === "pending") {
        query["payment.status"] = { $in: ["pending", "processing"] };
        query.status = "scheduled";
      } else if (status === "upcoming") {
        query.status = "scheduled";
        query.date = { ...(query.date as object ?? {}), $gte: new Date() };
      } else if (status === "processing") {
        query["payment.status"] = "processing";
      }
    }

    const skip = (page - 1) * limit;
    const appointments = await Appointment.find(query)
      .populate("clientId", "firstName lastName email")
      .populate("professionalId", "firstName lastName")
      .sort({ date: -1, time: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    let filteredAppointments = appointments;
    if (search.trim()) {
      const term = search.toLowerCase();
      filteredAppointments = appointments.filter((appointment) => {
        const client = appointment.clientId as {
          firstName?: string;
          lastName?: string;
          email?: string;
        };
        const professional = appointment.professionalId as {
          firstName?: string;
          lastName?: string;
        };
        const sessionId = `SES-${appointment._id.toString().slice(-6).toUpperCase()}`;
        return (
          client?.firstName?.toLowerCase().includes(term) ||
          client?.lastName?.toLowerCase().includes(term) ||
          client?.email?.toLowerCase().includes(term) ||
          professional?.firstName?.toLowerCase().includes(term) ||
          professional?.lastName?.toLowerCase().includes(term) ||
          sessionId.toLowerCase().includes(term)
        );
      });
    }

    const total = search.trim()
      ? filteredAppointments.length * 2
      : await Appointment.countDocuments(query);

    const payments = filteredAppointments.map((appointment) => {
      const client = appointment.clientId as {
        firstName?: string;
        lastName?: string;
        email?: string;
      };
      const professional = appointment.professionalId as {
        firstName?: string;
        lastName?: string;
      };

      // Derive display status from real payment.status, falling back to date-based logic
      const rawPaymentStatus = appointment.payment?.status;
      let paymentStatus: "paid" | "pending" | "upcoming" | "processing" | "overdue";

      if (rawPaymentStatus === "paid") {
        paymentStatus = "paid";
      } else if (rawPaymentStatus === "overdue") {
        paymentStatus = "overdue";
      } else if (rawPaymentStatus === "processing") {
        paymentStatus = "processing";
      } else {
        const appointmentDate = appointment.date ? new Date(appointment.date) : new Date();
        if (appointment.status === "scheduled" && appointmentDate > new Date()) {
          paymentStatus = "upcoming";
        } else {
          paymentStatus = "pending";
        }
      }

      return {
        id: appointment._id.toString(),
        sessionId: `SES-${appointment._id.toString().slice(-6).toUpperCase()}`,
        client: client
          ? `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim()
          : "—",
        professional: professional
          ? `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim()
          : "—",
        date: appointment.date
          ? new Date(appointment.date).toISOString().split("T")[0]
          : "N/A",
        sessionDate: appointment.date
          ? `${new Date(appointment.date).toISOString().split("T")[0]} ${appointment.time || ""}`.trim()
          : "N/A",
        amount: appointment.payment?.price ?? 120,
        platformFee: appointment.payment?.platformFee ?? 12,
        professionalPayout: appointment.payment?.professionalPayout ?? 108,
        status: paymentStatus,
        paymentMethod: appointment.payment?.method ?? undefined,
        paidDate: appointment.payment?.paidAt
          ? new Date(appointment.payment.paidAt).toISOString().split("T")[0]
          : undefined,
        invoiceUrl: rawPaymentStatus === "paid" ? "#" : undefined,
        // Interac-specific fields
        interacReferenceCode: appointment.payment?.interacReferenceCode ?? undefined,
        transferDueAt: appointment.payment?.transferDueAt
          ? new Date(appointment.payment.transferDueAt).toISOString()
          : undefined,
        interacReminder24hSent: appointment.interacReminder24hSent ?? false,
        interacReminder48hSent: appointment.interacReminder48hSent ?? false,
      };
    });

    // Summary stats
    const allAppointments = await Appointment.find({
      status: { $in: ["completed", "scheduled", "cancelled", "no-show"] },
    })
      .select("payment status date")
      .lean();

    const stats = {
      totalRevenue: allAppointments
        .filter((p) => p.payment?.status === "paid")
        .reduce((sum, apt) => sum + (apt.payment?.platformFee ?? 12), 0),
      pendingRevenue: allAppointments
        .filter((p) => p.payment?.status !== "paid" && p.payment?.status !== "refunded")
        .reduce((sum, apt) => sum + (apt.payment?.platformFee ?? 12), 0),
      professionalPayouts: allAppointments
        .filter((p) => p.payment?.status === "paid")
        .reduce((sum, apt) => sum + (apt.payment?.professionalPayout ?? 108), 0),
      totalTransactions: allAppointments.filter((p) => p.payment?.status === "paid").length,
      overdueCount: allAppointments.filter(
        (p) => p.payment?.status === "overdue",
      ).length,
      interacPendingCount: allAppointments.filter(
        (p) =>
          p.payment?.method === "transfer" &&
          p.payment?.status !== "paid" &&
          p.payment?.status !== "refunded" &&
          p.payment?.status !== "cancelled",
      ).length,
    };

    return NextResponse.json({
      payments,
      summary: stats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Admin billing API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch billing data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
