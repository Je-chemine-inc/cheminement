import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import crypto from "crypto";
import mongoose from "mongoose";
import { stripe, toCents } from "@/lib/stripe";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import { getBiweeklyCycleKey } from "@/lib/ledger-cycle";

// Create payout/transfer to professional
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Only admins can trigger payouts
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can process payouts" },
        { status: 403 },
      );
    }

    const { professionalId, appointmentIds } = await req.json();

    if (!professionalId || !appointmentIds || appointmentIds.length === 0) {
      return NextResponse.json(
        { error: "Professional ID and appointment IDs are required" },
        { status: 400 },
      );
    }

    await connectToDatabase();

    // Get professional
    const professional = await User.findById(professionalId);

    if (!professional || professional.role !== "professional") {
      return NextResponse.json(
        { error: "Professional not found" },
        { status: 404 },
      );
    }

    if (!professional.stripeConnectAccountId) {
      return NextResponse.json(
        { error: "Professional has not set up their payout account" },
        { status: 400 },
      );
    }

    // Idempotency key derived from (pro, sorted appointment ids): a retry of
    // the same request replays the same Stripe transfer instead of charging
    // again. Hashed to stay within Stripe's key-length limit when many
    // appointments are bundled. claimToken (distinct) is the DB claim marker.
    const sortedIds = [...appointmentIds].sort();
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`payout_${professionalId}_${sortedIds.join("_")}`)
      .digest("hex");
    const claimToken = `claim_${idempotencyKey}`;

    // Eligible appointments:
    //  - payment.status "paid"  (H8: correct dotted path — the old top-level
    //    `paymentStatus` matched NOTHING, so the route always 400'd)
    //  - card / direct_debit only (H9: Interac "transfer" is admin-asserted
    //    paid and funds may not have cleared, so never auto-transfer it)
    //  - not already paid out, OR already claimed by THIS request (so a retry
    //    after a transfer that committed but failed to persist can recover).
    const appointments = await Appointment.find({
      _id: { $in: appointmentIds },
      professionalId: professionalId,
      "payment.status": "paid",
      "payment.method": { $in: ["card", "direct_debit"] },
      $or: [
        { "payment.payoutTransferId": { $exists: false } },
        { "payment.payoutTransferId": claimToken },
      ],
    });

    if (appointments.length === 0) {
      return NextResponse.json(
        { error: "No eligible appointments found for payout" },
        { status: 400 },
      );
    }

    // H9: never call Stripe with a non-positive amount.
    const eligibleTotal = appointments.reduce(
      (sum, apt) => sum + apt.payment.professionalPayout,
      0,
    );
    if (!(eligibleTotal > 0)) {
      return NextResponse.json(
        { error: "Payout amount must be greater than zero" },
        { status: 400 },
      );
    }

    // H6: the Connect account id is persisted at the START of onboarding
    // (before KYC / bank), so its existence doesn't mean money can move. Verify
    // full onboarding BEFORE claiming any row, so a rejection here strands none.
    const account = await stripe.accounts.retrieve(
      professional.stripeConnectAccountId,
    );
    if (
      !account.charges_enabled ||
      !account.payouts_enabled ||
      !account.details_submitted
    ) {
      return NextResponse.json(
        { error: "Professional's payout account is not fully onboarded" },
        { status: 400 },
      );
    }

    // H7: atomically CLAIM the rows before transferring. updateMany only flips
    // rows still unclaimed, so concurrent / overlapping payouts can never claim
    // the same row twice. We then transfer ONLY the rows now bearing our token
    // (never the raw request list), which removes the partial-failure double-pay
    // window (transfer commits, mark fails, an overlapping re-bundle re-pays).
    await Appointment.updateMany(
      {
        _id: { $in: appointments.map((a) => a._id) },
        "payment.payoutTransferId": { $exists: false },
      },
      { $set: { "payment.payoutTransferId": claimToken } },
    );
    const claimed = await Appointment.find({
      _id: { $in: appointments.map((a) => a._id) },
      "payment.payoutTransferId": claimToken,
    });
    if (claimed.length === 0) {
      return NextResponse.json(
        { error: "No eligible appointments found for payout" },
        { status: 400 },
      );
    }
    const totalPayout = claimed.reduce(
      (sum, apt) => sum + apt.payment.professionalPayout,
      0,
    );

    // Create transfer to professional's Connect account (idempotency-keyed).
    const transfer = await stripe.transfers.create(
      {
        amount: toCents(totalPayout),
        currency: "cad",
        destination: professional.stripeConnectAccountId,
        description: `Payout for ${claimed.length} completed session(s)`,
        metadata: {
          professionalId: professionalId,
          appointmentIds: claimed.map((a) => a._id.toString()).join(","),
          appointmentCount: claimed.length.toString(),
        },
      },
      { idempotencyKey },
    );

    // Replace the claim token with the real transfer id on the NESTED schema
    // path (the old top-level write was dropped by Mongoose strict mode).
    await Appointment.updateMany(
      {
        _id: { $in: claimed.map((a) => a._id) },
        "payment.payoutTransferId": claimToken,
      },
      {
        $set: {
          "payment.payoutTransferId": transfer.id,
          "payment.payoutDate": new Date(),
        },
      },
    );

    // M11: record the payout as a ledger DEBIT so the professional's balance
    // (credits − debits) reconciles and a later manual payout-debit doesn't
    // double-pay the same money. Best-effort — the transfer already succeeded,
    // so never fail the request on a ledger write error.
    await ProfessionalLedgerEntry.create({
      professionalId: new mongoose.Types.ObjectId(String(professionalId)),
      entryKind: "debit",
      cycleKey: getBiweeklyCycleKey(new Date()),
      grossAmountCad: 0,
      platformFeeCad: 0,
      netToProfessionalCad: 0,
      paymentChannel: "none",
      payoutAmountCad: totalPayout,
      payoutReference: transfer.id,
      payoutNotes: `Stripe Connect auto-payout (${claimed.length} session(s))`,
    }).catch((e) => console.error("[payout] ledger debit create:", e));

    return NextResponse.json({
      success: true,
      transferId: transfer.id,
      amount: totalPayout,
      appointmentCount: claimed.length,
    });
  } catch (error: unknown) {
    console.error(
      "Payout error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to process payout",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

// GET - Check payout status
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id);

    if (!user?.stripeConnectAccountId) {
      return NextResponse.json({
        setupComplete: false,
        balance: { available: 0, pending: 0 },
      });
    }

    // Get Connect account details (external accounts for masked bank display)
    const account = await stripe.accounts.retrieve(user.stripeConnectAccountId, {
      expand: ["external_accounts"],
    });

    // Get balance
    const balance = await stripe.balance.retrieve({
      stripeAccount: user.stripeConnectAccountId,
    });

    const availableBalance = balance.available.reduce(
      (sum, b) => sum + b.amount,
      0,
    );
    const pendingBalance = balance.pending.reduce(
      (sum, b) => sum + b.amount,
      0,
    );

    let bankDetails: {
      institution?: string;
      last4?: string;
      routingNumber?: string;
      currency?: string;
    } | null = null;

    const ext = account.external_accounts?.data;
    if (ext?.length) {
      const first = ext[0];
      if (first.object === "bank_account") {
        bankDetails = {
          institution: first.bank_name ?? undefined,
          last4: first.last4 ?? undefined,
          routingNumber: first.routing_number ?? undefined,
          currency: first.currency ?? undefined,
        };
      }
    }

    let accountHolder: string | undefined;
    if (
      account.business_type === "individual" &&
      account.individual?.first_name &&
      account.individual?.last_name
    ) {
      accountHolder = `${account.individual.first_name} ${account.individual.last_name}`;
    }

    return NextResponse.json({
      setupComplete: account.charges_enabled && account.payouts_enabled,
      balance: {
        available: availableBalance / 100, // Convert from cents
        pending: pendingBalance / 100,
      },
      accountStatus: {
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      },
      bankDetails,
      accountHolder,
    });
  } catch (error: unknown) {
    console.error(
      "Get payout status error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to get payout status",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
