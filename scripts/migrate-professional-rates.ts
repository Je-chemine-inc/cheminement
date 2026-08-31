/**
 * ONE-TIME migration — moves each professional's legacy single-number pricing
 * into the client-price / professional-rate model (spec 001).
 *
 * `profile.pricing.{individualSession,coupleSession,groupSession}` becomes
 * `profile.rates.{solo,couple,group}.professionalRate` — the legacy number is
 * read as what the professional *receives*, per spec 001 Q1.
 *
 * `clientPrice` is deliberately NOT written. Leaving it unset means the
 * professional follows `PlatformSettings.defaultPricing` for that therapy type,
 * so changing the platform tarif keeps applying to them until an admin pins a
 * per-professional price. Writing a copy here would silently freeze every
 * professional at today's default.
 *
 * A legacy value of `0` means **unset**, never "pays nothing" — two live
 * profiles carry `coupleSession: 0` / `groupSession: 0`, and migrating those
 * literally would set real payouts to zero.
 *
 * Idempotent: an already-populated `rates.<type>.professionalRate` is never
 * overwritten, so re-runs are no-ops and an admin's later edit is never undone.
 *
 * Behaviour note: this migration is **not** required for correctness.
 * `calculateAppointmentPricing` already reads the legacy field as the
 * professional's rate, so pricing is identical before and after. This moves the
 * data to the canonical field so the admin editor has one place to read and
 * write, and so the legacy field can eventually be dropped.
 *
 * Usage:
 *   DRY RUN (default — writes nothing, prints the plan):
 *     MONGODB_URI="<uri>" npx tsx scripts/migrate-professional-rates.ts
 *   APPLY:
 *     MONGODB_URI="<uri>" npx tsx scripts/migrate-professional-rates.ts --apply
 *
 * ⚠ Take a fresh mongodump before applying against production
 * (/root/jechemine/backup-mongo.sh on the VPS).
 */
import mongoose from "mongoose";

const LEGACY_TO_TYPE = {
  individualSession: "solo",
  coupleSession: "couple",
  groupSession: "group",
} as const;

type LegacyKey = keyof typeof LEGACY_TO_TYPE;

interface LegacyProfileDoc {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  pricing?: Partial<Record<LegacyKey, unknown>>;
  rates?: Record<string, { clientPrice?: number; professionalRate?: number }>;
}

/** A stored 0 (or a non-positive / non-numeric value) means "unset". */
function configuredRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");

  await mongoose.connect(uri);
  const profiles = mongoose.connection.collection<LegacyProfileDoc>("profiles");

  // A null/empty `pricing` yields no configured rates anyway — configuredRate
  // filters those out per-field, so $exists is a sufficient prefilter.
  const candidates = await profiles.find({ pricing: { $exists: true } }).toArray();

  console.log(
    `${apply ? "APPLY" : "DRY RUN"} — ${candidates.length} profile(s) with legacy pricing\n`,
  );

  let modified = 0;
  let skippedAlreadySet = 0;
  let skippedUnset = 0;

  for (const profile of candidates) {
    const $set: Record<string, number> = {};
    const notes: string[] = [];

    for (const [legacyKey, type] of Object.entries(LEGACY_TO_TYPE) as [
      LegacyKey,
      string,
    ][]) {
      const legacy = configuredRate(profile.pricing?.[legacyKey]);
      const existing = profile.rates?.[type]?.professionalRate;

      if (legacy === undefined) {
        skippedUnset++;
        notes.push(`${type}: legacy unset/0 → skip (falls back to platform)`);
        continue;
      }
      if (configuredRate(existing) !== undefined) {
        skippedAlreadySet++;
        notes.push(`${type}: rates already set to ${existing} → leave alone`);
        continue;
      }

      $set[`rates.${type}.professionalRate`] = legacy;
      notes.push(`${type}: professionalRate ← ${legacy}`);
    }

    console.log(`profile ${profile._id} (user ${profile.userId ?? "?"})`);
    for (const note of notes) console.log(`    ${note}`);

    if (Object.keys($set).length === 0) {
      console.log("    → nothing to write\n");
      continue;
    }

    if (apply) {
      await profiles.updateOne({ _id: profile._id }, { $set });
      modified++;
      console.log("    → written\n");
    } else {
      modified++;
      console.log(`    → would write ${JSON.stringify($set)}\n`);
    }
  }

  console.log(
    `${apply ? "Applied" : "Would modify"}: ${modified} profile(s); ` +
      `${skippedAlreadySet} rate(s) already set, ${skippedUnset} legacy value(s) unset/0.`,
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
