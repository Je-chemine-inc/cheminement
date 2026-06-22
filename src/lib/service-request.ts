import type { Types } from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import MedicalProfile from "@/models/MedicalProfile";
import Appointment from "@/models/Appointment";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";
import { resolveMatchingConcerns } from "@/lib/matching-concerns";
import {
  consolidatePhoneShells,
  findNameDuplicates,
} from "@/lib/account-dedup";

// An "open" request/booking. A client should only ever have ONE of these at a
// time, so direct signup (Path B) and the booking funnel (Path A) converge on
// a single service request instead of creating duplicates.
const OPEN_STATUSES = ["pending", "scheduled", "ongoing"];

/**
 * Idempotently ensure a client has a pending service request so they appear in
 * the admin "Demandes de service" queue and are assignable/matchable — whatever
 * entry path they used. If the client already has an open request or booking,
 * returns it unchanged. Otherwise seeds a pending Appointment from their medical
 * profile (concern, modality, availability), mirroring an unassigned Path-A
 * booking.
 */
export async function ensurePendingServiceRequest(
  userId: string | Types.ObjectId,
): Promise<{ created: boolean; appointmentId: string | null }> {
  await connectToDatabase();
  const user = await User.findById(userId);
  if (!user || user.role !== "client") {
    return { created: false, appointmentId: null };
  }

  const existing = await Appointment.findOne({
    clientId: user._id,
    status: { $in: OPEN_STATUSES },
  }).select("_id");
  if (existing) {
    return { created: false, appointmentId: String(existing._id) };
  }

  const mp = await MedicalProfile.findOne({ userId: user._id });
  const therapyType = "solo" as const;
  const pricing = await calculateAppointmentPricing(null, therapyType);

  const type =
    mp?.modality === "inPerson"
      ? "in-person"
      : mp?.modality === "both"
        ? "both"
        : "video";

  // Jumelage matches PRIMARILY on the Motifs de consultation, falling back to
  // Problème principal + Problèmes secondaires (see resolveMatchingConcerns).
  // The first concern is the matcher's main anchor; cap the request's needs at
  // 3 (as the booking funnel does).
  const concerns = resolveMatchingConcerns(mp);
  const needs = concerns.slice(0, 3);

  const isChild =
    mp?.accountFor === "child" &&
    Boolean(mp?.childFirstName) &&
    Boolean(mp?.childLastName);

  const method =
    user.preferredPaymentMethod === "card"
      ? "card"
      : user.preferredPaymentMethod === "direct_debit"
        ? "direct_debit"
        : "transfer";

  const appointment = new Appointment({
    clientId: user._id,
    status: "pending",
    routingStatus: "pending",
    duration: 60,
    type,
    therapyType,
    bookingFor: isChild ? "loved-one" : "self",
    lovedOneInfo: isChild
      ? {
          firstName: mp?.childFirstName,
          lastName: mp?.childLastName,
          relationship: "child",
        }
      : undefined,
    needs,
    issueType: concerns[0] || mp?.primaryIssue || undefined,
    preferredAvailability: Array.isArray(mp?.availability) ? mp?.availability : [],
    price: pricing.sessionPrice,
    platformFee: pricing.platformFee,
    professionalPayout: pricing.professionalPayout,
    payment: {
      price: pricing.sessionPrice,
      platformFee: pricing.platformFee,
      professionalPayout: pricing.professionalPayout,
      status: "pending",
      method,
    },
  });
  await appointment.save();
  return { created: true, appointmentId: String(appointment._id) };
}

/**
 * One-call provisioning for a newly created / claimed CLIENT account:
 *  1. merge passwordless shells sharing the phone (anti-doublon), flag real
 *     phone/name collisions for admin review;
 *  2. ensure a single pending service request exists;
 *  3. auto-route it to matching professionals (parity with the booking funnel).
 * Safe to run in `after()` — it never throws to the caller.
 */
export async function provisionClientServiceRequest(
  userId: string | Types.ObjectId,
): Promise<void> {
  try {
    await connectToDatabase();
    const user = await User.findById(userId).select(
      "phone firstName lastName role",
    );
    if (!user || user.role !== "client") return;

    const { flagged } = await consolidatePhoneShells({
      survivorId: userId,
      phone: user.phone,
    });
    const nameDups = await findNameDuplicates({
      firstName: user.firstName,
      lastName: user.lastName,
      excludeId: String(userId),
    });
    const flags = Array.from(new Set([...flagged, ...nameDups]));
    if (flags.length) {
      await User.updateOne(
        { _id: userId },
        { $set: { possibleDuplicateOf: flags } },
      );
    }

    const { created, appointmentId } =
      await ensurePendingServiceRequest(userId);
    if (created && appointmentId) {
      await routeAppointmentToProfessionals(appointmentId);
    }
  } catch (err) {
    console.error("[provisionClientServiceRequest] error:", err);
  }
}
