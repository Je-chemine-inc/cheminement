import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User, { type IUser } from "@/models/User";
import Organization from "@/models/Organization";
import OrganizationInvoice from "@/models/OrganizationInvoice";
import { authOptions } from "@/lib/auth";
import { paymentAssurance } from "@/lib/client-payment-guarantee";

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
      } else if (status === "covered") {
        query["payment.status"] = "covered";
      }
    }

    // M16: push search into the Mongo query so it matches across ALL pages and
    // the pagination total is correct. The previous code filtered only the
    // current page in memory and faked `total` as (page matches × 2), breaking
    // navigation and hiding matches on other pages. Client/professional names
    // live on the populated User docs, so resolve matching users first, then
    // filter appointments by their ids. NOTE: the SES-xxxxxx session-id search
    // is derived from _id and not server-queryable, so it is no longer
    // supported — search by client/professional name or email instead.
    if (search.trim()) {
      const rx = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      const matchedUsers = await User.find({
        $or: [{ firstName: rx }, { lastName: rx }, { email: rx }],
      })
        .select("_id")
        .lean();
      const userIds = matchedUsers.map((u) => u._id);
      query.$or = [
        { clientId: { $in: userIds } },
        { professionalId: { $in: userIds } },
        // The REAL invoice number + the Interac reference are stored fields, so
        // searching by "numéro de facture" works again (the SES-xxxxxx id was
        // derived from _id and not queryable).
        { invoiceNumber: rx },
        { "payment.interacReferenceCode": rx },
      ];
    }

    const skip = (page - 1) * limit;
    const appointments = await Appointment.find(query)
      // Admin-only route: the payer snapshot (select:false) says who pays the
      // part the client does not (spec 002).
      .select("+thirdPartyBilling")
      // The guarantee fields say whether a card is really on file, so the
      // method badge can stop claiming one for every "card" session.
      .populate(
        "clientId",
        "firstName lastName email paymentGuaranteeStatus paymentGuaranteeSource preferredPaymentMethod",
      )
      .populate("professionalId", "firstName lastName")
      .sort({ date: -1, time: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Appointment.countDocuments(query);

    // Spec 002 phase 6: name the payer — the organization, and the invoice the
    // session went out on. Two batched lookups for the page, never per row.
    const orgIds = appointments
      .map((a) => a.thirdPartyBilling?.organizationId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    const invoiceIds = appointments
      .map((a) => a.thirdPartyBilling?.orgInvoiceId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    const [orgs, orgInvoices] = await Promise.all([
      orgIds.length
        ? Organization.find({ _id: { $in: orgIds } }).select("name").lean()
        : Promise.resolve([]),
      invoiceIds.length
        ? OrganizationInvoice.find({ _id: { $in: invoiceIds } }).select("number status").lean()
        : Promise.resolve([]),
    ]);
    const orgNameOf = new Map(orgs.map((o) => [String(o._id), o.name]));
    const invoiceOf = new Map(orgInvoices.map((i) => [String(i._id), i]));

    const payments = appointments.map((appointment) => {
      const client = appointment.clientId as {
        _id?: { toString: () => string };
        firstName?: string;
        lastName?: string;
        email?: string;
      } & Pick<
        IUser,
        "paymentGuaranteeStatus" | "paymentGuaranteeSource" | "preferredPaymentMethod"
      >;
      const professional = appointment.professionalId as {
        firstName?: string;
        lastName?: string;
      };

      // Derive display status from real payment.status, falling back to date-based logic
      const rawPaymentStatus = appointment.payment?.status;
      let paymentStatus:
        | "paid"
        | "pending"
        | "upcoming"
        | "processing"
        | "overdue"
        | "covered";

      if (rawPaymentStatus === "paid") {
        paymentStatus = "paid";
      } else if (rawPaymentStatus === "covered") {
        // The client owes nothing: never "pending"/"overdue", never chased.
        paymentStatus = "covered";
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
        // The REAL invoice number issued at session closure (e.g. JC-2026-000004)
        // — the SAME one shown in the client's payment email. The SES-xxxxxx id
        // above is only a fallback for appointments with no invoice yet.
        invoiceNumber: appointment.invoiceNumber ?? undefined,
        // The client's user id — lets the admin UI deep-link "Aperçu" to the
        // patient record focused on this appointment (the full meeting detail).
        clientId: client?._id ? client._id.toString() : undefined,
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
        // `amount` is what the CLIENT owes; fee and payout are for the whole
        // session — with a third party they come from the payer snapshot.
        amount: appointment.payment?.price ?? 120,
        platformFee: appointment.thirdPartyBilling
          ? appointment.thirdPartyBilling.platformFeeTotalCents / 100
          : (appointment.payment?.platformFee ?? 12),
        professionalPayout: appointment.thirdPartyBilling
          ? appointment.thirdPartyBilling.proPayoutTotalCents / 100
          : (appointment.payment?.professionalPayout ?? 108),
        status: paymentStatus,
        // Spec 002: who pays the rest, and whether an admin still has to decide.
        payer: appointment.thirdPartyBilling
          ? {
              kind: appointment.thirdPartyBilling.kind,
              state: appointment.thirdPartyBilling.state,
              orgAmount: (appointment.thirdPartyBilling.orgAmountCents ?? 0) / 100,
              organizationName: appointment.thirdPartyBilling.organizationId
                ? (orgNameOf.get(String(appointment.thirdPartyBilling.organizationId)) ?? "")
                : "",
              externalLabel: appointment.thirdPartyBilling.externalPayerLabel ?? "",
              orgStatus: appointment.thirdPartyBilling.orgStatus,
              orgInvoiceNumber: appointment.thirdPartyBilling.orgInvoiceId
                ? (invoiceOf.get(String(appointment.thirdPartyBilling.orgInvoiceId))?.number ?? "")
                : "",
            }
          : undefined,
        paymentMethod: appointment.payment?.method ?? undefined,
        // What the method badge may claim — derived here so the card
        // reference itself never leaves the server.
        assurance: paymentAssurance(appointment, client ?? null),
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
