import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import { recordAccountActionRequest } from "@/lib/account-action-alerts";
import { rateLimit } from "@/lib/rate-limit";

// Allow headroom for cold-start Mongo + SMTP on the admin alert.
export const maxDuration = 30;

/**
 * POST /api/users/me/request-deletion
 *
 * Droit à l'oubli — l'utilisateur (client ou professionnel) soumet, depuis la
 * zone de danger de ses paramètres, une demande de SUPPRESSION DÉFINITIVE de
 * son compte. Cette route NE supprime rien : la suppression effective est
 * traitée manuellement par l'équipe (via support@jechemine.ca), dans le respect
 * de l'obligation de conservation des factures / données financières. Elle se
 * contente d'enregistrer et de notifier la demande aux admins (courriel +
 * boîte de réception interne).
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Mirrors the self-service deactivate guard: this flow is for clients and
    // professionals. Admins have a dedicated, hierarchy-aware path.
    if (
      session.user.role !== "client" &&
      session.user.role !== "professional"
    ) {
      return NextResponse.json(
        { error: "This account type cannot request deletion here" },
        { status: 403 },
      );
    }

    // Secondary, per-user burst guard. The primary protection is the idempotent
    // `deletionRequestedAt` claim below (DB-backed, so it holds across instances
    // where this in-memory limiter does not).
    const rl = rateLimit(
      `deletion-request:${session.user.id}`,
      3,
      24 * 60 * 60 * 1000,
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id).select(
      "_id firstName lastName email role language deletionRequestedAt",
    );
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Idempotent: a deletion request was already recorded. Acknowledge without
    // re-alerting so a page reload or replay can't flood the admin inbox/email.
    if (user.deletionRequestedAt) {
      return NextResponse.json({ success: true, alreadyRequested: true });
    }

    // Atomically claim the request so two concurrent calls can't both alert.
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, deletionRequestedAt: { $exists: false } },
      { $set: { deletionRequestedAt: new Date() } },
    );
    if (!claimed) {
      return NextResponse.json({ success: true, alreadyRequested: true });
    }

    // Notify admins (email + in-app inbox) after the response. The acknowledgement
    // to the user does not need to wait on Mongo insert + SMTP.
    after(() =>
      recordAccountActionRequest({
        kind: "deletion_request",
        userId: user._id.toString(),
        userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
        userEmail: user.email,
        userRole: user.role,
        locale: user.language === "en" ? "en" : "fr",
      }).catch((err) =>
        console.error("deletion-request admin alert failed:", err),
      ),
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error(
      "Request-deletion error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to submit deletion request" },
      { status: 500 },
    );
  }
}
