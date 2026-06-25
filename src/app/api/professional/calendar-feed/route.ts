import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Profile from "@/models/Profile";
import {
  generateCalendarFeedToken,
  buildCalendarFeedUrls,
} from "@/lib/calendar-feed";

/**
 * Calendar-sync feed management for the logged-in professional.
 *
 *  - GET  → the current subscription URL (or null if sync isn't enabled yet).
 *  - POST → enable sync (mint a token) or, with { rotate: true }, regenerate it
 *           (the old URL stops working — use this if the link was exposed).
 *
 * The token itself authenticates the public feed (GET /api/calendar/[token]),
 * which is why it must never be derivable: we mint it server-side here.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "professional") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();
  const profile = await Profile.findOne({ userId: session.user.id }).select(
    "calendarFeedToken",
  );
  const token = profile?.calendarFeedToken;
  if (!token) return NextResponse.json({ enabled: false, url: null });
  return NextResponse.json({ enabled: true, ...buildCalendarFeedUrls(token) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "professional") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();

  let rotate = false;
  try {
    const body = (await req.json()) as { rotate?: boolean } | null;
    rotate = Boolean(body?.rotate);
  } catch {
    // No body → treat as "enable if absent".
  }

  const profile = await Profile.findOne({ userId: session.user.id }).select(
    "calendarFeedToken",
  );
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Mint a fresh token when enabling for the first time, or when rotating.
  if (!profile.calendarFeedToken || rotate) {
    profile.calendarFeedToken = generateCalendarFeedToken();
    try {
      await profile.save();
    } catch (e) {
      // The unique+sparse index makes a 256-bit collision effectively
      // impossible, but a concurrent double-POST could still race — retry once
      // with a new token before surfacing an error.
      if ((e as { code?: number })?.code === 11000) {
        profile.calendarFeedToken = generateCalendarFeedToken();
        await profile.save();
      } else {
        console.error("[calendar-feed] save:", e);
        return NextResponse.json(
          { error: "Could not update the feed" },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({
    enabled: true,
    ...buildCalendarFeedUrls(profile.calendarFeedToken),
  });
}
