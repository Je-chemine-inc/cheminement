import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  canReprice,
  computeRepriceAmounts,
  LOCKED_PAYMENT_STATUSES,
  repriceSetPaths,
} from "@/lib/appointment-reprice";
import { calculateAppointmentPricing } from "@/lib/pricing";

/** Cap a single request so an admin cannot rewrite the whole table by accident. */
const MAX_IDS = 200;

/**
 * Admin bulk re-price.
 *
 * `GET  ?professionalId=…` lists that professional's **unpaid, upcoming**
 * appointments together with what each would become under the professional's
 * currently-configured pricing — the list an admin sees after changing a rate.
 *
 * `POST { appointmentIds: [...] }` applies it to the **explicitly selected**
 * ids only. Nothing is implicit: a pricing change never cascades on its own, and
 * paid/refunded/receipted appointments are skipped and reported rather than
 * silently included.
 */

interface Row {
  id: string;
  date: Date | null;
  therapyType: string;
  current: { price?: number; platformFee?: number; professionalPayout?: number };
  proposed: { price: number; platformFee: number; professionalPayout: number };
  changed: boolean;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Unpaid and not yet settled — the only appointments a re-price may touch. */
function unpaidUpcomingFilter(professionalId: string) {
  return {
    professionalId: new mongoose.Types.ObjectId(professionalId),
    fiscalReceiptIssuedAt: { $in: [null, undefined] },
    "payment.status": { $nin: [...LOCKED_PAYMENT_STATUSES] },
    // Only forward-looking work; past sessions are settled through closure.
    date: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  };
}

export async function GET(req: NextRequest) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const professionalId = req.nextUrl.searchParams.get("professionalId");
    if (!professionalId || !mongoose.Types.ObjectId.isValid(professionalId)) {
      return NextResponse.json({ error: "Invalid professionalId" }, { status: 400 });
    }

    await connectToDatabase();

    const appointments = await Appointment.find(
      unpaidUpcomingFilter(professionalId),
    ).sort({ date: 1 });

    const rows: Row[] = [];
    for (const apt of appointments) {
      const therapyType = (apt.therapyType as "solo" | "couple" | "group") || "solo";
      const pricing = await calculateAppointmentPricing(professionalId, therapyType);

      const current = {
        price: apt.payment?.price,
        platformFee: apt.payment?.platformFee,
        professionalPayout: apt.payment?.professionalPayout,
      };
      const proposed = {
        price: pricing.sessionPrice,
        platformFee: pricing.platformFee,
        professionalPayout: pricing.professionalPayout,
      };

      rows.push({
        id: String(apt._id),
        date: apt.date ?? null,
        therapyType,
        current,
        proposed,
        changed:
          current.price !== proposed.price ||
          current.professionalPayout !== proposed.professionalPayout,
      });
    }

    return NextResponse.json({ appointments: rows });
  } catch (err: unknown) {
    console.error("Bulk reprice preview error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const body = await req.json();
    const ids: unknown = body?.appointmentIds;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "NO_APPOINTMENTS_SELECTED" }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ error: "TOO_MANY_APPOINTMENTS" }, { status: 400 });
    }
    if (!ids.every((i) => typeof i === "string" && mongoose.Types.ObjectId.isValid(i))) {
      return NextResponse.json({ error: "INVALID_APPOINTMENT_ID" }, { status: 400 });
    }

    await connectToDatabase();

    const repriced: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const id of ids as string[]) {
      const apt = await Appointment.findById(id);
      if (!apt) {
        skipped.push({ id, reason: "NOT_FOUND" });
        continue;
      }

      // Re-check per appointment: the list may be stale, and a session could
      // have been paid between preview and apply.
      const allowed = canReprice(apt);
      if (!allowed.ok) {
        skipped.push({ id, reason: allowed.reason });
        continue;
      }

      const therapyType = (apt.therapyType as "solo" | "couple" | "group") || "solo";
      const pricing = await calculateAppointmentPricing(
        apt.professionalId ? String(apt.professionalId) : null,
        therapyType,
      );

      const computed = computeRepriceAmounts(
        pricing.sessionPrice,
        pricing.professionalPayout,
      );
      if (!computed.ok) {
        skipped.push({ id, reason: computed.reason });
        continue;
      }

      await Appointment.findOneAndUpdate(
        { _id: id },
        { $set: repriceSetPaths(computed.amounts) },
      );
      repriced.push(id);
    }

    return NextResponse.json({
      repricedCount: repriced.length,
      repriced,
      skipped,
    });
  } catch (err: unknown) {
    console.error("Bulk reprice error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
