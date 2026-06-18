import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import User from "@/models/User";
import Profile from "@/models/Profile";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import { getBiweeklyCycleKey } from "@/lib/ledger-cycle";

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * "Marquer comme payé au professionnel" — archives a manual disbursement the
 * admin made out-of-band (Interac e-transfer or direct deposit from the company
 * bank account) by writing a debit ledger entry, which reduces the balance owed.
 *
 * Defaults to paying the full lifetime balance owed; an explicit `amount`
 * (partial payout) is honoured. Refuses when nothing is owed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();
    if (
      adminRecord?.permissions &&
      !adminRecord.permissions.manageBilling &&
      !adminRecord.permissions.managePatients
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: "Invalid professional ID" },
        { status: 400 },
      );
    }
    const proOid = new mongoose.Types.ObjectId(id);

    const professional = await User.findById(id).select("role").lean();
    if (!professional || professional.role !== "professional") {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const reference =
      typeof body?.reference === "string" ? body.reference.trim() : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

    // Current balance owed = lifetime credits − debits.
    const agg = await ProfessionalLedgerEntry.aggregate<{
      _id: null;
      credits: number;
      debits: number;
    }>([
      { $match: { professionalId: proOid } },
      {
        $group: {
          _id: null,
          credits: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$entryKind", "credit"] },
                    { $not: ["$entryKind"] },
                  ],
                },
                "$netToProfessionalCad",
                0,
              ],
            },
          },
          debits: {
            $sum: {
              $cond: [
                { $eq: ["$entryKind", "debit"] },
                { $ifNull: ["$payoutAmountCad", 0] },
                0,
              ],
            },
          },
        },
      },
    ]);
    const owed = round((agg[0]?.credits ?? 0) - (agg[0]?.debits ?? 0));

    const requested =
      body?.amount != null ? round(Number(body.amount)) : owed;
    if (!Number.isFinite(requested) || requested <= 0) {
      return NextResponse.json(
        { error: "Nothing to pay", code: "NOTHING_DUE", owed },
        { status: 400 },
      );
    }
    if (requested > owed + 0.001) {
      return NextResponse.json(
        { error: "Amount exceeds the balance owed", code: "OVER_BALANCE", owed },
        { status: 400 },
      );
    }

    const profile = await Profile.findOne({ userId: id })
      .select("payoutMethod")
      .lean();

    await ProfessionalLedgerEntry.create({
      professionalId: proOid,
      entryKind: "debit",
      cycleKey: getBiweeklyCycleKey(new Date()),
      grossAmountCad: 0,
      platformFeeCad: 0,
      netToProfessionalCad: 0,
      payoutAmountCad: requested,
      payoutReference: reference || undefined,
      payoutNotes: notes || undefined,
      paymentChannel: profile?.payoutMethod === "interac" ? "transfer" : "none",
    });

    return NextResponse.json({
      success: true,
      paidAmountCad: requested,
      balanceOwedCad: round(owed - requested),
    });
  } catch (error) {
    console.error("Professional payout error:", error);
    return NextResponse.json(
      {
        error: "Failed to record payout",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
