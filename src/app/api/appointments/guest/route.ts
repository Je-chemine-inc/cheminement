import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Profile from "@/models/Profile";
import User from "@/models/User";
import { calculateAppointmentPricing } from "@/lib/pricing";
import {
  sendGuestBookingConfirmation,
  sendProfessionalNotification,
  sendServiceRequestOnboardingEmail,
  sendAdminNewServiceRequestAlert,
} from "@/lib/notifications";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";
import { isMinor } from "@/lib/guardian-utils";

export async function POST(req: NextRequest) {
  try {
    await connectToDatabase();

    const data = await req.json();

    // Extract guest info and appointment data (notificationLocale = UI lang for emails only)
    const { guestInfo, notificationLocale, ...appointmentData } = data;

    if (!guestInfo) {
      return NextResponse.json(
        { error: "Guest information is required" },
        { status: 400 },
      );
    }

    // Validate guest info
    const { firstName, lastName, email, phone, location } = guestInfo;

    if (!firstName || !lastName || !email || !phone || !location) {
      return NextResponse.json(
        {
          error:
            "All guest information fields are required (firstName, lastName, email, phone, location)",
        },
        { status: 400 },
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Validate required appointment fields (professionalId is now optional)
    if (!appointmentData.type) {
      return NextResponse.json(
        {
          error: "Missing required appointment field: type",
        },
        { status: 400 },
      );
    }

    const allowedTypes = ["video", "in-person", "phone", "both"];
    if (!allowedTypes.includes(String(appointmentData.type))) {
      return NextResponse.json(
        { error: "Invalid appointment type" },
        { status: 400 },
      );
    }

    // Set default therapy type if not provided
    if (!appointmentData.therapyType) {
      appointmentData.therapyType = "solo";
    }

    // Validate therapy type
    if (!["solo", "couple", "group"].includes(appointmentData.therapyType)) {
      return NextResponse.json(
        { error: "Invalid therapy type. Must be solo, couple, or group" },
        { status: 400 },
      );
    }

    // Validate motifs/reasons (needs or reason array)
    const motifs = appointmentData.needs || appointmentData.reason || [];
    if (!Array.isArray(motifs)) {
      return NextResponse.json(
        { error: "Motifs must be an array" },
        { status: 400 },
      );
    }
    if (motifs.length === 0) {
      // For patient referrals, the "Problématique / Approche souhaitée" is optional.
      if (appointmentData.bookingFor !== "patient") {
        return NextResponse.json(
          { error: "At least one motif/reason is required" },
          { status: 400 },
        );
      }
    }
    if (motifs.length > 3) {
      return NextResponse.json(
        { error: "Maximum 3 motifs/reasons allowed" },
        { status: 400 },
      );
    }
    // Validate all motifs are from the active list in the DB (FR or EN labels)
    const { getValidMotifLabels } = await import("@/lib/motifs");
    const validLabels = await getValidMotifLabels();
    const invalidMotifs = motifs.filter((motif) => !validLabels.has(motif));
    if (invalidMotifs.length > 0) {
      return NextResponse.json(
        { error: `Invalid motifs: ${invalidMotifs.join(", ")}` },
        { status: 400 },
      );
    }

    // Validate patient referral contact info when booking for a patient
    if (appointmentData.bookingFor === "patient") {
      const referral = appointmentData.referralInfo || {};
      const referrerName = referral.referrerName?.trim();
      if (!referrerName) {
        return NextResponse.json(
          { error: "Referring professional name is required" },
          { status: 400 },
        );
      }

      const patientFirstName = referral.patientFirstName?.trim();
      const patientLastName = referral.patientLastName?.trim();
      if (!patientFirstName || !patientLastName) {
        return NextResponse.json(
          {
            error:
              "Patient firstName and lastName are required when booking for a patient",
          },
          { status: 400 },
        );
      }

      const patientEmail = referral.patientEmail?.trim();
      if (patientEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(patientEmail)) {
          return NextResponse.json(
            { error: "Invalid patient email format" },
            { status: 400 },
          );
        }
      }
    }

    let isNewGuest = false;

    // Find or create prospect user (unauthenticated form submission).
    // Also match existing guest accounts so returning users aren't duplicated.
    let guestUser = await User.findOne({
      email: email.toLowerCase(),
      role: { $in: ["prospect", "guest"] },
    });

    if (guestUser) {
      // Update contact info if they submit the form again
      guestUser.firstName = firstName;
      guestUser.lastName = lastName;
      guestUser.phone = phone;
      guestUser.location = location;
      await guestUser.save();
    } else {
      // Create new prospect profile (Étape 1 — profil Prospect)
      guestUser = new User({
        email: email.toLowerCase(),
        firstName,
        lastName,
        phone,
        location,
        role: "prospect",
        status: "active",
        language: notificationLocale === "fr" ? "fr" : "en",
      });
      await guestUser.save();
      isNewGuest = true;
    }

    // Only validate professional if one is specified
    let profile = null;
    if (appointmentData.professionalId) {
      // Verify professional exists and is active
      const professional = await User.findOne({
        _id: appointmentData.professionalId,
        role: "professional",
        status: { $in: ["active", "pending"] },
      });

      if (!professional) {
        return NextResponse.json(
          { error: "Professional not found" },
          { status: 404 },
        );
      }

      // Get professional's profile for availability and pricing
      profile = await Profile.findOne({
        userId: appointmentData.professionalId,
      });

      if (!profile) {
        return NextResponse.json(
          { error: "Professional profile not found" },
          { status: 404 },
        );
      }

      // Validate date/time only if provided with a professional
      if (appointmentData.date && appointmentData.time) {
        // Validate date is not in the past
        const appointmentDate = new Date(appointmentData.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (appointmentDate < today) {
          return NextResponse.json(
            { error: "Cannot book appointments in the past" },
            { status: 400 },
          );
        }

        // Check if professional is available on the requested day
        if (profile.availability?.days) {
          const dayOfWeek = appointmentDate.toLocaleDateString("en-US", {
            weekday: "long",
          });
          const dayAvailability = profile.availability.days.find(
            (d) => d.day === dayOfWeek,
          );

          if (!dayAvailability || !dayAvailability.isWorkDay) {
            return NextResponse.json(
              { error: `Professional is not available on ${dayOfWeek}s` },
              { status: 400 },
            );
          }

          // Validate time is within working hours
          const requestedTime = appointmentData.time;
          if (
            requestedTime < dayAvailability.startTime ||
            requestedTime >= dayAvailability.endTime
          ) {
            return NextResponse.json(
              {
                error: `Time slot outside of working hours (${dayAvailability.startTime} - ${dayAvailability.endTime})`,
              },
              { status: 400 },
            );
          }
        }

        // Check for double-booking
        const existingAppointment = await Appointment.findOne({
          professionalId: appointmentData.professionalId,
          date: appointmentDate,
          time: appointmentData.time,
          status: { $in: ["scheduled"] },
        });

        if (existingAppointment) {
          return NextResponse.json(
            { error: "This time slot is already booked" },
            { status: 409 },
          );
        }
      }

      // Calculate pricing based on therapy type using professional or platform defaults
      const pricingResult = await calculateAppointmentPricing(
        appointmentData.professionalId,
        appointmentData.therapyType,
      );

      // Set pricing in appointment data
      appointmentData.price = pricingResult.sessionPrice;
      appointmentData.platformFee = pricingResult.platformFee;
      appointmentData.professionalPayout = pricingResult.professionalPayout;
    } else {
      // No professional assigned yet - use platform default pricing
      const pricingResult = await calculateAppointmentPricing(
        null,
        appointmentData.therapyType,
      );
      appointmentData.price = pricingResult.sessionPrice;
      appointmentData.platformFee = pricingResult.platformFee;
      appointmentData.professionalPayout = pricingResult.professionalPayout;
    }

    // Set default duration from profile or default to 60 minutes
    if (!appointmentData.duration) {
      appointmentData.duration =
        profile?.availability?.sessionDurationMinutes || 60;
    }

    // Set the client ID to the guest user
    appointmentData.clientId = guestUser._id;

    // Set booking context defaults
    if (!appointmentData.bookingFor) {
      appointmentData.bookingFor = "self";
    }

    // Loved-one account activation decision:
    // - child (<18): onboarding link is sent automatically to the requester
    // - adult (>18): onboarding link is pending admin validation
    let lovedOneIsMinor = false;
    if (appointmentData.bookingFor === "loved-one") {
      const dob = (appointmentData as any).lovedOneInfo?.dateOfBirth;
      lovedOneIsMinor = Boolean(dob) && isMinor({ dateOfBirth: dob });
      appointmentData.accountActivationStatus = lovedOneIsMinor
        ? "sent_to_requester"
        : "pending_admin";
    }

    // Set payment method if provided
    const paymentMethod = appointmentData.paymentMethod || "card";

    // Create the appointment with pending payment status (payment after professional confirmation)
    const appointment = new Appointment({
      ...appointmentData,
      status: "pending", // Pending until professional confirms
      routingStatus: appointmentData.professionalId ? "accepted" : "pending", // Will be routed if no professional
      payment: {
        price: appointmentData.price,
        platformFee: appointmentData.platformFee,
        professionalPayout: appointmentData.professionalPayout,
        status: "pending",
        method: paymentMethod,
      },
    });
    await appointment.save();

    // Route the appointment to professionals if no professional is assigned
    if (!appointmentData.professionalId) {
      // Route in background (non-blocking)
      routeAppointmentToProfessionals(appointment._id.toString()).catch((err) =>
        console.error("Error routing appointment:", err),
      );
    }

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

    if (!populatedAppointment) {
      return NextResponse.json(
        { error: "Appointment created but not found" },
        { status: 500 },
      );
    }

    // Send email notifications only if professional is assigned
    if (populatedAppointment.professionalId) {
      const professionalDoc =
        populatedAppointment.professionalId as unknown as {
          firstName: string;
          lastName: string;
          email: string;
        };

      // Send confirmation email to guest
      sendGuestBookingConfirmation({
        guestName: `${firstName} ${lastName}`,
        guestEmail: email,
        professionalName: `${professionalDoc.firstName} ${professionalDoc.lastName}`,
        date: appointmentData.date || "To be scheduled",
        time: appointmentData.time || "To be scheduled",
        duration: appointmentData.duration || 60,
        type: appointmentData.type,
        therapyType: appointmentData.therapyType,
        price: appointmentData.price,
        locale: notificationLocale === "fr" ? "fr" : "en",
        bookingFor: appointmentData.bookingFor,
        lovedOneIsMinor,
      }).catch((err) =>
        console.error("Error sending guest confirmation email:", err),
      );

      // Send notification to professional
      sendProfessionalNotification({
        clientName: `${firstName} ${lastName}`,
        clientEmail: email,
        professionalName: `${professionalDoc.firstName} ${professionalDoc.lastName}`,
        professionalEmail: professionalDoc.email,
        date: appointmentData.date || "To be scheduled",
        time: appointmentData.time || "To be scheduled",
        duration: appointmentData.duration || 60,
        type: appointmentData.type,
      }).catch((err) =>
        console.error("Error sending professional notification email:", err),
      );
    } else {
      // Send confirmation email to guest without professional info
      sendGuestBookingConfirmation({
        guestName: `${firstName} ${lastName}`,
        guestEmail: email,
        professionalName: "To be assigned",
        date: appointmentData.date || "To be scheduled",
        time: appointmentData.time || "To be scheduled",
        duration: appointmentData.duration || 60,
        type: appointmentData.type,
        therapyType: appointmentData.therapyType,
        price: appointmentData.price,
        locale: notificationLocale === "fr" ? "fr" : "en",
        bookingFor: appointmentData.bookingFor,
        lovedOneIsMinor,
      }).catch((err) =>
        console.error("Error sending guest confirmation email:", err),
      );
    }
    
    // Notify admins of the new service request
    void sendAdminNewServiceRequestAlert({
      clientName: `${firstName} ${lastName}`,
      clientEmail: email,
      bookingFor: appointmentData.bookingFor || "self",
      motifs: motifs as string[],
      appointmentId: String(appointment._id),
    }).catch((err) => console.error("Error sending admin alert:", err));

    // Automatically send onboarding invitation to new prospects (Step 2 of the workflow)
    if (isNewGuest) {
      sendServiceRequestOnboardingEmail({
        toName: firstName,
        toEmail: email,
        locale: notificationLocale === "fr" ? "fr" : "en",
      }).catch((err) => 
        console.error("Error sending onboarding email:", err)
      );
    }

    return NextResponse.json(
      {
        appointmentId: populatedAppointment._id,
        appointment: populatedAppointment,
        message:
          "Appointment created successfully. A confirmation email has been sent to " +
          email,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error(
      "Create guest appointment error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to create appointment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
