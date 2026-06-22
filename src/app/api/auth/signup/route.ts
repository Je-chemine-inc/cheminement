import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { rateLimit, getClientIp, AuthRateLimits } from "@/lib/rate-limit";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import MedicalProfile from "@/models/MedicalProfile";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";
import {
  EMAIL_VERIFY_TTL_MS,
  generateUrlToken,
  hashVerificationSecret,
} from "@/lib/account-init";
import {
  sendWelcomeEmail,
  sendAccountEmailVerificationEmail,
  sendAdminNewProfessionalSignupAlert,
} from "@/lib/notifications";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { provisionClientServiceRequest } from "@/lib/service-request";

// Allow enough time for cold-start Mongo connect + SMTP send before Vercel kills the function
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`signup:${ip}`, AuthRateLimits.signup.limit, AuthRateLimits.signup.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    await connectToDatabase();

    const {
      email,
      password,
      firstName,
      lastName,
      role,
      phone,
      dateOfBirth,
      gender,
      language,
      location,
      concernedPerson,
      medicalConditions,
      currentMedications,
      consultationMotifs,
      substanceUse,
      accountFor,
      childFirstName,
      childLastName,
      childDateOfBirth,
      childServiceType,
      paymentMethod,
      previousTherapy,
      previousTherapyDetails,
      psychiatricHospitalization,
      currentTreatment,
      diagnosedConditions,
      primaryIssue,
      primaryIssues,
      secondaryIssues,
      issueDescription,
      severity,
      duration,
      triggeringSituation,
      symptoms,
      dailyLifeImpact,
      sleepQuality,
      appetiteChanges,
      treatmentGoals,
      therapyApproach,
      concernsAboutTherapy,
      availability,
      modality,
      sessionFrequency,
      notes,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactEmail,
      emergencyContactRelation,
      preferredGender,
      preferredAge,
      languagePreference,
      culturalConsiderations,
      professionalProfile,
      agreeToTerms,
      acceptPrivacyPolicy,
      provisionedByAdmin,
    } = await req.json();

    // Up to 3 primary concerns; keep the legacy single `primaryIssue` =
    // primaryIssues[0] so the matcher + all readers stay correct.
    const normalizedPrimaryIssues: string[] = Array.isArray(primaryIssues)
      ? primaryIssues.filter(
          (x: unknown): x is string =>
            typeof x === "string" && x.trim().length > 0,
        )
      : typeof primaryIssue === "string" && primaryIssue.trim()
        ? [primaryIssue]
        : [];
    const normalizedPrimaryIssue = normalizedPrimaryIssues[0] || primaryIssue;

    // Validation
    if (!email || !password || !firstName || !lastName || !role) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 },
      );
    }

    if (agreeToTerms !== true || acceptPrivacyPolicy !== true) {
      return NextResponse.json(
        {
          error:
            "Terms of service and privacy policy acceptance are required",
        },
        { status: 400 },
      );
    }

    let bootstrapVerified = false;
    if (provisionedByAdmin === true) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const adminRecord = await Admin.findOne({
        userId: session.user.id,
        isActive: true,
      }).lean();
      if (
        !adminRecord?.permissions.managePatients &&
        !adminRecord?.permissions.manageProfessionals
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      bootstrapVerified = true;
    }

    if (
      (role === "client" || role === "professional") &&
      !bootstrapVerified
    ) {
      const ph = typeof phone === "string" ? phone.trim() : "";
      if (ph.length < 10) {
        return NextResponse.json(
          {
            error:
              "A valid phone number is required for account verification (SMS).",
          },
          { status: 400 },
        );
      }
    }

    // Check if user already exists
    let existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      // Can this record actually log in? (A real account vs. a not-yet-usable
      // shell created by lead capture / the booking funnel.)
      const canLogin =
        Boolean(existingUser.password) &&
        existingUser.role !== "guest" &&
        existingUser.role !== "prospect";
      const isRealActiveAccount =
        canLogin &&
        (Boolean(existingUser.emailVerified) ||
          existingUser.status === "active");

      // Anti-doublon: for a CLIENT signup, CLAIM any not-yet-usable record in
      // place (a guest/prospect lead-capture shell, or an unverified/inactive
      // client) — upgrading it to a client below and PRESERVING its appointments
      // (the Path-A service request). We no longer WIPE shells, which used to
      // orphan their service request and "block" a user who combined both entry
      // paths. A real, usable account is never overwritten (→ "already exists").
      const isClaimableForClient = role === "client" && !isRealActiveAccount;

      if (!isClaimableForClient) {
        // Non-client signups keep the legacy zombie-wipe behavior.
        const isPasswordlessShell =
          !existingUser.password &&
          existingUser.role !== "admin" &&
          existingUser.role !== "employee";
        const isUnusableZombie =
          isPasswordlessShell ||
          (!existingUser.emailVerified &&
            existingUser.adminApproved !== true &&
            existingUser.status !== "active");
        if (!isRealActiveAccount && isUnusableZombie) {
          await Profile.deleteMany({ userId: existingUser._id });
          await MedicalProfile.deleteMany({ userId: existingUser._id });
          await User.deleteOne({ _id: existingUser._id });
          existingUser = null;
        } else {
          return NextResponse.json(
            { error: "User already exists with this email" },
            { status: 400 },
          );
        }
      }
    }

    if (existingUser) {

      // Activate the pre-provisioned account with the client's chosen password.
      // We only reach here for a client signup claiming a not-yet-usable record,
      // so upgrade a guest/prospect shell to a full client (preserving its _id
      // and therefore its existing appointments / service request).
      const hashedPassword = await bcrypt.hash(password, 12);
      existingUser.role = "client";
      existingUser.password = hashedPassword;
      existingUser.firstName = firstName;
      existingUser.lastName = lastName;
      existingUser.phone = phone || existingUser.phone;
      existingUser.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : existingUser.dateOfBirth;
      existingUser.gender = gender || existingUser.gender;
      existingUser.language =
        language === "french" ? "fr" :
        language === "english" ? "en" :
        language === "arabic" ? "ar" :
        language === "spanish" ? "es" :
        language === "mandarin" ? "zh" :
        language === "other" ? "other" :
        existingUser.language;
      existingUser.location = location || existingUser.location;
      existingUser.status = "pending"; // will go active after email+phone verification
      existingUser.accountSecurityVersion = 1;
      existingUser.privacyPolicyAcceptedAt = new Date();
      existingUser.privacyPolicyVersion = LEGAL_VERSIONS.privacy;
      existingUser.termsAcceptedAt = new Date();
      existingUser.termsVersion = LEGAL_VERSIONS.terms;

      // Reset verification state so the user goes through email+phone again
      existingUser.emailVerified = undefined;
      existingUser.phoneVerifiedAt = undefined;
      existingUser.phoneStepTokenHash = undefined;
      existingUser.phoneStepTokenExpires = undefined;
      existingUser.verificationSmsCodeHash = undefined;
      existingUser.verificationSmsExpires = undefined;
      existingUser.verificationSmsAttempts = 0;

      const claimToken = generateUrlToken();
      existingUser.verificationEmailTokenHash = hashVerificationSecret(claimToken);
      existingUser.verificationEmailExpires = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
      await existingUser.save();

      // Upsert the medical profile with updated signup data
      await MedicalProfile.findOneAndUpdate(
        { userId: existingUser._id },
        {
          $set: {
            concernedPerson,
            accountFor,
            childFirstName,
            childLastName,
            childDateOfBirth,
            childServiceType,
            medicalConditions,
            currentMedications,
            consultationMotifs,
            substanceUse,
            previousTherapy,
            previousTherapyDetails,
            psychiatricHospitalization,
            currentTreatment,
            diagnosedConditions,
            primaryIssue: normalizedPrimaryIssue,
            primaryIssues: normalizedPrimaryIssues,
            secondaryIssues,
            issueDescription,
            severity,
            duration,
            triggeringSituation,
            symptoms,
            dailyLifeImpact,
            sleepQuality,
            appetiteChanges,
            treatmentGoals,
            therapyApproach,
            concernsAboutTherapy,
            availability,
            modality,
            sessionFrequency,
            notes,
            emergencyContactName,
            emergencyContactPhone,
            emergencyContactEmail,
            emergencyContactRelation,
            preferredGender,
            preferredAge,
            languagePreference,
            culturalConsiderations,
            paymentMethod,
            profileCompleted: false,
          },
        },
        { upsert: true },
      );

      const base =
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        new URL(req.url).origin;
      const verifyUrl = `${base}/verify-account?uid=${encodeURIComponent(existingUser._id.toString())}&token=${encodeURIComponent(claimToken)}`;
      // Await the send: on Vercel serverless, fire-and-forget can be killed when
      // the response returns, so the email never actually leaves the server.
      try {
        await sendAccountEmailVerificationEmail({
          name: `${firstName} ${lastName}`,
          email: existingUser.email,
          verifyUrl,
          locale: existingUser.language === "en" ? "en" : "fr",
        });
      } catch (err) {
        console.error("Claim account verify email:", err);
      }

      // Anti-doublon + Path B: consolidate any phone-matching shells, flag
      // possible duplicates, and ensure a single routed service request exists.
      // Runs in after() so the response returns fast; it's idempotent and never
      // throws to the caller.
      const claimedClientId = String(existingUser._id);
      after(() => provisionClientServiceRequest(claimedClientId));

      return NextResponse.json(
        {
          message: "Account claimed successfully",
          requiresEmailVerification: true,
          user: {
            id: existingUser._id,
            email: existingUser.email,
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            role: existingUser.role,
          },
        },
        { status: 200 },
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Pros do NOT go through 2FA at signup — the link is sent only when the
    // admin approves their dossier ("L'approbation manuelle par l'Admin déclenche
    // l'envoi du lien de Double Authentification"). They sign in with email +
    // password and can complete their profile while waiting for approval.
    const useSecureInit = !bootstrapVerified && role === "client";

    // Create user
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName,
      lastName,
      role,
      status: "pending",
      phone,
      accountSecurityVersion: useSecureInit ? 1 : 0,
      emailVerified: bootstrapVerified ? new Date() : undefined,
      phoneVerifiedAt: bootstrapVerified ? new Date() : undefined,
      professionalLicenseStatus:
        role === "professional"
          ? "pending_review"
          : "not_applicable",
      gender,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      language:
        language === "french"
          ? "fr"
          : language === "english"
            ? "en"
            : language === "arabic"
              ? "ar"
              : language === "spanish"
                ? "es"
                : language === "mandarin"
                  ? "zh"
                  : language === "other"
                    ? "other"
                    : undefined,
      location: location,
      privacyPolicyAcceptedAt: new Date(),
      privacyPolicyVersion: LEGAL_VERSIONS.privacy,
      termsAcceptedAt: new Date(),
      termsVersion: LEGAL_VERSIONS.terms,
      ...(role === "professional"
        ? {
            professionalTermsAcceptedAt: new Date(),
            professionalTermsVersion: LEGAL_VERSIONS.professionalTerms,
          }
        : {}),
    });

    await user.save();

    let emailVerifyPlainToken: string | null = null;
    if (useSecureInit) {
      emailVerifyPlainToken = generateUrlToken();
      user.verificationEmailTokenHash = hashVerificationSecret(
        emailVerifyPlainToken,
      );
      user.verificationEmailExpires = new Date(
        Date.now() + EMAIL_VERIFY_TTL_MS,
      );
      await user.save();
    }

    if (user.role === "professional") {
      // Create profile for the user with provided professional data
      const profile = new Profile({
        userId: user._id,
        // Professional Information
        problematics: professionalProfile?.problematics,
        approaches: professionalProfile?.approaches,
        ageCategories: professionalProfile?.ageCategories,
        diagnosedConditions: professionalProfile?.diagnosedConditions,
        skills: professionalProfile?.skills,
        bio: professionalProfile?.bio,
        yearsOfExperience: professionalProfile?.yearsOfExperience,
        specialty: professionalProfile?.specialty,
        license: professionalProfile?.license,
        certifications: professionalProfile?.certifications,
        availability: professionalProfile?.availability,
        clinicalAvailability: professionalProfile?.clinicalAvailability,
        // Languages & Session Types
        languages: professionalProfile?.languages,
        sessionTypes: professionalProfile?.sessionTypes,
        modalities: professionalProfile?.modalities,
        // Pricing & Payment
        pricing: professionalProfile?.pricing,
        paymentAgreement: professionalProfile?.paymentAgreement,
        paymentFrequency: professionalProfile?.paymentFrequency,
        // Education
        education: professionalProfile?.education,
        profileCompleted: false,
      });

      try {
        await profile.save();
        // Link the profile to the user
        user.profile = profile.id;
        await user.save();
      } catch (profileErr) {
        // Roll back the user to avoid an orphan record that blocks re-signup.
        await User.deleteOne({ _id: user._id }).catch(() => {});
        throw profileErr;
      }
    } else if (user.role === "client") {
      // Create medical profile for the client with signup data
      const medicalProfile = new MedicalProfile({
        userId: user._id,
        // Personal Information
        concernedPerson: concernedPerson,
        // Account for me / child
        accountFor: accountFor,
        childFirstName: childFirstName,
        childLastName: childLastName,
        childDateOfBirth: childDateOfBirth,
        childServiceType: childServiceType,
        // Health Background
        medicalConditions: medicalConditions,
        currentMedications: currentMedications,
        consultationMotifs: consultationMotifs,
        substanceUse: substanceUse,
        // Mental Health History
        previousTherapy: previousTherapy,
        previousTherapyDetails: previousTherapyDetails,
        psychiatricHospitalization: psychiatricHospitalization,
        currentTreatment: currentTreatment,
        diagnosedConditions: diagnosedConditions,
        // Current Concerns
        primaryIssue: normalizedPrimaryIssue,
        primaryIssues: normalizedPrimaryIssues,
        secondaryIssues: secondaryIssues,
        issueDescription: issueDescription,
        severity: severity,
        duration: duration,
        triggeringSituation: triggeringSituation,
        // Symptoms & Impact
        symptoms: symptoms,
        dailyLifeImpact: dailyLifeImpact,
        sleepQuality: sleepQuality,
        appetiteChanges: appetiteChanges,
        // Goals & Treatment Preferences
        treatmentGoals: treatmentGoals,
        therapyApproach: therapyApproach,
        concernsAboutTherapy: concernsAboutTherapy,
        // Appointment Preferences
        availability: availability,
        modality: modality,
        sessionFrequency: sessionFrequency,
        notes: notes,
        // Emergency Information
        emergencyContactName: emergencyContactName,
        emergencyContactPhone: emergencyContactPhone,
        emergencyContactEmail: emergencyContactEmail,
        emergencyContactRelation: emergencyContactRelation,
        // Professional Matching Preferences
        preferredGender: preferredGender,
        preferredAge: preferredAge,
        languagePreference: languagePreference,
        culturalConsiderations: culturalConsiderations,
        paymentMethod: paymentMethod,
        profileCompleted: false,
      });

      try {
        await medicalProfile.save();
      } catch (profileErr) {
        // Roll back the user to avoid a zombie account that blocks re-signup
        await User.deleteOne({ _id: user._id }).catch(() => {});
        throw profileErr;
      }
    }

    if (bootstrapVerified) {
      // Professionals get a dedicated welcome email on profile completion
      // (sendProfessionalProfileCompletedEmail in /api/profile). Sending the
      // generic welcome here would be a duplicate — skip it for pros.
      if (user.role !== "professional") {
        try {
          await sendWelcomeEmail({
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: user.role as "client" | "professional" | "guest" | "prospect",
            locale: user.language === "en" ? "en" : "fr",
          });
        } catch (err) {
          console.error("Welcome email:", err);
        }

        if (user.phone) {
          const { sendWelcomeSms } = await import("@/lib/sms");
          try {
            await sendWelcomeSms(
              user.phone,
              user.firstName,
              (user.language as "fr" | "en") || "fr",
            );
          } catch (err) {
            console.error("Welcome SMS:", err);
          }
        }
      }
    }

    if (emailVerifyPlainToken) {
      const base =
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        new URL(req.url).origin;
      const verifyUrl = `${base}/verify-account?uid=${encodeURIComponent(user._id.toString())}&token=${encodeURIComponent(emailVerifyPlainToken)}`;
      // Await the send: on Vercel serverless, fire-and-forget can be killed when
      // the response returns, so the email never actually leaves the server.
      try {
        await sendAccountEmailVerificationEmail({
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          verifyUrl,
          locale: user.language === "en" ? "en" : "fr",
        });
      } catch (err) {
        console.error("Verification email:", err);
      }
    }

    // Notify admins that a new professional has applied — they will then
    // validate or send the 2FA activation email from the admin dashboard.
    // Wrapped in after() so the serverless function returns the 201 quickly
    // while keeping the container alive until the SMTP send finishes.
    if (user.role === "professional") {
      const adminAlertArgs = {
        professionalName:
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
          "Professionnel(le)",
        professionalEmail: user.email,
        professionalId: user._id.toString(),
        phone: user.phone,
      };
      after(() =>
        sendAdminNewProfessionalSignupAlert(adminAlertArgs).catch((err) =>
          console.error(
            "sendAdminNewProfessionalSignupAlert (signup):",
            err,
          ),
        ),
      );
    }

    // Path B fix: a direct client signup must also produce a single, routed
    // service request so it appears in the admin "Demandes de service" queue and
    // is matchable — parity with the booking funnel (Path A). Idempotent +
    // never throws; runs in after() so the 201 returns fast.
    if (user.role === "client") {
      const newClientId = String(user._id);
      after(() => provisionClientServiceRequest(newClientId));
    }

    return NextResponse.json(
      {
        message: "User created successfully",
        requiresEmailVerification: Boolean(useSecureInit),
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      {
        error: "Failed to create user",
        details: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
