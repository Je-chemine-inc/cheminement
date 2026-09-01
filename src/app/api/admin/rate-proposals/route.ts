import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import ProfessionalRateProposal from "@/models/ProfessionalRateProposal";
import Profile from "@/models/Profile";
import PlatformSettings from "@/models/PlatformSettings";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import { spreadOf, type TherapyType } from "@/lib/professional-pricing";

/**
 * Admin review queue for professional rate-change requests.
 *
 * Each row carries the resulting spread so an admin can see what accepting
 * would cost before deciding — a proposal that leaves the platform earning
 * nothing is legal but must never be invisible.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const status = req.nextUrl.searchParams.get("status") ?? "pending";
    if (!["pending", "accepted", "rejected", "all"].includes(status)) {
      return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
    }

    const proposals = await ProfessionalRateProposal.find(
      status === "all" ? {} : { status },
    )
      .sort({ createdAt: 1 })
      .limit(200);

    const settings = await PlatformSettings.findOne();

    const rows = [];
    for (const p of proposals) {
      const professionalId = String(p.professionalId);
      const [user, profile] = await Promise.all([
        User.findById(professionalId).select("firstName lastName email"),
        Profile.findOne({ userId: professionalId }),
      ]);

      const type = p.therapyType as TherapyType;
      const clientPrice =
        profile?.rates?.[type]?.clientPrice ??
        settings?.defaultPricing?.[type] ??
        undefined;

      const proposedSpread =
        typeof clientPrice === "number"
          ? spreadOf(clientPrice, p.proposedRate)
          : null;

      rows.push({
        id: String(p._id),
        professional: {
          id: professionalId,
          name: user
            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
            : "",
          email: user?.email ?? null,
        },
        therapyType: p.therapyType,
        currentRate: p.currentRate ?? profile?.rates?.[type]?.professionalRate ?? null,
        proposedRate: p.proposedRate,
        clientPrice: clientPrice ?? null,
        proposedSpread,
        // Legal, but the admin must see it before accepting.
        zeroOrNegativeSpread:
          proposedSpread !== null && proposedSpread.amount <= 0,
        note: p.note ?? null,
        status: p.status,
        createdAt: p.createdAt,
        decidedAt: p.decidedAt ?? null,
        decisionNote: p.decisionNote ?? null,
      });
    }

    return NextResponse.json({ proposals: rows });
  } catch (err: unknown) {
    console.error("List admin rate proposals error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
