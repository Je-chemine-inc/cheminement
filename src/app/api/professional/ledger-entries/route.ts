import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import Appointment from "@/models/Appointment";
import { getBiweeklyCycleKey, getBiweeklyRange } from "@/lib/ledger-cycle";
import { redactLedgerEntryForProfessional } from "@/lib/redact-payment";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const proOid = new mongoose.Types.ObjectId(session.user.id);
    const currentCycleKey = getBiweeklyCycleKey(new Date());
    const { start: cycleStart, end: cycleEnd } = getBiweeklyRange(new Date());

    const entries = await ProfessionalLedgerEntry.find({
      professionalId: proOid,
    })
      .sort({ createdAt: -1 })
      .limit(200)
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

    const pending = await Appointment.aggregate<{
      _id: null;
      total: number;
    }>([
      {
        $match: {
          professionalId: proOid,
          status: { $in: ["completed", "no-show"] },
          "payment.status": "pending",
          "payment.professionalPayout": { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$payment.professionalPayout" },
        },
      },
    ]);

    const pendingPayoutCad = pending[0]?.total ?? 0;

    // Commercial confidentiality: professionals get an allow-list of ledger
    // fields (never the client's gross, the platform fee or an organization's
    // share). See redactLedgerEntryForProfessional.
    const redactedEntries = entries.map((e) =>
      redactLedgerEntryForProfessional(e as unknown as Record<string, unknown>),
    );

    return NextResponse.json({
      entries: redactedEntries,
      pendingPayoutCad,
      currentCycleKey,
      balanceLifetimeCad: Math.round((creditsLife - debitsLife) * 100) / 100,
      balanceCurrentCycleCad:
        Math.round((creditsCyc - debitsCyc) * 100) / 100,
    });
  } catch (e: unknown) {
    console.error("GET /api/professional/ledger-entries:", e);
    return NextResponse.json(
      { error: "Failed to load ledger" },
      { status: 500 },
    );
  }
}
