import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Profile from "@/models/Profile";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import { calculateAppointmentPricing } from "@/lib/pricing";
import {
  sendAppointmentConfirmation,
  sendProfessionalNotification,
  sendServiceRequestOnboardingEmail,
  sendReferralConfirmationEmail,
  sendAdminNewServiceRequestAlert,
  sendCancellationNotification,
} from "@/lib/notifications";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";
import { parseAppointmentDate } from "@/lib/appointment-date";
import { resolveServiceRequestRecipient } from "@/lib/service-request-recipient";
import {
  linkGuardian,
  isMinor,
  isUnder14,
  resolveAppointmentRecipient,
} from "@/lib/guardian-utils";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const clientId = searchParams.get("clientId");
    const accountId = searchParams.get("accountId"); // For guardian viewing managed account

    const query: {
      clientId?: string;
      professionalId?: string;
      status?: string;
      date?: { $gte?: Date; $lte?: Date };
    } = {};

    // Filter by user role (guests and prospects are treated like clients)
    if (session.user.role === "client" || session.user.role === "guest" || session.user.role === "prospect") {
      // If accountId is provided, verify user is guardian of that account
      if (accountId) {
        const { canAccessAccount } = await import("@/lib/guardian-utils");
        const canAccess = await canAccessAccount(session.user.id, accountId);
        if (!canAccess) {
          return NextResponse.json(
            { error: "Unauthorized: You don't have access to this account" },
            { status: 403 },
          );
        }
        query.clientId = accountId;
      } else {
        query.clientId = session.user.id;
      }
    } else if (session.user.role === "professional") {
      // Professionals can see their own appointments OR unassigned pending requests
      const showUnassigned = searchParams.get("unassigned") === "true";
      if (showUnassigned) {
        // Show unassigned pending appointments (no professionalId)
        query.professionalId = null as unknown as string;
        query.status = "pending";
      } else {
        query.professionalId = session.user.id;
      }
    }

    // Additional filters
    if (status) {
      query.status = status;
    }

    if (clientId && !accountId) {
      query.clientId = clientId;
    }

    // Admin calendar: scope to a single professional's agenda. Only admins may
    // request another user's appointments by id; clients/pros are already
    // constrained by the role filter above, so this param is ignored for them.
    const professionalIdParam = searchParams.get("professionalId");
    if (professionalIdParam && session.user.role === "admin") {
      query.professionalId = professionalIdParam;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const appointments = await Appointment.find(query)
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone")
      .sort({ date: 1, time: 1 });

    // Hide client gross + platform fee from professionals (commercial confidentiality + accounting clarity)
    if (session.user.role === "professional") {
      const redacted = appointments.map((apt) => {
        const obj = apt.toObject();
        if (obj.payment) {
          const p = obj.payment as unknown as Record<string, unknown>;
          delete p.price;
          delete p.platformFee;
          delete p.listPrice;
        }
        return obj;
      });
      return NextResponse.json(redacted);
    }

    return NextResponse.json(appointments);
  } catch (error: unknown) {
    console.error(
      "Get appointments error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to fetch appointments",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const data = await req.json();

    // This endpoint is the client booking funnel. Admins / professionals /
    // employees never have a clientId of their own; if they reach here, the
    // page-level gate must have been bypassed. Refuse cleanly rather than
    // letting Mongoose throw a "clientId required" validation error.
    const allowedRoles = new Set(["client", "guest", "prospect"]);
    if (!allowedRoles.has(session.user.role)) {
      return NextResponse.json(
        {
          error:
            "Only clients can book appointments through this endpoint. Use the admin or professional dashboard instead.",
          code: "ROLE_NOT_ALLOWED",
        },
        { status: 403 },
      );
    }
    data.clientId = session.user.id;

    // Require phone verification for clients before their first booking
    if (session.user.role === "client") {
      const clientUser = await User.findById(session.user.id).select("phoneVerifiedAt").lean();
      if (clientUser && !clientUser.phoneVerifiedAt) {
        return NextResponse.json(
          { error: "Phone verification required before booking", code: "PHONE_NOT_VERIFIED" },
          { status: 403 },
        );
      }
    }

    // Validate required fields (professionalId is now optional - assigned by professional later)
    if (!data.type) {
      return NextResponse.json(
        { error: "Missing required field: type" },
        { status: 400 },
      );
    }

    const allowedTypes = ["video", "in-person", "phone", "both"];
    if (!allowedTypes.includes(String(data.type))) {
      return NextResponse.json(
        { error: "Invalid appointment type" },
        { status: 400 },
      );
    }

    delete data.notificationLocale;

    // Normalize the self-declared emergency flag (sent as `emergency` from the
    // "rendez-vous d'urgence" funnel) onto the persisted `isEmergency` field.
    data.isEmergency = data.isEmergency === true || data.emergency === true;
    delete data.emergency;

    // Set default therapy type if not provided
    if (!data.therapyType) {
      data.therapyType = "solo";
    }

    // Validate therapy type
    if (!["solo", "couple", "group"].includes(data.therapyType)) {
      return NextResponse.json(
        { error: "Invalid therapy type. Must be solo, couple, or group" },
        { status: 400 },
      );
    }

    // Validate motifs/reasons (needs or reason array)
    const motifs = data.needs || data.reason || [];
    if (!Array.isArray(motifs)) {
      return NextResponse.json(
        { error: "Motifs must be an array" },
        { status: 400 },
      );
    }
    if (motifs.length === 0) {
      // For patient referrals, the "Problématique / Approche souhaitée" is optional.
      if (data.bookingFor !== "patient") {
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

    // Persist the validated motifs array and sync first motif to issueType for backwards-compat
    if (motifs.length > 0) {
      data.needs = motifs;
      if (!data.issueType) {
        data.issueType = motifs[0];
      }
    }

    // Validate patient referral contact info when booking for a patient
    if (data.bookingFor === "patient") {
      const referral = data.referralInfo || {};
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

    // Loved-one email rules by age (legal protection of minors, LSSSS art. 14):
    //   <14  → parent/requester email is the account identifier; child's email
    //          is not required (or used).
    //   14+  → loved one is the account holder; their own email is required.
    if (data.bookingFor === "loved-one") {
      const lovedOneUnder14 = isUnder14({
        dateOfBirth: data.lovedOneInfo?.dateOfBirth,
      });
      if (!lovedOneUnder14) {
        const lovedOneEmail = data.lovedOneInfo?.email?.trim();
        if (!lovedOneEmail) {
          return NextResponse.json(
            { error: "Loved one's email is required" },
            { status: 400 },
          );
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(lovedOneEmail)) {
          return NextResponse.json(
            { error: "Invalid loved one email format" },
            { status: 400 },
          );
        }
      }
    }

    // Only validate professional if one is specified
    let profile = null;
    if (data.professionalId) {
      // Verify professional exists and is active
      const professional = await User.findOne({
        _id: data.professionalId,
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
      profile = await Profile.findOne({ userId: data.professionalId });

      if (!profile) {
        return NextResponse.json(
          { error: "Professional profile not found" },
          { status: 404 },
        );
      }

      // Validate date/time only if provided with a professional
      if (data.date && data.time) {
        // UTC-noon anchor so the booked day never shifts on display, then
        // persist the normalized date.
        const appointmentDate = parseAppointmentDate(data.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!appointmentDate || appointmentDate < today) {
          return NextResponse.json(
            { error: "Cannot book appointments in the past" },
            { status: 400 },
          );
        }
        data.date = appointmentDate;

        // Check if professional is available on the requested day
        if (profile.availability?.days) {
          const dayOfWeek = appointmentDate.toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "UTC",
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
          const requestedTime = data.time;
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
          professionalId: data.professionalId,
          date: appointmentDate,
          time: data.time,
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
        data.professionalId,
        data.therapyType,
      );

      // Set pricing in appointment data
      data.price = pricingResult.sessionPrice;
      data.platformFee = pricingResult.platformFee;
      data.professionalPayout = pricingResult.professionalPayout;
    } else {
      // No professional assigned yet - use platform default pricing
      const pricingResult = await calculateAppointmentPricing(
        null,
        data.therapyType,
      );
      data.price = pricingResult.sessionPrice;
      data.platformFee = pricingResult.platformFee;
      data.professionalPayout = pricingResult.professionalPayout;
    }

    // Set default duration from profile or default to 60 minutes
    if (!data.duration) {
      data.duration = profile?.availability?.sessionDurationMinutes || 60;
    }

    // Meeting link will be added by professional after confirming appointment
    // No automatic generation

    // "Demander un rendez-vous avec un autre professionnel" — server-trusted
    // signal that this client is returning and explicitly wants a *different*
    // professional. We bypass the per-pro auto-router and drop the request
    // straight into the general queue. Admins see an "Ancien client" badge so
    // they don't create duplicates. Confirm via DB rather than trusting only
    // the client flag: the user must already have ≥1 appointment.
    const changeProfessional = data.changeProfessional === true;
    let isReturningClient = false;
    if (
      changeProfessional &&
      (session.user.role === "client" ||
        session.user.role === "guest" ||
        session.user.role === "prospect")
    ) {
      const priorCount = await Appointment.countDocuments({
        clientId: session.user.id,
      });
      if (priorCount > 0) {
        isReturningClient = true;
      }
    }
    delete data.changeProfessional;

    // Auto-cancel the client's existing scheduled appointment(s) with their
    // previous professional when they explicitly request a different one.
    // Without this they would end up with two live appointments at once.
    // We only touch future-dated scheduled appointments — past/completed/
    // already-cancelled rows are left untouched. Each cancelled appointment
    // gets a sendCancellationNotification fired async so the previous pro
    // and the client (LSSSS-routed via resolveAppointmentRecipient) both
    // learn the slot is free.
    if (isReturningClient) {
      const nowDate = new Date();
      const oldScheduledAppointments = await Appointment.find({
        clientId: session.user.id,
        status: "scheduled",
        date: { $gte: nowDate },
      })
        .populate("clientId", "firstName lastName email language")
        .populate("professionalId", "firstName lastName email");

      for (const oldApt of oldScheduledAppointments) {
        await Appointment.findByIdAndUpdate(oldApt._id, {
          status: "cancelled",
          cancelReason: "client_switched_professional",
          cancelledBy: "client",
          cancelledAt: nowDate,
        });

        const oldClient = oldApt.clientId as unknown as {
          firstName?: string;
          lastName?: string;
          email?: string;
          language?: string;
        } | null;
        const oldPro = oldApt.professionalId as unknown as {
          firstName?: string;
          lastName?: string;
          email?: string;
        } | null;

        if (oldClient && oldPro?.email) {
          const oldRecipient = resolveAppointmentRecipient(
            {
              bookingFor: oldApt.bookingFor,
              lovedOneInfo: oldApt.lovedOneInfo,
            },
            oldClient,
          );
          after(() =>
            sendCancellationNotification({
              clientName: oldRecipient.name,
              clientEmail: oldRecipient.email,
              professionalName: `${oldPro.firstName ?? ""} ${oldPro.lastName ?? ""}`.trim(),
              professionalEmail: oldPro.email ?? "",
              date: oldApt.date?.toISOString(),
              time: oldApt.time,
              duration: oldApt.duration || 60,
              type: oldApt.type as
                | "video"
                | "in-person"
                | "phone"
                | "both",
              cancelledBy: "client",
              locale: oldRecipient.language,
            }).catch((err) =>
              console.error(
                "Error sending change-pro auto-cancel notification:",
                err,
              ),
            ),
          );
        }
      }
    }

    // Set status to pending if no professional assigned (request flow)
    if (!data.professionalId) {
      data.status = "pending";
      data.routingStatus = isReturningClient ? "general" : "pending";
      data.isReturningClient = isReturningClient;
    }

    // Set booking context defaults
    if (!data.bookingFor) {
      data.bookingFor = "self";
    }

    // Set payment method if provided
    if (data.paymentMethod) {
      if (!data.payment) {
        data.payment = {};
      }
      data.payment.method = data.paymentMethod;
    }

    // Persist preferred payment method on the user (visible profil + admin).
    // Defaults to "interac" if the client did not make any explicit choice.
    const allowedPreferred = new Set([
      "interac",
      "card",
      "direct_debit",
      "payment_plan",
    ]);
    const preferredFromForm =
      typeof data.preferredPaymentMethod === "string" &&
      allowedPreferred.has(data.preferredPaymentMethod)
        ? data.preferredPaymentMethod
        : null;
    try {
      const me = await User.findById(session.user.id).select(
        "preferredPaymentMethod",
      );
      if (me) {
        if (preferredFromForm) {
          me.preferredPaymentMethod = preferredFromForm;
          await me.save();
        } else if (!me.preferredPaymentMethod) {
          me.preferredPaymentMethod = "interac";
          await me.save();
        }
      }
    } catch (e) {
      console.error("[appointments] preferredPaymentMethod persist:", e);
    }

    // Loved-one account activation decision (admin validation for adults)
    if (data.bookingFor === "loved-one" && data.lovedOneInfo?.dateOfBirth) {
      const lovedOneIsMinor = isMinor({ dateOfBirth: data.lovedOneInfo.dateOfBirth as any });
      data.accountActivationStatus = lovedOneIsMinor
        ? "sent_to_requester"
        : "pending_admin";
      if (lovedOneIsMinor) {
        data.accountActivationSentAt = new Date();
      }
    }

    // Handle guardian/account manager linking for minors
    let minorUserId: string | null = null;
    if (
      data.bookingFor === "loved-one" &&
      data.lovedOneInfo &&
      data.linkGuardian &&
      data.guardianUserId &&
      data.lovedOneInfo.dateOfBirth
    ) {
      try {
        // Check if the loved one is a minor
        const birthDate = new Date(data.lovedOneInfo.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }

        if (age < 18) {
          // Create or find client account for the minor
          const minorEmail = data.lovedOneInfo.email || `${data.lovedOneInfo.firstName.toLowerCase()}.${data.lovedOneInfo.lastName.toLowerCase()}@minor.cheminement.ca`;
          
          let minorUser = await User.findOne({
            email: minorEmail.toLowerCase(),
            role: "client",
          });

          if (!minorUser) {
            // Get guardian's language from database or use default
            const guardianUser = await User.findById(session.user.id);
            const guardianLanguage = guardianUser?.language || data.lovedOneInfo?.language || "en";
            
            // Create new client account for minor
            minorUser = new User({
              email: minorEmail.toLowerCase(),
              firstName: data.lovedOneInfo.firstName,
              lastName: data.lovedOneInfo.lastName,
              phone: data.lovedOneInfo.phone,
              dateOfBirth: birthDate,
              role: "client",
              status: "active",
              language: guardianLanguage,
            });
            await minorUser.save();
            console.log("Created minor user:", minorUser._id.toString());
          } else {
            console.log("Found existing minor user:", minorUser._id.toString());
          }

          // Link guardian
          console.log("Linking guardian:", data.guardianUserId, "to minor:", minorUser._id.toString());
          const linkResult = await linkGuardian(minorUser._id, data.guardianUserId);
          console.log("Link result:", linkResult);
          if (linkResult.success) {
            minorUserId = minorUser._id.toString();
            // Update appointment to use minor's client ID if booking for loved one
            if (data.bookingFor === "loved-one") {
              data.clientId = minorUser._id;
            }
          }
        }
      } catch (err) {
        console.error("Error linking guardian:", err);
        // Continue with appointment creation even if guardian linking fails
      }
    }

    const appointment = new Appointment(data);
    await appointment.save();

    // Notify admins of the new service request.
    // Wrapped in after() so Vercel keeps the serverless function alive until
    // the SMTP send completes; otherwise the container is killed ~250ms after
    // the response and Gmail SMTP (1-2s) never finishes.
    after(async () => {
      try {
        const requester = await User.findById(session.user.id).select(
          "firstName lastName email",
        );
        if (requester?.email) {
          await sendAdminNewServiceRequestAlert({
            clientName: `${requester.firstName ?? ""} ${requester.lastName ?? ""}`.trim() || "Client",
            clientEmail: requester.email,
            bookingFor: data.bookingFor || "self",
            motifs: motifs as string[],
            appointmentId: appointment._id.toString(),
            isEmergency: Boolean(data.isEmergency),
          });
        }
      } catch (e) {
        console.error("Error sending admin new service request alert:", e);
      }
    });

    // Route the appointment to professionals if no professional is assigned.
    // Skip auto-routing for returning clients explicitly asking for a different
    // professional — those land directly in the general list.
    if (!data.professionalId && !isReturningClient) {
      // Route in background (non-blocking)
      after(() =>
        routeAppointmentToProfessionals(appointment._id.toString()).catch(
          (err) => console.error("Error routing appointment:", err),
        ),
      );
    }

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate("clientId", "firstName lastName email phone location language")
      .populate("professionalId", "firstName lastName email phone");

    if (!populatedAppointment) {
      return NextResponse.json(
        { error: "Appointment created but not found" },
        { status: 500 },
      );
    }

    // Send email notifications (non-blocking)
    if (populatedAppointment.professionalId) {
      const professionalDoc =
        populatedAppointment.professionalId as unknown as {
          firstName: string;
          lastName: string;
          email: string;
        };
      const clientDoc = populatedAppointment.clientId as unknown as {
        firstName: string;
        lastName: string;
        email: string;
        language?: string;
      };

      const clientLocale: "fr" | "en" =
        clientDoc.language === "en" ? "en" : "fr";

      const emailData = {
        clientName: `${clientDoc.firstName} ${clientDoc.lastName}`,
        clientEmail: clientDoc.email,
        professionalName: `${professionalDoc.firstName} ${professionalDoc.lastName}`,
        professionalEmail: professionalDoc.email,
        date: populatedAppointment.date?.toISOString(),
        time: populatedAppointment.time,
        duration: populatedAppointment.duration || 60,
        type: populatedAppointment.type as
          | "video"
          | "in-person"
          | "phone"
          | "both",
        meetingLink: populatedAppointment.meetingLink,
        location: populatedAppointment.location,
        isEmergency: Boolean(populatedAppointment.isEmergency),
        bookingFor: populatedAppointment.bookingFor,
        lovedOneInfo: populatedAppointment.lovedOneInfo,
      };

      // Send notifications without blocking the response. after() keeps the
      // serverless function alive until the SMTP sends complete on Vercel.
      after(() =>
        Promise.all([
          sendAppointmentConfirmation({ ...emailData, locale: clientLocale }),
          sendProfessionalNotification(emailData),
        ]).catch((err) =>
          console.error("Error sending notifications:", err),
        ),
      );
    } else {
      // No professional assigned yet — send automatic acknowledgement.
      // Recipient rules (see resolveServiceRequestRecipient):
      //   - self                  → the requester
      //   - loved-one <14         → the requester (parent owns the account; legal
      //                              protection of the minor)
      //   - loved-one 14+ adult   → the loved one directly, at lovedOneInfo.email
      //   - patient referral       → the PATIENT (referralInfo.patientEmail), so a
      //                              referring professional informs the patient and
      //                              NOT themselves; falls back to the referrer when
      //                              no patient email was provided (it is optional).
      const requester = await User.findById(session.user.id).select(
        "firstName lastName email language",
      );
      const requesterLocale: "fr" | "en" =
        requester?.language === "fr" ? "fr" : "en";
      const lovedOneUnder14 =
        data.bookingFor === "loved-one" &&
        isUnder14({ dateOfBirth: data.lovedOneInfo?.dateOfBirth });

      const { toName, toEmail, recipientKind } =
        resolveServiceRequestRecipient({
          bookingFor: data.bookingFor,
          referralInfo: data.referralInfo,
          lovedOneInfo: data.lovedOneInfo,
          lovedOneUnder14,
          fallbackName: `${requester?.firstName ?? ""} ${
            requester?.lastName ?? ""
          }`.trim(),
          fallbackEmail: requester?.email,
        });

      if (toEmail && toName) {
        // A referred patient gets the account-aware referral email (log in vs
        // sign up); everyone else gets the generic service-request onboarding.
        const referrerName = data.referralInfo?.referrerName as
          | string
          | undefined;
        after(() =>
          (recipientKind === "patient"
            ? sendReferralConfirmationEmail({
                toName,
                toEmail,
                referrerName,
                locale: requesterLocale,
              })
            : sendServiceRequestOnboardingEmail({
                toName,
                toEmail,
                locale: requesterLocale,
              })
          ).catch((err) =>
            console.error("Error sending acknowledgement email:", err),
          ),
        );
      }
    }

    return NextResponse.json(populatedAppointment, { status: 201 });
  } catch (error: unknown) {
    console.error(
      "Create appointment error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to create appointment",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
