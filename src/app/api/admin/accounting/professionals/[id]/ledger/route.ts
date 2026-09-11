import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import User from "@/models/User";
import Profile from "@/models/Profile";
import { getBiweeklyCycleKey, getBiweeklyRange } from "@/lib/ledger-cycle";
import { requireBillingAdmin } from "@/lib/organization-admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireBillingAdmin();
    if (gate.error) return gate.error;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Professional ID is required" }, { status: 400 });
    }

    const proOid = new mongoose.Types.ObjectId(id);
    const professional = await User.findById(id).select("firstName lastName email role").lean();
    
    if (!professional || professional.role !== "professional") {
      return NextResponse.json({ error: "Professional not found" }, { status: 404 });
    }

    const currentCycleKey = getBiweeklyCycleKey(new Date());
    const { start: cycleStart, end: cycleEnd } = getBiweeklyRange(new Date());

    const entries = await ProfessionalLedgerEntry.find({
      professionalId: proOid,
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const lifetime = await ProfessionalLedgerEntry.aggregate<{
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

    const cycleBal = await ProfessionalLedgerEntry.aggregate<{
      _id: null;
      credits: number;
      debits: number;
    }>([
      {
        $match: {
          professionalId: proOid,
          $or: [
            { cycleKey: currentCycleKey },
            {
              $and: [
                {
                  $or: [
                    { cycleKey: { $exists: false } },
                    { cycleKey: null },
                    { cycleKey: "" },
                  ],
                },
                { createdAt: { $gte: cycleStart, $lt: cycleEnd } },
              ],
            },
          ],
        },
      },
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

    const creditsLife = lifetime[0]?.credits ?? 0;
    const debitsLife = lifetime[0]?.debits ?? 0;
    const creditsCyc = cycleBal[0]?.credits ?? 0;
    const debitsCyc = cycleBal[0]?.debits ?? 0;

    // The pro's chosen payout method so the admin knows HOW to disburse.
    const profile = await Profile.findOne({ userId: id })
      .select("payoutMethod payoutInteracEmail payoutChequeUrl payoutChequeName")
      .lean();

    return NextResponse.json({
      professional,
      entries,
      currentCycleKey,
      balanceLifetimeCad: Math.round((creditsLife - debitsLife) * 100) / 100,
      balanceCurrentCycleCad: Math.round((creditsCyc - debitsCyc) * 100) / 100,
      payout: {
        method: profile?.payoutMethod ?? null,
        interacEmail: profile?.payoutInteracEmail ?? null,
        chequeUrl: profile?.payoutChequeUrl ?? null,
        chequeName: profile?.payoutChequeName ?? null,
      },
    });
  } catch (e: unknown) {
    console.error("GET /api/admin/accounting/professionals/[id]/ledger:", e);
    return NextResponse.json(
      { error: "Failed to load professional ledger" },
      { status: 500 }
    );
  }
}
