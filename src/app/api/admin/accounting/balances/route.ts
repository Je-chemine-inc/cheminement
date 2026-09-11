import { NextResponse } from "next/server";
import mongoose from "mongoose";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import User from "@/models/User";
import { getBiweeklyCycleKey, getBiweeklyRange } from "@/lib/ledger-cycle";
import { requireBillingAdmin } from "@/lib/organization-admin";

export async function GET() {
  try {
    const gate = await requireBillingAdmin();
    if (gate.error) return gate.error;

    const currentCycleKey = getBiweeklyCycleKey(new Date());
    const { start: cycleStart, end: cycleEnd } = getBiweeklyRange(new Date());

    // 1. Get all professionals
    const professionals = await User.find({ role: "professional", status: { $ne: "deleted" } })
      .select("firstName lastName email status")
      .lean();

    // 2. Aggregate lifetime balances
    const lifetimeBalances = await ProfessionalLedgerEntry.aggregate([
      {
        $group: {
          _id: "$professionalId",
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

    // 3. Aggregate current cycle balances
    const cycleBalances = await ProfessionalLedgerEntry.aggregate([
      {
        $match: {
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
          _id: "$professionalId",
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

    // 4. Map data back to professionals
    const results = professionals.map((pro) => {
      const proIdStr = pro._id.toString();
      const life = lifetimeBalances.find((b) => b._id.toString() === proIdStr);
      const cyc = cycleBalances.find((b) => b._id.toString() === proIdStr);

      const creditsLife = life?.credits ?? 0;
      const debitsLife = life?.debits ?? 0;
      const creditsCyc = cyc?.credits ?? 0;
      const debitsCyc = cyc?.debits ?? 0;

      return {
        _id: proIdStr,
        name: `${pro.firstName} ${pro.lastName}`,
        email: pro.email,
        status: pro.status,
        balanceLifetimeCad: Math.round((creditsLife - debitsLife) * 100) / 100,
        balanceCurrentCycleCad: Math.round((creditsCyc - debitsCyc) * 100) / 100,
        currentCycleKey,
      };
    });

    return NextResponse.json({ professionals: results, currentCycleKey });
  } catch (e: unknown) {
    console.error("GET /api/admin/accounting/balances:", e);
    return NextResponse.json(
      { error: "Failed to load balances" },
      { status: 500 }
    );
  }
}
