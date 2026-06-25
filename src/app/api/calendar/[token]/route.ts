import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import Profile from "@/models/Profile";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import {
  buildProfessionalCalendarIcs,
  type IcsEvent,
} from "@/lib/calendar-ics";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Public, read-only iCal subscription feed for ONE professional, authenticated
 * solely by the unguessable token in the path (calendar apps can't carry a
 * session). Lists the pro's scheduled appointments so they appear in Google /
 * Apple / Outlook and the pro never double-books.
 *
 * PRIVACY: this payload travels through the subscriber's calendar provider
 * (e.g. Google's servers) in cleartext and is only as secret as the token, so
 * it deliberately carries NO client identity, NO video-session join link
 * (a bearer URL — would let a token-holder join a live session) and NO physical
 * address. The title blocks the slot + states the modality; the pro opens Je
 * chemine (linked in the description) for who / where / the join link.
 */

const MODALITY: Record<string, { fr: string; en: string }> = {
  video: { fr: "visioconférence", en: "video" },
  "in-person": { fr: "en personne", en: "in person" },
  phone: { fr: "téléphone", en: "phone" },
  both: { fr: "visioconférence ou en personne", en: "video or in person" },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Defense-in-depth on an unauthenticated, DB-touching public route.
  const rl = rateLimit(`calendar-feed:${getClientIp(_req)}`, 60, 60_000);
  if (!rl.allowed) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  await connectToDatabase();
  const profile = await Profile.findOne({ calendarFeedToken: token }).select(
    "userId",
  );
  if (!profile) {
    return new NextResponse("Not found", { status: 404 });
  }

  const pro = await User.findById(profile.userId).select(
    "language firstName lastName",
  );
  const lang: "fr" | "en" = pro?.language === "en" ? "en" : "fr";

  // Include a little recent history (30 days back) so a just-passed session
  // still shows; everything upcoming is unbounded.
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const appointments = await Appointment.find({
    professionalId: profile.userId,
    status: "scheduled",
    date: { $gte: since },
  })
    // Deliberately NOT selecting meetingLink / location — see PRIVACY note above.
    .select("date time duration type updatedAt")
    .lean();

  const base = (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const dashboardUrl = `${base}/professional/dashboard/schedule`;

  const events: IcsEvent[] = appointments
    .filter((a) => a.date && a.time)
    .map((a) => {
      const modality =
        MODALITY[a.type as string]?.[lang] ??
        (lang === "fr" ? "rendez-vous" : "appointment");
      const summary =
        lang === "fr"
          ? `Je chemine — Rendez-vous (${modality})`
          : `Je chemine — Appointment (${modality})`;
      const descLines =
        lang === "fr"
          ? [
              "Rendez-vous Je chemine.",
              `Type : ${modality}`,
              `Durée : ${a.duration ?? 60} minutes`,
              `Détails : ${dashboardUrl}`,
            ]
          : [
              "Je chemine appointment.",
              `Type: ${modality}`,
              `Duration: ${a.duration ?? 60} minutes`,
              `Details: ${dashboardUrl}`,
            ];
      return {
        uid: String(a._id),
        date: a.date as Date,
        time: a.time as string,
        durationMinutes: a.duration ?? 60,
        summary,
        description: descLines.join("\n"),
        // No LOCATION: the join link / physical address stay in Je chemine.
        status: "confirmed" as const,
        lastModified: (a.updatedAt as Date | undefined) ?? null,
      };
    });

  const ics = buildProfessionalCalendarIcs(events, {
    calendarName: lang === "fr" ? "Je chemine — Rendez-vous" : "Je chemine — Appointments",
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="jechemine.ics"',
      // Calendar apps poll on their own cadence; a short cache softens abuse
      // without making edits noticeably stale.
      "Cache-Control": "private, max-age=300",
    },
  });
}
