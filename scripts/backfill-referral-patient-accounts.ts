/**
 * ONE-TIME migration — re-points existing patient referrals at the PATIENT.
 *
 * Referrals created before the fix stored the *referring professional* as the
 * appointment's client, because both booking routes handed the funnel's
 * top-level identity (the referrer, who is the one at the keyboard) straight to
 * `clientId`. In production that meant:
 *   - the professional's queues showed the doctor in the "Client" column and
 *     the referred patient nowhere at all;
 *   - `payment_invitation`, whose recipient resolves from `clientId`, was
 *     emailed to the DOCTOR for the patient's session;
 *   - the patient had no account row at all.
 *
 * For every `bookingFor: "patient"` appointment this registers (or reuses) the
 * patient's account from `referralInfo.patient*` and re-points `clientId` at it.
 * `referralInfo` is untouched — the referrer stays exactly where the blue
 * "Référence patient" badge reads them from.
 *
 * SAFETY
 *   - An appointment whose `clientId` already resolves to the patient's email
 *     is skipped, so the script is idempotent and safe to re-run.
 *   - A patient email that matches a REAL (loginable) account reuses it and
 *     never overwrites that member's profile.
 *   - Referrals without a usable patient name+email are reported and skipped —
 *     there is nothing to register. Fix the data by hand, then re-run.
 *   - The referrer's own account is left in place. This script does not delete
 *     anything.
 *
 * Usage:
 *   DRY RUN (default — writes nothing, prints the plan):
 *     MONGODB_URI="<uri>" npx tsx scripts/backfill-referral-patient-accounts.ts
 *   APPLY:
 *     MONGODB_URI="<uri>" npx tsx scripts/backfill-referral-patient-accounts.ts --apply
 *
 * ⚠ Take a fresh mongodump before applying against production
 * (/root/jechemine/backup-mongo.sh on the VPS).
 */
import mongoose from "mongoose";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ReferralInfoDoc {
  referrerName?: string;
  patientFirstName?: string;
  patientLastName?: string;
  patientEmail?: string;
  patientPhone?: string;
}

interface AppointmentDoc {
  _id: mongoose.Types.ObjectId;
  clientId?: mongoose.Types.ObjectId;
  bookingFor?: string;
  createdAt?: Date;
  referralInfo?: ReferralInfoDoc;
}

interface UserDoc {
  _id: mongoose.Types.ObjectId;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  password?: string;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");

  await mongoose.connect(uri);
  const appointments =
    mongoose.connection.collection<AppointmentDoc>("appointments");
  const users = mongoose.connection.collection<UserDoc>("users");

  const candidates = await appointments
    .find({ bookingFor: "patient" })
    .sort({ createdAt: 1 })
    .toArray();

  console.log(
    `${candidates.length} patient-referral appointment(s) found.` +
      `${apply ? "" : " DRY RUN — nothing will be written.\n"}`,
  );

  let repointed = 0;
  let alreadyCorrect = 0;
  let unusable = 0;
  /**
   * Emails we have registered (or, in a dry run, *would* register). Two
   * referrals for the same patient share one account — without this a dry run
   * reports one "new account" per appointment, because nothing is inserted for
   * the next lookup to find.
   */
  const registered = new Set<string>();

  for (const apt of candidates) {
    const referral = apt.referralInfo ?? {};
    const firstName = clean(referral.patientFirstName);
    const lastName = clean(referral.patientLastName);
    const email = clean(referral.patientEmail).toLowerCase();
    const phone = clean(referral.patientPhone);

    const current = apt.clientId
      ? await users.findOne({ _id: apt.clientId })
      : null;

    console.log(`appointment ${apt._id} (${apt.createdAt?.toISOString() ?? "?"})`);
    console.log(
      `    current client: ${current ? `${current.firstName ?? ""} ${current.lastName ?? ""} <${current.email ?? "?"}> [${current.role ?? "?"}]` : "MISSING"}`,
    );
    console.log(
      `    referred patient: ${firstName} ${lastName} <${email || "—"}>`,
    );
    console.log(`    referrer: ${clean(referral.referrerName) || "—"}`);

    if (!firstName || !lastName || !EMAIL_PATTERN.test(email)) {
      unusable++;
      console.log(
        "    → SKIP: referral carries no usable patient name + email; fix by hand\n",
      );
      continue;
    }

    if (current?.email?.toLowerCase() === email) {
      alreadyCorrect++;
      console.log("    → already points at the patient\n");
      continue;
    }

    let patient = await users.findOne({ email });

    if (patient) {
      const isShell =
        !patient.password ||
        patient.role === "guest" ||
        patient.role === "prospect";
      console.log(
        `    → reuse existing account ${patient._id} (${isShell ? "shell — refreshing name/phone" : "REAL account — left untouched"})`,
      );
      if (apply && isShell) {
        const $set: Record<string, string> = { firstName, lastName };
        if (phone) $set.phone = phone;
        await users.updateOne({ _id: patient._id }, { $set });
      }
    } else if (registered.has(email)) {
      console.log(
        `    → reuse the account ${apply ? "created" : "queued"} for ${email} by an earlier referral`,
      );
    } else {
      registered.add(email);
      console.log(`    → register new prospect for ${email}`);
      if (apply) {
        const now = new Date();
        const insert = await users.insertOne({
          _id: new mongoose.Types.ObjectId(),
          email,
          firstName,
          lastName,
          ...(phone ? { phone } : {}),
          role: "prospect",
          status: "active",
          language: "fr",
          preferredPaymentMethod: "interac",
          createdAt: now,
          updatedAt: now,
        } as UserDoc);
        patient = { _id: insert.insertedId, email };
      }
    }

    if (apply && patient) {
      await appointments.updateOne(
        { _id: apt._id },
        { $set: { clientId: patient._id } },
      );
      console.log(`    → clientId ← ${patient._id}\n`);
    } else {
      console.log("    → would re-point clientId at the patient\n");
    }
    repointed++;
  }

  console.log(
    `${apply ? "Applied" : "Would change"}: ${repointed} appointment(s) re-pointed, ` +
      `${registered.size} patient account(s) ${apply ? "created" : "to create"}; ` +
      `${alreadyCorrect} already correct, ${unusable} unusable.`,
  );
  if (!apply) {
    console.log("\nNothing was written. Re-run with --apply to commit.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
