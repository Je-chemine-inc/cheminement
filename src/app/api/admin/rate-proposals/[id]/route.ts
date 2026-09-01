import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { sendRateProposalDecisionEmail } from "@/lib/notifications";
import { getTherapyTypeLabel } from "@/lib/pricing";
import ProfessionalRateProposal from "@/models/ProfessionalRateProposal";
import Profile from "@/models/Profile";
import PlatformSettings from "@/models/PlatformSettings";
import { authOptions } from "@/lib/auth";
import { acceptanceSetPaths, canDecide } from "@/lib/rate-proposal";
import type { TherapyType } from "@/lib/professional-pricing";

/**
 * Admin decision on a rate-change request: accept or reject.
 *
 * Accepting writes only `rates.<type>.professionalRate` — never the client
 * price, which is the platform's to set — and affects **future bookings only**.
 * Existing appointments keep the price agreed at booking until an admin
 * re-prices them deliberately via /api/admin/appointments/[id]/reprice.
 *
 * The decision is claimed atomically on `status: "pending"`, so two admins
 * acting at once cannot both apply it.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid proposal id" }, { status: 400 });
    }

    const body = await req.json();
    const decision = body?.decision;
    if (decision !== "accept" && decision !== "reject") {
      return NextResponse.json({ error: "INVALID_DECISION" }, { status: 400 });
    }

    const decisionNote =
      typeof body?.decisionNote === "string" && body.decisionNote.trim()
        ? body.decisionNote.trim().slice(0, 1000)
        : undefined;

    await connectToDatabase();

    const proposal = await ProfessionalRateProposal.findById(id);
    const allowed = canDecide(proposal);
    if (!allowed.ok) {
      return NextResponse.json({ error: allowed.reason }, { status: 409 });
    }

    const therapyType = proposal!.therapyType as TherapyType;
    const professionalId = String(proposal!.professionalId);

    // Re-check the ceiling at decision time: the client price may have changed
    // since submission, so a proposal that was valid then could overpay now.
    if (decision === "accept") {
      const profile = await Profile.findOne({ userId: professionalId });
      const settings = await PlatformSettings.findOne();
      const clientPrice =
        profile?.rates?.[therapyType]?.clientPrice ??
        settings?.defaultPricing?.[therapyType];

      if (
        typeof clientPrice === "number" &&
        proposal!.proposedRate > clientPrice
      ) {
        return NextResponse.json(
          { error: "RATE_EXCEEDS_CLIENT_PRICE", clientPrice },
          { status: 409 },
        );
      }
    }

    // Atomic claim: whoever flips it off "pending" wins.
    const claimed = await ProfessionalRateProposal.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: {
          status: decision === "accept" ? "accepted" : "rejected",
          decidedBy: session.user.id,
          decidedAt: new Date(),
          ...(decisionNote ? { decisionNote } : {}),
        },
      },
      { new: true },
    );

    if (!claimed) {
      // Another admin decided it between our read and our write.
      return NextResponse.json({ error: "NOT_PENDING" }, { status: 409 });
    }

    if (decision === "accept") {
      await Profile.findOneAndUpdate(
        { userId: professionalId },
        { $set: acceptanceSetPaths(therapyType, claimed.proposedRate) },
      );
    }

    // Tell the professional, in their own language. Sent out of band so a mail
    // failure cannot undo a decision that is already recorded.
    const accepted = decision === "accept";
    after(async () => {
      try {
        const user = await User.findById(professionalId).select(
          "firstName lastName email language",
        );
        if (!user?.email) return;
        await sendRateProposalDecisionEmail({
          professionalName:
            `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
            "Professionnel(le)",
          professionalEmail: user.email,
          therapyTypeLabel: getTherapyTypeLabel(therapyType),
          proposedRate: claimed.proposedRate,
          accepted,
          decisionNote,
          locale: user.language === "en" ? "en" : "fr",
        });
      } catch (mailErr) {
        console.error("sendRateProposalDecisionEmail failed:", mailErr);
      }
    });

    return NextResponse.json({
      id,
      status: claimed.status,
      therapyType,
      proposedRate: claimed.proposedRate,
      // Existing appointments are untouched by design.
      appliesTo: "future bookings only",
    });
  } catch (err: unknown) {
    console.error("Decide rate proposal error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
