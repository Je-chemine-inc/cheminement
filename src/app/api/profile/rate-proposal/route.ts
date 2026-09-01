import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { sendRateProposalSubmittedAlert } from "@/lib/notifications";
import { getTherapyTypeLabel } from "@/lib/pricing";
import Profile from "@/models/Profile";
import PlatformSettings from "@/models/PlatformSettings";
import ProfessionalRateProposal from "@/models/ProfessionalRateProposal";
import { authOptions } from "@/lib/auth";
import { parseProposal } from "@/lib/rate-proposal";
import type { TherapyType } from "@/lib/professional-pricing";

/**
 * A professional's own rate-change requests.
 *
 * GET  — their proposals, newest first.
 * POST — submit one. This changes **nothing**: the live rate in `Profile.rates`
 *        stands until an admin accepts. Pricing is admin-controlled, and
 *        `pricing`/`rates` are absent from the `PUT /api/profile` allowlist, so
 *        this is the only route a professional has.
 *
 * At most one pending proposal per therapy type — enforced by a partial unique
 * index on the model, so a race cannot slip a second one through.
 */

/** The client price in force for this professional and therapy type. */
async function effectiveClientPrice(
  professionalId: string,
  therapyType: TherapyType,
): Promise<number | undefined> {
  const profile = await Profile.findOne({ userId: professionalId });
  const pinned = profile?.rates?.[therapyType]?.clientPrice;
  if (typeof pinned === "number" && pinned > 0) return pinned;

  const settings = await PlatformSettings.findOne();
  const fallback = settings?.defaultPricing?.[therapyType];
  return typeof fallback === "number" && fallback > 0 ? fallback : undefined;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const proposals = await ProfessionalRateProposal.find({
      professionalId: session.user.id,
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return NextResponse.json({
      proposals: proposals.map((p) => ({
        id: String(p._id),
        therapyType: p.therapyType,
        proposedRate: p.proposedRate,
        currentRate: p.currentRate,
        note: p.note,
        status: p.status,
        decisionNote: p.decisionNote,
        createdAt: p.createdAt,
        decidedAt: p.decidedAt,
      })),
    });
  } catch (err: unknown) {
    console.error("List rate proposals error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const body = await req.json();
    const therapyTypeRaw = body?.therapyType;
    const clientPrice =
      typeof therapyTypeRaw === "string"
        ? await effectiveClientPrice(
            session.user.id,
            therapyTypeRaw as TherapyType,
          )
        : undefined;

    const parsed = parseProposal(body, clientPrice);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.reason }, { status: 400 });
    }

    const profile = await Profile.findOne({ userId: session.user.id });
    const currentRate =
      profile?.rates?.[parsed.proposal.therapyType]?.professionalRate;

    try {
      const created = await ProfessionalRateProposal.create({
        professionalId: session.user.id,
        therapyType: parsed.proposal.therapyType,
        proposedRate: parsed.proposal.proposedRate,
        currentRate,
        note: parsed.proposal.note,
        status: "pending",
      });

      // Alert admins out of band — a failed email must not fail the request the
      // professional just made.
      const professionalId = session.user.id;
      after(async () => {
        try {
          const user = await User.findById(professionalId).select(
            "firstName lastName",
          );
          await sendRateProposalSubmittedAlert({
            professionalName:
              `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
              "Professionnel(le)",
            therapyTypeLabel: getTherapyTypeLabel(parsed.proposal.therapyType),
            currentRate,
            proposedRate: parsed.proposal.proposedRate,
            note: parsed.proposal.note,
          });
        } catch (mailErr) {
          console.error("sendRateProposalSubmittedAlert failed:", mailErr);
        }
      });

      return NextResponse.json(
        {
          id: String(created._id),
          therapyType: created.therapyType,
          proposedRate: created.proposedRate,
          status: created.status,
        },
        { status: 201 },
      );
    } catch (createErr: unknown) {
      // The partial unique index rejects a second pending proposal for the same
      // therapy type — surface it as a clear conflict, not a 500.
      if ((createErr as { code?: number })?.code === 11000) {
        return NextResponse.json({ error: "ALREADY_PENDING" }, { status: 409 });
      }
      throw createErr;
    }
  } catch (err: unknown) {
    console.error("Create rate proposal error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
