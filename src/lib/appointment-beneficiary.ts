/**
 * The person an appointment is actually FOR (the beneficiary), which can differ
 * from the account holder (`clientId`): a loved-one booking is for the loved
 * one, a patient referral is for the referred patient. Returns null for "self"
 * bookings or when the beneficiary's name is unknown — callers then just show
 * the account holder.
 */
export function getAppointmentBeneficiary(appointment: {
  bookingFor?: string | null;
  lovedOneInfo?: {
    firstName?: string;
    lastName?: string;
    relationship?: string;
  } | null;
  referralInfo?: {
    patientFirstName?: string;
    patientLastName?: string;
  } | null;
}): { name: string; relationship?: string } | null {
  if (appointment.bookingFor === "loved-one" && appointment.lovedOneInfo) {
    const name = `${appointment.lovedOneInfo.firstName ?? ""} ${
      appointment.lovedOneInfo.lastName ?? ""
    }`.trim();
    if (!name) return null;
    return { name, relationship: appointment.lovedOneInfo.relationship };
  }
  if (appointment.bookingFor === "patient" && appointment.referralInfo) {
    const name = `${appointment.referralInfo.patientFirstName ?? ""} ${
      appointment.referralInfo.patientLastName ?? ""
    }`.trim();
    if (!name) return null;
    return { name };
  }
  return null;
}
