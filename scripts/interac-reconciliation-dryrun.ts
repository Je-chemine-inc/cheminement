/**
 * READ-ONLY preview of what automatic Interac reconciliation would do.
 *
 * Uses the exact same parser and decision logic as the live reconciler, but
 * writes nothing — no settlement, no receipt, no marker. Run this before
 * enabling reconciliation against a mailbox with history in it, so you can see
 * which transfers would settle automatically and which would be handed to a
 * human, and why.
 *
 * Usage:
 *   MONGODB_URI="<uri>" npx tsx scripts/interac-reconciliation-dryrun.ts
 */
import mongoose from "mongoose";
import { parseInteracNotification } from "../src/lib/interac-notification";
import { decideInteracReconciliation } from "../src/lib/interac-reconciliation";

interface MessageDoc {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  senderEmail?: string;
  subject?: string;
  message?: string;
  metadata?: Record<string, string>;
}

interface AppointmentDoc {
  _id: mongoose.Types.ObjectId;
  status?: string;
  invoiceNumber?: string;
  payment?: {
    status?: string;
    price?: number;
    interacReferenceCode?: string;
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  await mongoose.connect(uri);

  const messages = mongoose.connection.collection<MessageDoc>("externalmessages");
  const appointments = mongoose.connection.collection<AppointmentDoc>("appointments");

  const notifications = await messages
    .find({
      source: "email",
      direction: "inbound",
      senderEmail: { $regex: "@payments\\.interac\\.ca$", $options: "i" },
    })
    .sort({ createdAt: 1 })
    .toArray();

  console.log(
    `${notifications.length} Interac notification(s) in the mailbox. DRY RUN — nothing is written.\n`,
  );

  let wouldSettle = 0;
  let wouldReview = 0;
  let unparsed = 0;

  for (const msg of notifications) {
    const when = msg.createdAt ? msg.createdAt.toISOString().slice(0, 16) : "?";
    const parsed = parseInteracNotification({
      from: msg.senderEmail,
      subject: msg.subject,
      text: msg.message,
    });

    if (!parsed) {
      unparsed++;
      console.log(`${when}  NOT A DEPOSIT ADVICE  "${String(msg.subject).slice(0, 60)}"`);
      continue;
    }

    const appointment = parsed.referenceCode
      ? await appointments.findOne({
          "payment.interacReferenceCode": parsed.referenceCode,
        })
      : null;

    const decision = decideInteracReconciliation(
      {
        amountCad: parsed.amountCad,
        referenceCode: parsed.referenceCode,
        payerName: parsed.payerName,
      },
      appointment
        ? {
            paymentStatus: appointment.payment?.status,
            priceCad: appointment.payment?.price,
            appointmentStatus: appointment.status,
          }
        : null,
    );

    if (decision.action === "settle") wouldSettle++;
    else wouldReview++;

    console.log(
      `${when}  ${decision.action === "settle" ? "SETTLE " : "review "} ` +
        `${String(parsed.amountCad.toFixed(2)).padStart(8)} $  ` +
        `${(parsed.referenceCode ?? "—").padEnd(18)} ` +
        `${(parsed.payerName ?? "—").padEnd(20)}`,
    );
    console.log(`                    ${decision.reason}: ${decision.detail}`);
    if (appointment) {
      console.log(
        `                    → séance ${appointment._id} ` +
          `(${appointment.invoiceNumber ?? "sans facture"}, ` +
          `dû ${appointment.payment?.price ?? "?"} $, ` +
          `état ${appointment.payment?.status ?? "?"})`,
      );
    }
    console.log("");
  }

  console.log(
    `Would settle automatically: ${wouldSettle}   ` +
      `Left for review: ${wouldReview}   Not deposit advices: ${unparsed}`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Dry run failed:", err);
  process.exit(1);
});
