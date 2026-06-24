import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Profile from "@/models/Profile";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { sendProfessionalProfileCompletedEmail } from "@/lib/notifications";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const profile = await Profile.findOne({ userId: session.user.id });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error: unknown) {
    console.error(
      "Get profile error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to fetch profile",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { acceptProfessionalTerms, ...data } = await req.json();

    const existing = await Profile.findOne({ userId: session.user.id });
    const now = new Date();

    const update: Record<string, unknown> = { ...data };

    // Defense-in-depth: privacy toggles must always be stored as strict booleans
    // (the messaging visibility gate keys off an explicit `false`).
    for (const key of [
      "visibleToProfessionals",
      "profileVisible",
      "showRating",
      "acceptingNewClients",
      "acceptingEmergencyConsultations",
    ] as const) {
      if (key in update) update[key] = update[key] === true;
    }

    if (acceptProfessionalTerms === true) {
      update.professionalTermsAcceptedAt = now;
      update.professionalTermsVersion = LEGAL_VERSIONS.professionalTerms;
    }

    const termsAccepted =
      Boolean(existing?.professionalTermsAcceptedAt) ||
      acceptProfessionalTerms === true;

    if (termsAccepted) {
      update.profileCompleted = true;
    }

    const wasAlreadyCompleted = Boolean(existing?.profileCompleted);

    const profile = await Profile.findOneAndUpdate(
      { userId: session.user.id },
      update,
      { new: true, upsert: true },
    );

    // First-time profile completion → send welcome / "admin will reach out" email.
    // Idempotent because we only fire on the false→true transition.
    // after() keeps the serverless function alive on Vercel until the SMTP
    // send completes; without it, fire-and-forget is killed mid-flight.
    if (
      !wasAlreadyCompleted &&
      profile?.profileCompleted &&
      session.user.role === "professional"
    ) {
      const userId = session.user.id;
      after(async () => {
        try {
          const user = await User.findById(userId)
            .select("firstName lastName email language")
            .lean();
          if (user?.email) {
            await sendProfessionalProfileCompletedEmail({
              name:
                `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
                "Professionnel(le)",
              email: user.email,
              role: "professional",
              locale: user.language === "en" ? "en" : "fr",
            });
          }
        } catch (err) {
          console.error(
            "sendProfessionalProfileCompletedEmail failed:",
            err,
          );
        }
      });
    }

    // Re-enabling intake must UNBLOCK the queue. While a pro had "new clients"
    // (or "urgent consultations") OFF, demandes that arrived with no other
    // eligible pro fell to the GENERAL POOL and were never auto-pushed to anyone.
    // Turning intake back ON does not retroactively re-offer them — so the queue
    // looked "stuck" even after reactivation (client feedback). On a false→true
    // transition we take the waiting (unassigned, general/pending) demandes,
    // atomically RESET each back to "pending" + reopen the cascade (the matcher
    // hard-skips anything not strictly "pending"), then re-run jumelage so they
    // get auto-proposed to an eligible pro — now including this one. NOTE: a
    // demande an admin manually parked in the general pool is indistinguishable
    // from an auto-fallen one and is also re-matched here — acceptable (it just
    // gets auto-proposed instead of waiting on the self-claim board).
    // acceptingNewClients is the master gate; emergency only matters while it's ON.
    const reEnabledNewClients =
      existing?.acceptingNewClients === false &&
      profile?.acceptingNewClients === true;
    const reEnabledEmergency =
      existing?.acceptingEmergencyConsultations === false &&
      profile?.acceptingEmergencyConsultations === true &&
      profile?.acceptingNewClients !== false;
    if (
      session.user.role === "professional" &&
      (reEnabledNewClients || reEnabledEmergency)
    ) {
      after(async () => {
        try {
          const filter: Record<string, unknown> = {
            status: "pending",
            professionalId: null,
            routingStatus: { $in: ["general", "pending"] },
          };
          // Emergency-only re-enable → only urgent demandes become newly servable.
          if (reEnabledEmergency && !reEnabledNewClients) {
            filter.isEmergency = true;
          }
          const waiting = await Appointment.find(filter)
            // Oldest + urgent first; bounded so the post-response re-match stays
            // within the serverless time budget (re-enabling is rare; any
            // overflow can be re-launched by the admin's "Jumelage automatique").
            .sort({ isEmergency: -1, createdAt: 1 })
            .limit(10)
            .select("_id")
            .lean();
          for (const a of waiting) {
            try {
              // The matcher only acts on routingStatus "pending", so a "general"
              // demande must first be atomically reset to pending — a single-
              // winner claim, so two pros re-enabling at once can't both re-route
              // it. Reopen the cascade (cascadeAttempts 0) and remove THIS pro
              // from refusedBy so they can be re-offered; other pros' refusals
              // are preserved.
              const claimed = await Appointment.findOneAndUpdate(
                {
                  _id: a._id,
                  status: "pending",
                  professionalId: null,
                  routingStatus: { $in: ["general", "pending"] },
                },
                {
                  $set: { routingStatus: "pending", cascadeAttempts: 0 },
                  $pull: { refusedBy: session.user.id },
                  $unset: { proposedTo: "", proposedAt: "" },
                },
                { new: true },
              );
              if (claimed) {
                await routeAppointmentToProfessionals(String(a._id));
              }
            } catch (err) {
              console.error(
                "[profile] re-route on re-enable failed:",
                a._id,
                err,
              );
            }
          }
        } catch (err) {
          console.error("[profile] re-match on re-enable failed:", err);
        }
      });
    }

    return NextResponse.json(profile);
  } catch (error: unknown) {
    console.error(
      "Update profile error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to update profile",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
