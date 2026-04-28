/**
 * Data Lifecycle — Loi 25 (Quebec) & PCI-DSS compliance
 *
 * Loi 25 requires organizations to destroy or anonymize personal data when it
 * is no longer necessary for the purpose for which it was collected.
 * PCI-DSS requires secure deletion of payment-related data after the legal
 * retention period (7 years for accounting records in Quebec/Canada).
 *
 * This module provides anonymization rather than hard deletion so that
 * referential integrity is preserved in historical records (appointments,
 * receipts, ledger entries).
 */

import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import MedicalProfile from "@/models/MedicalProfile";
import Profile from "@/models/Profile";

const RETENTION_YEARS = 7;
const RETENTION_MS = RETENTION_YEARS * 365.25 * 24 * 60 * 60 * 1000;

const ANONYMIZED_MARKER = "[anonymized]";

export interface AnonymizationReport {
  scanned: number;
  anonymized: number;
  skipped: number;
  errors: number;
  cutoffDate: Date;
}

/**
 * Anonymize inactive accounts whose last activity predates the retention cutoff.
 * "Inactive" means: no emailVerified within the retention window AND no
 * phoneVerifiedAt within the retention window (i.e., account was never fully
 * activated, OR was activated but has since lapsed beyond retention).
 *
 * For fully-verified accounts, the cutoff is measured from phoneVerifiedAt
 * (the final verification step) since we cannot easily track last-login without
 * an audit log. Pair this with a login audit log for tighter accuracy.
 */
export async function anonymizeExpiredAccounts(): Promise<AnonymizationReport> {
  await connectToDatabase();

  const cutoff = new Date(Date.now() - RETENTION_MS);

  const report: AnonymizationReport = {
    scanned: 0,
    anonymized: 0,
    skipped: 0,
    errors: 0,
    cutoffDate: cutoff,
  };

  const candidates = await User.find({
    role: { $in: ["client", "guest", "prospect"] },
    $or: [
      { phoneVerifiedAt: { $lt: cutoff } },
      { emailVerified: { $lt: cutoff }, phoneVerifiedAt: null },
      { emailVerified: null, createdAt: { $lt: cutoff } },
    ],
    firstName: { $ne: ANONYMIZED_MARKER },
  }).select("_id role firstName lastName email phone location createdAt emailVerified phoneVerifiedAt stripeCustomerId");

  report.scanned = candidates.length;

  for (const user of candidates) {
    try {
      user.firstName = ANONYMIZED_MARKER;
      user.lastName = ANONYMIZED_MARKER;
      user.email = `anon_${user._id}@anonymized.invalid`;
      user.phone = undefined;
      user.location = undefined;
      user.dateOfBirth = undefined;
      user.stripeCustomerId = undefined;
      user.status = "inactive";
      await user.save();

      await MedicalProfile.updateOne(
        { userId: user._id },
        {
          $set: {
            medicalConditions: [],
            currentMedications: [],
            consultationMotifs: [],
            primaryIssue: ANONYMIZED_MARKER,
            secondaryIssues: [],
            issueDescription: "",
            symptoms: [],
            emergencyContactName: ANONYMIZED_MARKER,
            emergencyContactPhone: "",
            emergencyContactEmail: "",
            diagnosedConditions: [],
            notes: "",
          },
        },
      );

      report.anonymized += 1;
    } catch (err) {
      console.error(`data-lifecycle: failed to anonymize user ${user._id}:`, err);
      report.errors += 1;
    }
  }

  report.skipped = report.scanned - report.anonymized - report.errors;
  return report;
}

/**
 * Anonymize a single user on explicit account deletion request (right to erasure).
 * Returns false if the user is not found or is already anonymized.
 */
export async function anonymizeSingleUser(userId: string): Promise<boolean> {
  await connectToDatabase();

  const user = await User.findById(userId);
  if (!user || user.firstName === ANONYMIZED_MARKER) return false;

  user.firstName = ANONYMIZED_MARKER;
  user.lastName = ANONYMIZED_MARKER;
  user.email = `anon_${user._id}@anonymized.invalid`;
  user.phone = undefined;
  user.location = undefined;
  user.dateOfBirth = undefined;
  user.stripeCustomerId = undefined;
  user.status = "inactive";
  await user.save();

  await MedicalProfile.updateOne(
    { userId: user._id },
    {
      $set: {
        medicalConditions: [],
        currentMedications: [],
        consultationMotifs: [],
        primaryIssue: ANONYMIZED_MARKER,
        secondaryIssues: [],
        issueDescription: "",
        symptoms: [],
        emergencyContactName: ANONYMIZED_MARKER,
        emergencyContactPhone: "",
        emergencyContactEmail: "",
        diagnosedConditions: [],
        notes: "",
      },
    },
  );

  await Profile.updateOne(
    { userId: user._id },
    { $set: { bio: "", skills: [] } },
  );

  return true;
}
