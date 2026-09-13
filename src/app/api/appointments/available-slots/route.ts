import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Profile from "@/models/Profile";
import User from "@/models/User";
import PlatformSettings from "@/models/PlatformSettings";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  computeFreeSlots,
  isDayKey,
  slotGridOf,
  weekdayOf,
  workingHoursOf,
} from "@/lib/available-slots";
import { loadOccupiedIntervals } from "@/lib/slot-occupancy";

/**
 * GET /api/appointments/available-slots?date=YYYY-MM-DD[&professionalId=] —
 * a professional's free times on one day, for the schedule modal of the
 * proposals page.
 *
 * A professional reads their own grid; an admin may name one. The route used
 * to answer anyone who passed a professionalId, looked for booked sessions at
 * UTC midnight while every row is stored at UTC noon (so a booked time never
 * left the grid), and knew nothing of overlaps or held requests. Slots now come
 * from the computation the public pages use (spec 003 phase 3), without a lead
 * time; the response shape is unchanged.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== "professional" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const requested = searchParams.get("professionalId");
    const dateStr = searchParams.get("date");

    if (role === "professional" && requested && requested !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const professionalId = role === "admin" ? requested : session.user.id;

    if (!professionalId || !dateStr) {
      return NextResponse.json(
        { error: "Missing required parameters: professionalId and date" },
        { status: 400 },
      );
    }
    if (!isDayKey(dateStr)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    if (!mongoose.Types.ObjectId.isValid(professionalId)) {
      return NextResponse.json({ error: "Professional not found" }, { status: 404 });
    }
    if (!rateLimit(`available-slots:${session.user.id}`, 120, 60 * 1000).allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    await connectToDatabase();

    // Verify professional exists
    const professional = await User.findOne({
      _id: professionalId,
      role: "professional",
      status: { $in: ["active", "pending"] },
    });

    if (!professional) {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }

    // Get professional's profile for availability
    const profile = await Profile.findOne({ userId: professionalId });

    if (!profile || !profile.availability) {
      return NextResponse.json(
        { error: "Professional availability not configured" },
        { status: 404 },
      );
    }

    const dayOfWeek = weekdayOf(dateStr);
    const hours = workingHoursOf(profile.availability, dateStr);

    if (!hours) {
      return NextResponse.json({
        date: dateStr,
        dayOfWeek,
        available: false,
        slots: [],
        message: `Professional is not available on ${dayOfWeek}s`,
      });
    }

    const { sessionMinutes: sessionDuration } = slotGridOf(profile.availability);
    const now = new Date();
    const busy = await loadOccupiedIntervals({
      professionalId,
      fromDay: dateStr,
      toDay: dateStr,
      now,
    });
    const [day] = computeFreeSlots({
      availability: profile.availability,
      fromDay: dateStr,
      days: 1,
      now,
      minLeadMinutes: 0,
      busy,
    });
    const filteredSlots = (day?.slots ?? []).map((time) => ({
      time,
      duration: sessionDuration,
      available: true,
    }));

    // Get pricing information (professional or platform defaults)
    let pricingInfo: {
      individualSession?: number;
      coupleSession?: number;
      groupSession?: number;
    } = profile.pricing || {};

    // If professional doesn't have pricing set, use platform defaults
    if (
      !pricingInfo.individualSession &&
      !pricingInfo.coupleSession &&
      !pricingInfo.groupSession
    ) {
      let platformSettings = await PlatformSettings.findOne();

      if (!platformSettings) {
        platformSettings = new PlatformSettings({
          defaultPricing: {
            solo: 120,
            couple: 150,
            group: 80,
          },
          platformFeePercentage: 10,
          currency: "CAD",
        });
        await platformSettings.save();
      }

      pricingInfo = {
        individualSession: platformSettings.defaultPricing.solo,
        coupleSession: platformSettings.defaultPricing.couple,
        groupSession: platformSettings.defaultPricing.group,
      };
    }

    return NextResponse.json({
      date: dateStr,
      dayOfWeek,
      available: filteredSlots.length > 0,
      slots: filteredSlots,
      professionalInfo: {
        id: professional._id,
        name: `${professional.firstName} ${professional.lastName}`,
        sessionDuration,
        pricing: pricingInfo,
        sessionTypes: profile.sessionTypes || [],
      },
      workingHours: {
        start: hours.startTime,
        end: hours.endTime,
      },
    });
  } catch (error: unknown) {
    console.error("Get available slots error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch available slots",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
