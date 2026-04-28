import { NextRequest, NextResponse } from "next/server";
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
} from "@/lib/notifications";
import { LEGAL_VERSIONS } from "@/lib/legal";

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
    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      // Allow a client to claim a provisioned-but-inactive account.
      // This happens when the system auto-created the account after a professional
      // accepted their request, but the client never completed signup.
      const isClaimableAccount =
        existingUser.role === "client" &&
        existingUser.status === "inactive" &&
        role === "client";

      if (!isClaimableAccount) {
        return NextResponse.json(
          { error: "User already exists with this email" },
          { status: 400 },
        );
      }

      // Activate the pre-provisioned account with the client's chosen password
      const hashedPassword = await bcrypt.hash(password, 12);
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

      const claimToken = generateUrlToken();
      existingUser.verificationEmailTokenHash = hashVerificationSecret(claimToken);
      existingUser.verificationEmailExpires = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
      await existingUser.save();

      const base = process.env.NEXTAUTH_URL || "";
      const verifyUrl = `${base}/verify-account?uid=${encodeURIComponent(existingUser._id.toString())}&token=${encodeURIComponent(claimToken)}`;
      sendAccountEmailVerificationEmail({
        name: `${firstName} ${lastName}`,
        email: existingUser.email,
        verifyUrl,
      }).catch((err) => console.error("Claim account verify email:", err));

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

    const useSecureInit =
      !bootstrapVerified && (role === "client" || role === "professional");

    // Create user
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName,
      lastName,
      role,
      status: role == "professional" ? "pending" : "active",
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

      await profile.save();

      // Link the profile to the user
      user.profile = profile.id;
      await user.save();
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
        primaryIssue: primaryIssue,
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

      await medicalProfile.save();
    }

    if (bootstrapVerified) {
      sendWelcomeEmail({
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        role: user.role as "client" | "professional" | "guest" | "prospect",
      }).catch((err) => console.error("Welcome email:", err));

      if (user.phone) {
        const { sendWelcomeSms } = await import("@/lib/sms");
        sendWelcomeSms(
          user.phone,
          user.firstName,
          (user.language as "fr" | "en") || "fr",
        ).catch((err) => console.error("Welcome SMS:", err));
      }
    }

    if (emailVerifyPlainToken) {
      const base = process.env.NEXTAUTH_URL || "";
      const verifyUrl = `${base}/verify-account?uid=${encodeURIComponent(user._id.toString())}&token=${encodeURIComponent(emailVerifyPlainToken)}`;
      sendAccountEmailVerificationEmail({
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        verifyUrl,
      }).catch((err) =>
        console.error("Verification email:", err),
      );
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
