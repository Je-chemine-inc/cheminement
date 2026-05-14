import connectToDatabase from "@/lib/mongodb";
import PlatformSettings from "@/models/PlatformSettings";

/** Priorité : env INTERAC_DEPOSIT_EMAIL → PlatformSettings → placeholder doc. */
export async function getInteracDepositEmail(): Promise<string> {
  const env = process.env.INTERAC_DEPOSIT_EMAIL?.trim();
  if (env) return env;

  await connectToDatabase();
  const s = await PlatformSettings.findOne().lean();
  const fromDb = s?.interacDepositEmail?.trim();
  if (fromDb) return fromDb;

  return "paiements@jechemine.ca";
}
