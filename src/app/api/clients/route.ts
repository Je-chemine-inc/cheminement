import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { computeClientStatusTier } from "@/lib/client-status-tier";
import type { ClientStatusTier } from "@/lib/client-status-tier";

interface PopulatedUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  paymentGuaranteeStatus?: "none" | "pending_admin" | "green";
}

type ClientAgg = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "inactive" | "pending";
  paymentGuaranteeStatus: "none" | "pending_admin" | "green";
  lastSession: string;
  totalSessions: number;
  issueType: string;
  joinedDate: string;
  statusTier: ClientStatusTier;
  _appointments: Array<{
    status: string;
    payment?: {
      status?: string;
      method?: string;
    };
    awaitingPaymentGuarantee?: boolean;
    sessionCompletedAt?: Date | string | null;
  }>;
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const appointments = await Appointment.find({
      professionalId: session.user.id,
      status: {
        $in: [
          "pending",
          "scheduled",
          "ongoing",
          "completed",
          "no-show",
          "cancelled",
        ],
      },
    })
      .populate(
        "clientId",
        "firstName lastName email phone paymentGuaranteeStatus",
      )
      .populate("professionalId", "firstName lastName email phone")
      .sort({ date: -1 });

    const clientMap = new Map<string, ClientAgg>();

    for (const appointment of appointments) {
      const client = appointment.clientId as unknown as PopulatedUser | null;
      // A deleted client leaves a dangling ref, so populate yields null. This
      // used to throw and 500 the whole endpoint, so ONE orphan appointment
      // emptied the professional's entire client list. Skip the orphan instead.
      if (!client?._id) {
        console.warn(
          `[clients] orphan appointment ${appointment._id} — its client no longer exists; skipping`,
        );
        continue;
      }
      const clientId = client._id.toString();

      const aptSlice = {
        status: appointment.status,
        payment: appointment.payment
          ? {
              status: appointment.payment.status,
              method: appointment.payment.method,
            }
          : undefined,
        awaitingPaymentGuarantee: appointment.awaitingPaymentGuarantee,
        sessionCompletedAt: appointment.sessionCompletedAt,
      };

      if (!clientMap.has(clientId)) {
        const lastS = appointment.date
          ? appointment.date.toISOString().split("T")[0]
          : "N/A";
        clientMap.set(clientId, {
          id: clientId,
          name: `${client.firstName} ${client.lastName}`,
          email: client.email,
          phone: client.phone,
          status: "active",
          paymentGuaranteeStatus: client.paymentGuaranteeStatus ?? "none",
          lastSession: lastS,
          totalSessions: 1,
          issueType: "Not specified",
          joinedDate: lastS,
          statusTier: "yellow",
          _appointments: [aptSlice],
        });
      } else {
        const existingClient = clientMap.get(clientId)!;
        existingClient.totalSessions += 1;
        existingClient._appointments.push(aptSlice);

        const g = (s: string | undefined) => s ?? "none";
        const cur = g(existingClient.paymentGuaranteeStatus);
        const next = g(client.paymentGuaranteeStatus);
        if (cur === "green" || next === "green") {
          existingClient.paymentGuaranteeStatus = "green";
        } else if (cur === "pending_admin" || next === "pending_admin") {
          existingClient.paymentGuaranteeStatus = "pending_admin";
        } else {
          existingClient.paymentGuaranteeStatus = "none";
        }

        if (
          appointment.date &&
          existingClient.lastSession !== "N/A" &&
          new Date(appointment.date) > new Date(existingClient.lastSession)
        ) {
          existingClient.lastSession = appointment.date
            .toISOString()
            .split("T")[0];
        } else if (appointment.date && existingClient.lastSession === "N/A") {
          existingClient.lastSession = appointment.date
            .toISOString()
            .split("T")[0];
        }

        if (
          appointment.date &&
          existingClient.joinedDate !== "N/A" &&
          new Date(appointment.date) < new Date(existingClient.joinedDate)
        ) {
          existingClient.joinedDate = appointment.date
            .toISOString()
            .split("T")[0];
        } else if (appointment.date && existingClient.joinedDate === "N/A") {
          existingClient.joinedDate = appointment.date
            .toISOString()
            .split("T")[0];
        }
      }
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const clients = Array.from(clientMap.values()).map((c) => {
      c.status =
        c.lastSession !== "N/A" && new Date(c.lastSession) >= thirtyDaysAgo
          ? "active"
          : "inactive";

      c.statusTier = computeClientStatusTier(
        c.paymentGuaranteeStatus,
        c._appointments,
      );

      const { _appointments: _, ...rest } = c;
      return rest;
    });

    return NextResponse.json(clients);
  } catch (error) {
    console.error("Get clients error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch clients",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
