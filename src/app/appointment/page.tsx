"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Clock,
  MapPin,
  Video,
  Phone,
  User,
  Users,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Home,
  UserPlus,
  Calendar,
  Upload,
  FileText,
  X,
  Heart,
  Stethoscope,
  CreditCard,
  Building2,
  Handshake,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiClientError, medicalProfileAPI } from "@/lib/api-client";
import { PhoneVerificationModal } from "@/components/appointments/PhoneVerificationModal";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { MotifSearch } from "@/components/ui/MotifSearch";
import { ClinicalAvailabilityGrid } from "@/components/ui/ClinicalAvailabilityGrid";
import {
  isClinicalAvailabilitySlotId,
  migrateLegacyAvailabilitySlots,
} from "@/config/clinical-availability-grid";
import { cn } from "@/lib/utils";
import AppointmentForm from "@/components/appointments/AppointmentForm";
import ProfileSelectionCard from "@/components/appointments/ProfileSelectionCard";
import { useTranslations, useLocale } from "next-intl";

interface GuestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
}

interface LovedOneInfo {
  firstName: string;
  lastName: string;
  relationship: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  notes: string;
  // Requester info (for guest bookings)
  requesterFirstName: string;
  requesterLastName: string;
  requesterEmail: string;
  requesterPhone: string;
  requesterLocation: string;
}

interface ReferralInfo {
  referrerType: "doctor" | "specialist" | "other_professional";
  referrerName: string;
  referrerLicense: string;
  referrerPhone: string;
  referrerEmail: string;
  patientFirstName: string;
  patientLastName: string;
  patientEmail: string;
  patientPhone: string;
  referralReason: string;
  documentUrl: string;
  documentName: string;
}

interface MedicalProfileData {
  primaryIssue?: string;
  availability?: string[];
  modality?: "online" | "inPerson" | "both";
  sessionFrequency?: string;
  location?: string;
}

export default function BookAppointmentPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const tManaged = useTranslations("managedAccounts");
  const tB = useTranslations("AppointmentBooking");
  const tGrid = useTranslations("ClinicalAvailabilityGrid");
  const tHero = useTranslations("HeroSection");
  const locale = useLocale();
  const dateLocale = locale === "fr" ? "fr-CA" : "en-CA";

  const describeAvailabilitySlot = (slot: string): string => {
    if (isClinicalAvailabilitySlotId(slot)) {
      return tGrid(`slotLabels.${slot}`);
    }
    const m = /^(\d{4}-\d{2}-\d{2})-(morning|afternoon|evening)$/.exec(slot);
    if (m) {
      const d = new Date(`${m[1]}T12:00:00`);
      const dayStr = d.toLocaleDateString(dateLocale, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      const period =
        m[2] === "morning"
          ? tB("morning")
          : m[2] === "afternoon"
            ? tB("afternoon")
            : tB("evening");
      return `${dayStr} — ${period}`;
    }
    if (slot === "Weekday Mornings") return tB("weekdayMornings");
    if (slot === "Weekday Afternoons") return tB("weekdayAfternoons");
    if (slot === "Weekday Evenings") return tB("weekdayEvenings");
    if (slot === "Weekends") return tB("weekends");
    return slot;
  };

  // Auth state
  const [isGuest, setIsGuest] = useState(false);
  const [authCheckDone, setAuthCheckDone] = useState(false);

  // Guest info
  const [guestInfo, setGuestInfo] = useState<GuestInfo>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    location: "",
  });

  // Issue Type / Motifs (multi-select, max 3)
  const [issueType, setIssueType] = useState<string[]>([]);

  // Medical profile data for defaults
  const [medicalProfile, setMedicalProfile] =
    useState<MedicalProfileData | null>(null);

  // Step management - starts at -1 for auth check
  // Steps: 0 = Auth Choice, 1 = Who is this for, 2 = Guest Info, 3 = Appointment Details, 4 = Confirmation, 5 = Success
  const [currentStep, setCurrentStep] = useState(-1);

  // Form data
  const [selectedType, setSelectedType] = useState<
    "video" | "in-person" | "phone" | "both"
  >("video");
  const [therapyType, setTherapyType] = useState<"solo" | "couple" | "group">(
    "solo",
  );
  const [notes, setNotes] = useState<string>("");
  const [preferredAvailability, setPreferredAvailability] = useState<string[]>(
    [],
  );

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);

  // Booking context
  const [bookingFor, setBookingFor] = useState<
    "self" | "patient" | "loved-one" | null
  >(null);

  useEffect(() => {
    if (bookingFor === "self") {
      setSelectedType((prev) => (prev === "phone" ? "video" : prev));
    } else if (bookingFor === "loved-one") {
      setSelectedType((prev) => (prev === "phone" ? "video" : prev));
    } else if (bookingFor) {
      setSelectedType((prev) => (prev === "both" ? "video" : prev));
    }
  }, [bookingFor]);

  // Loved one info (for booking for a loved one)
  const [lovedOneInfo, setLovedOneInfo] = useState<LovedOneInfo>({
    firstName: "",
    lastName: "",
    relationship: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    notes: "",
    // Requester info (for guest bookings)
    requesterFirstName: "",
    requesterLastName: "",
    requesterEmail: "",
    requesterPhone: "",
    requesterLocation: "",
  });

  // Guardian/Account Manager state (for minors)
  const [linkAsGuardian, setLinkAsGuardian] = useState(false);

  // Referral info (for booking for a patient - medical professional referral)
  const [referralInfo, setReferralInfo] = useState<ReferralInfo>({
    referrerType: "doctor",
    referrerName: "",
    referrerLicense: "",
    referrerPhone: "",
    referrerEmail: "",
    patientFirstName: "",
    patientLastName: "",
    patientEmail: "",
    patientPhone: "",
    referralReason: "",
    documentUrl: "",
    documentName: "",
  });

  // File upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Payment method state
  const [paymentMethod, setPaymentMethod] = useState<
    "card" | "interac" | "payment_plan"
  >("card");
  const [isFirstAppointment, setIsFirstAppointment] = useState<boolean | null>(
    null,
  );

  // Check for 'for' query param
  const searchParams = useSearchParams();
  useEffect(() => {
    const forParam = searchParams.get("for");
    if (forParam && ["self", "patient", "loved-one"].includes(forParam)) {
      setBookingFor(forParam as "self" | "patient" | "loved-one");
    }
  }, [searchParams]);

  // Fetch medical profile for defaults (authenticated users only)
  useEffect(() => {
    const fetchMedicalProfile = async () => {
      if (status === "authenticated") {
        try {
          const profile = await medicalProfileAPI.get();
          if (profile) {
            setMedicalProfile(profile as MedicalProfileData);
            // Set defaults from medical profile
            if ((profile as MedicalProfileData).primaryIssue) {
              // Convert single issue to array for multi-select
              const primaryIssue = (profile as MedicalProfileData).primaryIssue || "";
              setIssueType(primaryIssue ? [primaryIssue] : []);
            }
            if ((profile as MedicalProfileData).availability?.length) {
              setPreferredAvailability(
                migrateLegacyAvailabilitySlots(
                  (profile as MedicalProfileData).availability || [],
                ),
              );
            }
            if ((profile as MedicalProfileData).modality) {
              const modality = (profile as MedicalProfileData).modality;
              if (modality === "online") {
                setSelectedType("video");
              } else if (modality === "inPerson") {
                setSelectedType("in-person");
              } else if (modality === "both") {
                setSelectedType("both");
              }
            }
          }
        } catch {
          // Medical profile might not exist, that's okay
        }
      }
    };
    fetchMedicalProfile();
  }, [status]);

  // Check if this is the first appointment (authenticated users only)
  useEffect(() => {
    const checkFirstAppointment = async () => {
      if (status === "authenticated" && !isGuest) {
        try {
          const appointments = await apiClient.get<any[]>("/appointments");
          setIsFirstAppointment(appointments.length === 0);
        } catch {
          // If error, assume it's not the first appointment to be safe
          setIsFirstAppointment(false);
        }
      } else {
        // For guests, always assume it's the first appointment
        setIsFirstAppointment(true);
      }
    };
    checkFirstAppointment();
  }, [status, isGuest]);

  // Check authentication status on mount
  useEffect(() => {
    if (status === "loading") return;

    if (status === "authenticated") {
      // User is logged in
      setIsGuest(false);
      setAuthCheckDone(true);
      // Skip Auth Choice (0)
      if (bookingFor) {
        // If booking for patient or loved-one, go to specific info step (2.5)
        // Otherwise skip directly to appointment details (3)
        if (bookingFor === "patient" || bookingFor === "loved-one") {
          setCurrentStep(2.5);
        } else {
          setCurrentStep(3);
        }
      } else {
        setCurrentStep(1); // Start at Who is this for
      }
    } else {
      // User is not logged in
      setAuthCheckDone(true);
      // For professional (patient) bookings, skip Auth Choice and Guest Info, go directly to Professional form
      // For self bookings, skip Auth Choice and Guest Info, go directly to Appointment Details
      // For loved-one bookings, skip Auth Choice and Guest Info, go directly to Loved One form
      if (bookingFor === "patient") {
        setIsGuest(true);
        setCurrentStep(2.5); // Go directly to Professional form
      } else if (bookingFor === "self") {
        setIsGuest(true);
        setCurrentStep(3); // Go directly to Appointment Details
      } else if (bookingFor === "loved-one") {
        setIsGuest(true);
        setCurrentStep(2.5); // Go directly to Loved One form
      } else {
        setCurrentStep(0); // Start at Auth Choice
      }
    }
  }, [status, bookingFor]);

  const handleContinueAsGuest = () => {
    setIsGuest(true);
    if (bookingFor === "patient") {
      setCurrentStep(2.5); // Go directly to Professional form, skip Guest Info
    } else if (bookingFor === "self") {
      setCurrentStep(3); // Go directly to Appointment Details, skip Guest Info
    } else if (bookingFor === "loved-one") {
      setCurrentStep(2.5); // Go directly to Loved One form, skip Guest Info
    } else if (bookingFor) {
      setCurrentStep(2); // Go to Guest Info
    } else {
      setCurrentStep(1); // Go to Who is this for
    }
  };

  const handleSignIn = () => {
    router.push("/login?returnUrl=/appointment");
  };

  const handleWhoChoice = (who: "self" | "patient" | "loved-one") => {
    setBookingFor(who);
    // For patient or loved-one, we need an extra step for their specific info
    // Steps: 0 = Auth Choice, 1 = Who is this for, 2 = Guest Info (if guest),
    //        2.5 = Loved One/Patient Info (new), 3 = Appointment Details, 4 = Confirmation, 5 = Success
    if (who === "self") {
      // For self: if guest -> skip Guest Info, go directly to Appointment Details
      setCurrentStep(isGuest ? 3 : 3);
    } else {
      // For patient or loved-one: if guest -> skip Guest Info, go directly to specific form (2.5)
      if ((who === "patient" || who === "loved-one") && isGuest) {
        setCurrentStep(2.5); // Skip Guest Info for guest bookings
      } else if (isGuest) {
        setCurrentStep(2); // Guest info first (fallback)
      } else {
        setCurrentStep(2.5); // Go directly to specific info form
      }
    }
  };

  // File upload handler for referral documents
  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
    ];
    if (!allowedTypes.includes(file.type)) {
      setError(tB("errors.uploadType"));
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError(tB("errors.fileSize"));
      return;
    }

    try {
      setUploading(true);
      setError("");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload/referral", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to upload file");
      }

      setReferralInfo({
        ...referralInfo,
        documentUrl: data.url,
        documentName: data.fileName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : tB("errors.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveDocument = () => {
    setReferralInfo({
      ...referralInfo,
      documentUrl: "",
      documentName: "",
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Validate loved one info
  const validateLovedOneInfo = (): boolean => {
    // For guest bookings, validate requester info
    if (isGuest) {
      if (!lovedOneInfo.requesterFirstName.trim() || !lovedOneInfo.requesterLastName.trim()) {
        setError(tB("errors.nameRequired"));
        return false;
      }
      if (!lovedOneInfo.requesterEmail.trim()) {
        setError(tB("errors.emailRequired"));
        return false;
      }
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(lovedOneInfo.requesterEmail)) {
        setError(tB("errors.emailInvalid"));
        return false;
      }
      if (!lovedOneInfo.requesterPhone.trim()) {
        setError(tB("errors.phoneRequired"));
        return false;
      }
      if (!lovedOneInfo.requesterLocation.trim()) {
        setError(tB("errors.locationRequired"));
        return false;
      }
    }
    if (!lovedOneInfo.firstName.trim() || !lovedOneInfo.lastName.trim()) {
      setError(tB("errors.lovedOneName"));
      return false;
    }
    if (!lovedOneInfo.relationship) {
      setError(tB("errors.relationshipRequired"));
      return false;
    }
    // Loved one identification (required)
    if (!lovedOneInfo.phone.trim()) {
      setError(tB("errors.phoneRequired"));
      return false;
    }
    if (!lovedOneInfo.dateOfBirth.trim()) {
      setError(tB("errors.dateOfBirthRequired"));
      return false;
    }
    if (!selectedType) {
      setError(tB("errors.modalityRequired"));
      return false;
    }
    if (!issueType || !Array.isArray(issueType) || issueType.length === 0) {
      setError(tB("errors.motifRequired"));
      return false;
    }
    if (issueType.length > 3) {
      setError(tB("errors.motifMax"));
      return false;
    }
    if (preferredAvailability.length === 0) {
      setError(tB("errors.availabilityRequired"));
      return false;
    }
    setError("");
    return true;
  };

  // Validate referral info
  const validateReferralInfo = (): boolean => {
    if (!referralInfo.referrerName.trim()) {
      setError(tB("errors.referrerName"));
      return false;
    }
    if (isGuest) {
      if (!referralInfo.referrerEmail.trim()) {
        setError(tB("errors.referrerEmailRequired"));
        return false;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(referralInfo.referrerEmail)) {
        setError(tB("errors.emailInvalid"));
        return false;
      }
    }
    if (
      !referralInfo.patientFirstName.trim() ||
      !referralInfo.patientLastName.trim()
    ) {
      setError(tB("errors.patientName"));
      return false;
    }
    if (referralInfo.patientEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(referralInfo.patientEmail)) {
        setError(tB("errors.emailInvalid"));
        return false;
      }
    }
    if (issueType.length > 3) {
      setError(tB("errors.motifMax"));
      return false;
    }
    setError("");
    return true;
  };

  const handlePatientDirectSubmit = async () => {
    try {
      setLoading(true);
      setError("");

      const appointmentData: Record<string, unknown> = {
        type: selectedType,
        therapyType,
        issueType: "",
        needs: [],
        reason: [],
        notes,
        bookingFor: "patient",
        preferredAvailability: [],
        notificationLocale: locale === "fr" ? "fr" : "en",
        referralInfo,
      };

      if (isGuest) {
        const nameParts = referralInfo.referrerName.trim().split(/\s+/);
        const referrerFirstName = nameParts[0] || "";
        const referrerLastName = nameParts.slice(1).join(" ") || "";
        const professionalGuestInfo: GuestInfo = {
          firstName: referrerFirstName,
          lastName: referrerLastName,
          email: referralInfo.referrerEmail || "",
          phone: referralInfo.referrerPhone || "",
          location: "",
        };
        setGuestInfo(professionalGuestInfo);
        await apiClient.post<{ appointmentId: string }>("/appointments/guest", {
          ...appointmentData,
          guestInfo: professionalGuestInfo,
        });
      } else {
        await apiClient.post<{ appointmentId: string }>("/appointments", appointmentData);
      }

      setCurrentStep(5);
    } catch (err: unknown) {
      console.error("Error submitting patient referral:", err);
      setError(err instanceof Error ? err.message : tB("errors.submitFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSpecificInfoSubmit = () => {
    if (bookingFor === "loved-one" && !validateLovedOneInfo()) return;
    if (bookingFor === "patient" && !validateReferralInfo()) return;
    if (bookingFor === "loved-one") {
      setCurrentStep(4); // Loved-one merged form: skip Step 3, go directly to review
    } else if (bookingFor === "patient") {
      handlePatientDirectSubmit();
    } else {
      setCurrentStep(3); // Move to appointment details
    }
  };

  const handleGuestInfoSubmit = () => {
    // Validate guest info
    if (
      !guestInfo.firstName.trim() ||
      !guestInfo.lastName.trim() ||
      !guestInfo.email.trim() ||
      !guestInfo.phone.trim() ||
      !guestInfo.location.trim()
    ) {
      setError(tB("errors.fieldsRequired"));
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guestInfo.email)) {
      setError(tB("errors.emailInvalid"));
      return;
    }

    // Phone validation (basic)
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(guestInfo.phone)) {
      setError(tB("errors.phoneInvalid"));
      return;
    }

    setError("");
    // If booking for patient or loved-one, go to specific info form (2.5)
    // Otherwise go directly to appointment details (3)
    console.log("handleGuestInfoSubmit - bookingFor:", bookingFor);
    if (bookingFor === "patient" || bookingFor === "loved-one") {
      console.log("Going to step 2.5");
      setCurrentStep(2.5);
    } else {
      console.log("Going to step 3");
      setCurrentStep(3);
    }
  };

  // Submit guest appointment without payment
  const handleGuestSubmit = async () => {
    try {
      setLoading(true);
      setError("");

      if (preferredAvailability.length === 0) {
        setError(tB("errors.availabilityRequired"));
        setLoading(false);
        return;
      }

      // Prepare motifs data based on booking type
      const motifs = Array.isArray(issueType) ? issueType : issueType ? [issueType] : [];
      
      const appointmentData: Record<string, unknown> = {
        type: selectedType,
        therapyType,
        issueType: motifs.length > 0 ? motifs[0] : "", // Primary issue (first motif)
        needs: bookingFor === "self" || bookingFor === "loved-one" ? motifs : [], // For self and loved-one
        reason: bookingFor === "patient" ? motifs : [], // For patient referrals
        notes,
        bookingFor,
        preferredAvailability,
        notificationLocale: locale === "fr" ? "fr" : "en",
        // Payment method removed from initial form submission
        // Will be collected after professional schedules the appointment
        // paymentMethod:
        //   paymentMethod === "interac"
        //     ? "transfer"
        //     : paymentMethod === "payment_plan"
        //       ? "direct_debit"
        //       : "card",
      };

      let effectiveGuestInfo: GuestInfo = guestInfo;

      // Include loved one info if booking for a loved one
      if (bookingFor === "loved-one" && lovedOneInfo.firstName) {
        appointmentData.lovedOneInfo = lovedOneInfo;
        // Include guardian link request if parent wants to be account manager
        if (linkAsGuardian && status === "authenticated") {
          appointmentData.linkGuardian = true;
          appointmentData.guardianUserId = session?.user?.id;
        }
        // For loved-one guest bookings, build guestInfo from requester fields
        if (isGuest) {
          effectiveGuestInfo = {
            firstName: lovedOneInfo.requesterFirstName,
            lastName: lovedOneInfo.requesterLastName,
            email: lovedOneInfo.requesterEmail,
            phone: lovedOneInfo.requesterPhone,
            location: lovedOneInfo.requesterLocation,
          };
          setGuestInfo(effectiveGuestInfo);
        }
      }

      // Include referral info if booking for a patient
      if (bookingFor === "patient" && referralInfo.referrerName) {
        appointmentData.referralInfo = referralInfo;
        // For professional guest bookings, create guestInfo from referrer info
        if (isGuest) {
          // Parse referrerName to get first and last name
          const nameParts = referralInfo.referrerName.trim().split(/\s+/);
          const referrerFirstName = nameParts[0] || "";
          const referrerLastName = nameParts.slice(1).join(" ") || "";

          // Create guestInfo from referrer information
          // Email and phone are required for guest bookings, use referrer info
          effectiveGuestInfo = {
            firstName: referrerFirstName,
            lastName: referrerLastName,
            email: referralInfo.referrerEmail || "",
            phone: referralInfo.referrerPhone || "",
            location: "", // Location not required for professional bookings, can be empty
          };
          setGuestInfo(effectiveGuestInfo);
        }
      }

      await apiClient.post<{ appointmentId: string }>("/appointments/guest", {
        ...appointmentData,
        guestInfo: effectiveGuestInfo,
      });

      setCurrentStep(5); // Success step
    } catch (err: unknown) {
      console.error("Error booking appointment:", err);
      setError(err instanceof Error ? err.message : tB("errors.submitFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    const issueTypeMissing =
      !issueType || !Array.isArray(issueType) || issueType.length === 0;
    if (!selectedType || (issueTypeMissing && bookingFor !== "patient")) {
      setError(tB("errors.motifRequiredSubmit"));
      return;
    }
    if (issueType.length > 3) {
      setError(tB("errors.motifMax"));
      return;
    }
    if (preferredAvailability.length === 0) {
      setError(tB("errors.availabilityRequired"));
      return;
    }

    // For guests, submit without payment
    if (isGuest) {
      handleGuestSubmit();
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Prepare motifs data based on booking type
      const motifs = Array.isArray(issueType) ? issueType : issueType ? [issueType] : [];
      
      const appointmentData: Record<string, unknown> = {
        type: selectedType,
        therapyType,
        issueType: motifs.length > 0 ? motifs[0] : "", // Primary issue (first motif)
        needs: bookingFor === "self" || bookingFor === "loved-one" ? motifs : [], // For self and loved-one
        reason: bookingFor === "patient" ? motifs : [], // For patient referrals
        notes,
        bookingFor,
        preferredAvailability,
        // Payment method removed from initial form submission
        // Will be collected after professional schedules the appointment
        // paymentMethod:
        //   paymentMethod === "interac"
        //     ? "transfer"
        //     : paymentMethod === "payment_plan"
        //       ? "direct_debit"
        //       : "card",
      };

      // Include loved one info if booking for a loved one
      if (bookingFor === "loved-one" && lovedOneInfo.firstName) {
        appointmentData.lovedOneInfo = lovedOneInfo;
        // Include guardian link request if parent wants to be account manager
        if (linkAsGuardian && status === "authenticated") {
          appointmentData.linkGuardian = true;
          appointmentData.guardianUserId = session?.user?.id;
        }
      }

      // Include referral info if booking for a patient
      if (bookingFor === "patient" && referralInfo.referrerName) {
        appointmentData.referralInfo = referralInfo;
      }

      // Use regular endpoint for authenticated users
      await apiClient.post<{ appointmentId: string }>(
        "/appointments",
        appointmentData,
      );

      setCurrentStep(5); // Success step
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.code === "PHONE_NOT_VERIFIED") {
        setShowPhoneVerification(true);
        return;
      }
      console.error("Error submitting request:", err);
      setError(err instanceof Error ? err.message : tB("errors.submitFailed"));
    } finally {
      setLoading(false);
    }
  };

  const renderSummary = () => {
    return (
      <div className="bg-card rounded-xl border border-border/40 p-6 space-y-6 sticky top-8">
        <h3 className="font-serif text-lg font-medium border-b border-border/40 pb-4 mb-4">
          {tB("requestSummary")}
        </h3>

        {/* Who is this for */}
        <div className={`space-y-1 ${currentStep <= 1 ? "opacity-50" : ""}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {tB("forLabel")}
          </p>
          <div className="flex items-center gap-2 text-sm">
            {bookingFor && currentStep > 1 ? (
              <>
                {bookingFor === "self" && <User className="h-4 w-4" />}
                {bookingFor === "patient" && <User className="h-4 w-4" />}
                {bookingFor === "loved-one" && <Users className="h-4 w-4" />}
                <span>
                  {bookingFor === "loved-one"
                    ? tB("lovedOneLabel")
                    : bookingFor === "self"
                      ? tB("selfLabel")
                      : tB("patientLabel")}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground italic">
                {tB("pending")}
              </span>
            )}
          </div>
        </div>

        {/* Guest Info */}
        {isGuest && (
          <div className={`space-y-1 ${currentStep <= 2 ? "opacity-50" : ""}`}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {tB("yourInfoLabel")}
            </p>
            <div className="text-sm">
              {guestInfo.firstName && currentStep > 2 ? (
                <>
                  <p className="font-medium">
                    {guestInfo.firstName} {guestInfo.lastName}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {guestInfo.email}
                  </p>
                </>
              ) : (
                <span className="text-muted-foreground italic">
                  {tB("pending")}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Details */}
        <div className={`space-y-1 ${currentStep < 3 ? "opacity-50" : ""}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {tB("detailsLabel")}
          </p>
          <div className="text-sm space-y-1">
            {currentStep >= 3 ? (
              <>
                {therapyType && (
                  <div className="flex items-center gap-2">
                    <Users className="h-3 w-3" />
                    <span>
                      {therapyType === "solo"
                        ? tB("individualSession")
                        : therapyType === "couple"
                          ? tB("coupleSession")
                          : tB("groupSession")}
                    </span>
                  </div>
                )}
                {selectedType && (
                  <div className="flex items-center gap-2">
                    {selectedType === "video" && <Video className="h-3 w-3" />}
                    {selectedType === "in-person" && (
                      <MapPin className="h-3 w-3" />
                    )}
                    {selectedType === "phone" && <Phone className="h-3 w-3" />}
                    {selectedType === "both" && <Layers className="h-3 w-3" />}
                    <span>
                      {selectedType === "video"
                        ? tB("videoCall")
                        : selectedType === "in-person"
                          ? tB("inPerson")
                          : selectedType === "both"
                            ? tB("bothModalities")
                            : tB("phoneCall")}
                    </span>
                  </div>
                )}
                {issueType && Array.isArray(issueType) && issueType.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-3 w-3" />
                      <span className="font-medium">{tB("motifsLabel")}</span>
                    </div>
                    <ul className="list-disc list-inside ml-5 space-y-1">
                      {issueType.map((motif, index) => (
                        <li key={index} className="text-sm">
                          {motif}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <span className="text-muted-foreground italic">
                {tB("pending")}
              </span>
            )}
          </div>
        </div>

        {/* Info box about the new flow */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-4 border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-800 dark:text-blue-200">
            <strong>{tB("howItWorks")}</strong>
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
            {tB("howItWorksBody")}
          </p>
        </div>
      </div>
    );
  };

  // Don't render until auth check is complete
  if (!authCheckDone) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Profile selection view — when no ?for= param is set
  if (!bookingFor) {
    return (
      <div className="min-h-screen bg-linear-to-br from-background to-muted/20">
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-8 gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {tHero("back")}
          </Button>

          <div className="text-center mb-14">
            <div className="mb-4">
              <p className="text-sm md:text-base tracking-[0.3em] uppercase text-muted-foreground font-light mb-2">
                {tHero("bookingTitle")}
              </p>
              <div className="w-24 h-0.5 bg-muted-foreground mx-auto" />
            </div>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-serif font-light text-foreground">
              {tHero("bookingSubtitle")}
            </h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <ProfileSelectionCard
              href="/appointment?for=self"
              icon={User}
              title={tHero("forSelf")}
              description={tHero("forSelfDesc")}
              cta={tHero("bookNow")}
            />
            <ProfileSelectionCard
              href="/appointment?for=loved-one"
              icon={Users}
              title={tHero("forLovedOne")}
              description={tHero("forLovedOneDesc")}
              cta={tHero("bookNow")}
            />
            <ProfileSelectionCard
              href="/appointment?for=patient"
              icon={Stethoscope}
              title={tHero("forPatient")}
              description={tHero("forPatientDesc")}
              cta={tHero("bookNow")}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-background to-muted/20">
      <PhoneVerificationModal
        open={showPhoneVerification}
        onClose={() => setShowPhoneVerification(false)}
        onSuccess={() => {
          setShowPhoneVerification(false);
          handleSubmit();
        }}
      />
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-4 gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {tB("back")}
          </Button>
          <h1 className="text-4xl font-serif font-light text-foreground mb-2">
            {tB("requestTitle")}
          </h1>
          <p className="text-muted-foreground text-lg">
            {tB("requestSubtitle")}
            {isGuest && (
              <span className="block text-sm mt-1 text-muted-foreground">
                {tB("bookingAsGuest")}
              </span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sidebar Summary */}
          <div className="hidden lg:block lg:col-span-4 xl:col-span-3">
            {renderSummary()}
          </div>

          {/* Main Content */}
          <div className="lg:col-span-8 xl:col-span-9">
            {/* Error Display */}
            {error && currentStep < 4 && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertCircle className="h-5 w-5" />
                  <p>{error}</p>
                </div>
              </div>
            )}

            {/* Step 0: Account or Guest */}
            {currentStep === 0 && (
              <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                <div className="p-6 border-b border-border/40">
                  <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                    <User className="h-5 w-5" />
                    {tB("howProceedTitle")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    {tB("howProceedSubtitle")}
                  </p>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Sign In Option */}
                    <div
                      className="cursor-pointer rounded-xl border-2 border-border/40 p-6 transition-all hover:border-primary hover:bg-primary/5"
                      onClick={handleSignIn}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="font-semibold text-lg">{tB("signIn")}</h3>
                      </div>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{tB("signInBenefit1")}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{tB("signInBenefit2")}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{tB("signInBenefit3")}</span>
                        </div>
                      </div>
                    </div>

                    {/* Guest Option */}
                    <div
                      className="cursor-pointer rounded-xl border-2 border-border/40 p-6 transition-all hover:border-primary hover:bg-primary/5"
                      onClick={handleContinueAsGuest}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center">
                          <UserPlus className="h-6 w-6 text-accent-foreground" />
                        </div>
                        <h3 className="font-semibold text-lg">
                          {tB("continueAsGuest")}
                        </h3>
                      </div>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{tB("guestBenefit1")}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{tB("guestBenefit2")}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                          <span>{tB("guestBenefit3")}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: Who is this for? */}
            {currentStep === 1 && (
              <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                <div className="p-6 border-b border-border/40">
                  <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                    <User className="h-5 w-5" />
                    {tB("whoForTitle")}
                  </h2>
                </div>
                <div className="p-6">
                  <RadioGroup
                    value={bookingFor || ""}
                    onValueChange={(value) =>
                      handleWhoChoice(value as "self" | "patient" | "loved-one")
                    }
                    className="space-y-4"
                  >
                    {/* Order: 1. For me (Individual), 2. For a loved one, 3. For a patient */}
                    <div
                      className={`cursor-pointer rounded-xl border-2 p-6 transition-all ${
                        bookingFor === "self"
                          ? "border-primary bg-primary/5"
                          : "border-border/40 hover:border-border"
                      }`}
                      onClick={() => handleWhoChoice("self")}
                    >
                      <div className="flex items-start gap-4">
                        <RadioGroupItem value="self" id="self" />
                        <div className="flex-1">
                          <Label
                            htmlFor="self"
                            className="cursor-pointer text-base font-medium text-foreground flex items-center gap-2"
                          >
                            <User className="h-5 w-5 text-primary" />
                            {tB("forMyself")}
                          </Label>
                          <p className="text-sm text-muted-foreground mt-2">
                            {tB("forMyselfDesc")}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`cursor-pointer rounded-xl border-2 p-6 transition-all ${
                        bookingFor === "loved-one"
                          ? "border-primary bg-primary/5"
                          : "border-border/40 hover:border-border"
                      }`}
                      onClick={() => handleWhoChoice("loved-one")}
                    >
                      <div className="flex items-start gap-4">
                        <RadioGroupItem value="loved-one" id="loved-one" />
                        <div className="flex-1">
                          <Label
                            htmlFor="loved-one"
                            className="cursor-pointer text-base font-medium text-foreground flex items-center gap-2"
                          >
                            <Users className="h-5 w-5 text-primary" />
                            {tB("forLovedOneTitle")}
                          </Label>
                          <p className="text-sm text-muted-foreground mt-2">
                            {tB("forLovedOneDesc")}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`cursor-pointer rounded-xl border-2 p-6 transition-all ${
                        bookingFor === "patient"
                          ? "border-primary bg-primary/5"
                          : "border-border/40 hover:border-border"
                      }`}
                      onClick={() => handleWhoChoice("patient")}
                    >
                      <div className="flex items-start gap-4">
                        <RadioGroupItem value="patient" id="patient" />
                        <div className="flex-1">
                          <Label
                            htmlFor="patient"
                            className="cursor-pointer text-base font-medium text-foreground flex items-center gap-2"
                          >
                            <Stethoscope className="h-5 w-5 text-primary" />
                            {tB("forPatientTitle")}
                          </Label>
                          <p className="text-sm text-muted-foreground mt-2">
                            {tB("forPatientDesc")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                  <div className="flex justify-between pt-6">
                    <Button
                      variant="outline"
                      onClick={() => setCurrentStep(0)}
                      className={status === "authenticated" ? "hidden" : ""}
                    >
                      {tB("back")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 1.5: Appointment Form (for authenticated users after selecting booking type) */}
            {!isGuest &&
              status === "authenticated" &&
              bookingFor &&
              currentStep === 1 && (
                <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                  <div className="p-6 border-b border-border/40">
                    <h2 className="text-xl font-serif font-light text-foreground">
                      {bookingFor === "self" && tB("detailsSelf")}
                      {bookingFor === "patient" && tB("detailsPatient")}
                      {bookingFor === "loved-one" && tB("detailsLovedOne")}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-2">
                      {tB("provideInfoSubtitle")}
                    </p>
                  </div>
                  <div className="p-6">
                    <AppointmentForm
                      userType={
                        bookingFor === "patient"
                          ? "professional"
                          : bookingFor === "loved-one"
                            ? "lovedOne"
                            : "client"
                      }
                      userInfo={
                        status === "authenticated" && session?.user
                          ? {
                              firstName: session.user.name?.split(" ")[0] || "",
                              lastName: session.user.name?.split(" ")[1] || "",
                              email: session.user.email || "",
                            }
                          : undefined
                      }
                      disabledFields={
                        status === "authenticated"
                          ? ["firstName", "lastName", "email"]
                          : []
                      }
                      onSubmit={(formData: any) => {
                        console.log("Form submitted:", formData);
                        // Handle form submission
                        setCurrentStep(3);
                      }}
                    />
                  </div>
                  <div className="p-6 border-t border-border/40 flex justify-between">
                    <Button variant="outline" onClick={() => setCurrentStep(0)}>
                      {tB("back")}
                    </Button>
                  </div>
                </div>
              )}

            {/* Step 2: Guest Info (only for guests, but not for patient, self, or loved-one bookings) */}
            {isGuest && currentStep === 2 && bookingFor !== "patient" && bookingFor !== "self" && bookingFor !== "loved-one" && (
              <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                <div className="p-6 border-b border-border/40">
                  <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                    <User className="h-5 w-5" />
                    {tB("yourInfo")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    {tB("yourInfoSubtitle")}
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">
                        {tB("firstName")}{" "}
                        <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="firstName"
                        value={guestInfo.firstName}
                        onChange={(e) =>
                          setGuestInfo({
                            ...guestInfo,
                            firstName: e.target.value,
                          })
                        }
                        placeholder={tB("placeholderFirstName")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">
                        {tB("lastName")}{" "}
                        <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="lastName"
                        value={guestInfo.lastName}
                        onChange={(e) =>
                          setGuestInfo({
                            ...guestInfo,
                            lastName: e.target.value,
                          })
                        }
                        placeholder={tB("placeholderLastName")}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">
                      {tB("email")} <span className="text-red-500">*</span>
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={guestInfo.email}
                        onChange={(e) =>
                          setGuestInfo({ ...guestInfo, email: e.target.value })
                        }
                        placeholder="email@example.com"
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tB("emailHint")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">
                      {tB("phone")} <span className="text-red-500">*</span>
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="phone"
                        type="tel"
                        value={guestInfo.phone}
                        onChange={(e) =>
                          setGuestInfo({ ...guestInfo, phone: e.target.value })
                        }
                        placeholder="+1 (555) 123-4567"
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="location">
                      {tB("location")}{" "}
                      <span className="text-red-500">*</span>
                    </Label>
                    <div className="relative">
                      <Home className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="location"
                        value={guestInfo.location}
                        onChange={(e) =>
                          setGuestInfo({
                            ...guestInfo,
                            location: e.target.value,
                          })
                        }
                        placeholder={tB("placeholderCity")}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={() => setCurrentStep(1)}>
                      {tB("back")}
                    </Button>
                    <Button
                      onClick={handleGuestInfoSubmit}
                      size="lg"
                      className="gap-2"
                    >
                      {tB("continue")}
                      <ArrowLeft className="h-4 w-4 rotate-180" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2.5: Loved One / Patient Specific Info */}
            {currentStep === 2.5 && (
              <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                {/* Loved One Form */}
                {bookingFor === "loved-one" && (
                  <>
                    <div className="p-6 border-b border-border/40">
                      <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                        <Heart className="h-5 w-5 text-pink-500" />
                        {tB("lovedOneInfoTitle")}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-2">
                        {isGuest
                          ? tB("lovedOneInfoSubtitleGuest")
                          : tB("lovedOneInfoSubtitle")}
                      </p>
                    </div>
                    <div className="p-6 space-y-6">
                      {/* Requester Information (for guest bookings) */}
                      {isGuest && (
                        <>
                          <div className="pb-4 border-b border-border/40">
                            <h3 className="text-lg font-medium text-foreground mb-4">
                              {tB("yourContact")}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="requesterFirstName">
                                  {tB("yourFirstName")}{" "}
                                  <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id="requesterFirstName"
                                  value={lovedOneInfo.requesterFirstName}
                                  onChange={(e) =>
                                    setLovedOneInfo({
                                      ...lovedOneInfo,
                                      requesterFirstName: e.target.value,
                                    })
                                  }
                                  placeholder={tB("placeholderFirstName")}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="requesterLastName">
                                  {tB("yourLastName")}{" "}
                                  <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id="requesterLastName"
                                  value={lovedOneInfo.requesterLastName}
                                  onChange={(e) =>
                                    setLovedOneInfo({
                                      ...lovedOneInfo,
                                      requesterLastName: e.target.value,
                                    })
                                  }
                                  placeholder={tB("placeholderLastName")}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="space-y-2">
                                <Label htmlFor="requesterEmail">
                                  {tB("yourEmail")}{" "}
                                  <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input
                                    id="requesterEmail"
                                    type="email"
                                    value={lovedOneInfo.requesterEmail}
                                    onChange={(e) =>
                                      setLovedOneInfo({
                                        ...lovedOneInfo,
                                        requesterEmail: e.target.value,
                                      })
                                    }
                                    placeholder="your.email@example.com"
                                    className="pl-10"
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="requesterPhone">
                                  {tB("yourPhone")}{" "}
                                  <span className="text-red-500">*</span>
                                </Label>
                                <div className="relative">
                                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                  <Input
                                    id="requesterPhone"
                                    type="tel"
                                    value={lovedOneInfo.requesterPhone}
                                    onChange={(e) =>
                                      setLovedOneInfo({
                                        ...lovedOneInfo,
                                        requesterPhone: e.target.value,
                                      })
                                    }
                                    placeholder="+1 (555) 123-4567"
                                    className="pl-10"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 space-y-2">
                              <Label htmlFor="requesterLocation">
                                {tB("yourLocation")}{" "}
                                <span className="text-red-500">*</span>
                              </Label>
                              <div className="relative">
                                <Home className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                  id="requesterLocation"
                                  value={lovedOneInfo.requesterLocation}
                                  onChange={(e) =>
                                    setLovedOneInfo({
                                      ...lovedOneInfo,
                                      requesterLocation: e.target.value,
                                    })
                                  }
                                  placeholder={tB("placeholderCity")}
                                  className="pl-10"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="pt-4">
                            <h3 className="text-lg font-medium text-foreground mb-4">
                              {tB("lovedOneSection")}
                            </h3>
                          </div>
                        </>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="lovedOneFirstName">
                            {tB("firstName")}{" "}
                            <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="lovedOneFirstName"
                            value={lovedOneInfo.firstName}
                            onChange={(e) =>
                              setLovedOneInfo({
                                ...lovedOneInfo,
                                firstName: e.target.value,
                              })
                            }
                            placeholder={tB("placeholderTheirFirst")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lovedOneLastName">
                            {tB("lastName")}{" "}
                            <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="lovedOneLastName"
                            value={lovedOneInfo.lastName}
                            onChange={(e) =>
                              setLovedOneInfo({
                                ...lovedOneInfo,
                                lastName: e.target.value,
                              })
                            }
                            placeholder={tB("placeholderTheirLast")}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="relationship">
                          {tB("relationship")}{" "}
                          <span className="text-red-500">*</span>
                        </Label>
                        <Select
                          value={lovedOneInfo.relationship}
                          onValueChange={(value) =>
                            setLovedOneInfo({
                              ...lovedOneInfo,
                              relationship: value,
                            })
                          }
                        >
                          <SelectTrigger id="relationship">
                            <SelectValue
                              placeholder={tB("selectRelationship")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="spouse">
                              {tB("relSpouse")}
                            </SelectItem>
                            <SelectItem value="child">
                              {tB("relChild")}
                            </SelectItem>
                            <SelectItem value="parent">
                              {tB("relParent")}
                            </SelectItem>
                            <SelectItem value="sibling">
                              {tB("relSibling")}
                            </SelectItem>
                            <SelectItem value="friend">
                              {tB("relFriend")}
                            </SelectItem>
                            <SelectItem value="other">
                              {tB("relOther")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="lovedOneDob">
                            {tB("dateOfBirth")} <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="lovedOneDob"
                            type="date"
                            value={lovedOneInfo.dateOfBirth}
                            required
                            onChange={(e) =>
                              setLovedOneInfo({
                                ...lovedOneInfo,
                                dateOfBirth: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lovedOnePhone">
                            {tB("phone")} <span className="text-red-500">*</span>
                          </Label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              id="lovedOnePhone"
                              type="tel"
                              value={lovedOneInfo.phone}
                              required
                              onChange={(e) =>
                                setLovedOneInfo({
                                  ...lovedOneInfo,
                                  phone: e.target.value,
                                })
                              }
                              placeholder="+1 (555) 123-4567"
                              className="pl-10"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="lovedOneEmail">
                          {tB("emailLabel")}{" "}
                          <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                            {tB("optional")}
                          </span>
                        </Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="lovedOneEmail"
                            type="email"
                            value={lovedOneInfo.email}
                            onChange={(e) =>
                              setLovedOneInfo({
                                ...lovedOneInfo,
                                email: e.target.value,
                              })
                            }
                            placeholder="their.email@example.com"
                            className="pl-10"
                          />
                        </div>
                      </div>

                      {/* Meeting Modality */}
                      <div className="space-y-3 pt-4 border-t border-border/40">
                        <Label>{tB("preferredAppointmentType")}</Label>
                        <RadioGroup
                          value={selectedType}
                          onValueChange={(value) =>
                            setSelectedType(value as "video" | "in-person" | "both")
                          }
                          className="space-y-2"
                        >
                          <label
                            htmlFor="loved-mod-video"
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 p-3 has-[[data-state=checked]]:border-primary/60"
                          >
                            <RadioGroupItem value="video" id="loved-mod-video" />
                            <div className="flex items-center gap-2 text-sm font-normal">
                              <Video className="h-4 w-4 shrink-0" />
                              {tB("videoCall")}
                            </div>
                          </label>
                          <label
                            htmlFor="loved-mod-inperson"
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 p-3 has-[[data-state=checked]]:border-primary/60"
                          >
                            <RadioGroupItem value="in-person" id="loved-mod-inperson" />
                            <div className="flex items-center gap-2 text-sm font-normal">
                              <MapPin className="h-4 w-4 shrink-0" />
                              {tB("inPerson")}
                            </div>
                          </label>
                          <label
                            htmlFor="loved-mod-both"
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 p-3 has-[[data-state=checked]]:border-primary/60"
                          >
                            <RadioGroupItem value="both" id="loved-mod-both" />
                            <div className="flex items-center gap-2 text-sm font-normal">
                              <Layers className="h-4 w-4 shrink-0" />
                              {tB("bothModalities")}
                            </div>
                          </label>
                        </RadioGroup>
                      </div>

                      {/* Session Type */}
                      <div className="space-y-2">
                        <Label>{tB("sessionType")}</Label>
                        <Select
                          value={therapyType}
                          onValueChange={(value: "solo" | "couple" | "group") =>
                            setTherapyType(value)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="solo">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4" />
                                {tB("individualSession")}
                              </div>
                            </SelectItem>
                            <SelectItem value="couple">
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                {tB("coupleSession")}
                              </div>
                            </SelectItem>
                            <SelectItem value="group">
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                {tB("groupSession")}
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2 col-span-full">
                        <Label htmlFor="lovedOneNotes" className="text-sm font-medium">
                          {tB("additionalNotesLabel")}{" "}
                          <span className="text-muted-foreground text-[10px] font-normal uppercase tracking-wider">
                            {tB("optional")}
                          </span>
                        </Label>
                        <div className="relative w-full">
                          <Textarea
                            id="lovedOneNotes"
                            value={lovedOneInfo.notes}
                            onChange={(e) =>
                              setLovedOneInfo({
                                ...lovedOneInfo,
                                notes: e.target.value,
                              })
                            }
                            placeholder={tB("notesLovedOnePlaceholder")}
                            rows={5}
                            className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                          />
                          <span className="absolute bottom-2 right-3 text-[11px] text-muted-foreground/50 select-none pointer-events-none">
                            {lovedOneInfo.notes && lovedOneInfo.notes.length > 0 ? `${lovedOneInfo.notes.length}` : ""}
                          </span>
                        </div>
                      </div>

                      {/* Motif Search Section - ADDED HERE */}
                      <div className="space-y-2 pt-4 border-t border-border/40">
                        <Label htmlFor="issueType">
                          {tB("whatBringsThem")}{" "}
                          <span className="text-red-500">*</span>
                        </Label>
                        <MotifSearch
                          value={issueType}
                          onChange={(value) => {
                            setIssueType(Array.isArray(value) ? value : value ? [value] : []);
                          }}
                          placeholder={tB("motifPlaceholder")}
                          multiSelect={true}
                          maxSelections={3}
                        />
                      </div>

                      {/* Preferred availability grid (required for this step) */}
                      <div className="space-y-2">
                        <Label>
                          {tB("preferredAvailability")}
                          {medicalProfile?.availability &&
                            medicalProfile.availability.length > 0 && (
                              <span className="text-xs text-muted-foreground ml-2">
                                {tB("preFilledProfile")}
                              </span>
                            )}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {tB("availabilityHintGeneric")}
                        </p>
                        <ClinicalAvailabilityGrid
                          value={preferredAvailability}
                          onChange={setPreferredAvailability}
                        />
                      </div>

                      {/* Account Manager / Guardian Section for Minors */}
                      {lovedOneInfo.dateOfBirth && (
                        <div className="pt-4 border-t border-border/40">
                          {(() => {
                            const birthDate = new Date(lovedOneInfo.dateOfBirth);
                            const today = new Date();
                            let age = today.getFullYear() - birthDate.getFullYear();
                            const monthDiff = today.getMonth() - birthDate.getMonth();
                            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                              age--;
                            }
                            const isMinor = age < 18;

                            if (isMinor && session && lovedOneInfo.relationship === "child") {
                              return (
                                <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                                  <div className="flex items-start gap-3">
                                    <User className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                                    <div className="flex-1">
                                      <Label className="text-base font-medium text-foreground">
                                        {tManaged("accountManager")}
                                      </Label>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {tManaged("accountManagerDesc")}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id="linkAsGuardian"
                                      checked={linkAsGuardian}
                                      onChange={(e) => setLinkAsGuardian(e.target.checked)}
                                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                    />
                                    <Label
                                      htmlFor="linkAsGuardian"
                                      className="text-sm font-normal cursor-pointer"
                                    >
                                      {tManaged("linkAccountManager")}
                                    </Label>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      <div className="flex justify-between pt-4">
                        <Button
                          variant="outline"
                          onClick={() => {
                            // For guest bookings (loved-one), go back to Auth Choice (Step 0)
                            // For authenticated users, go back to Who is this for (Step 1)
                            if (isGuest) {
                              setCurrentStep(0);
                            } else {
                              setCurrentStep(1);
                            }
                          }}
                        >
                          {tB("back")}
                        </Button>
                        <Button
                          onClick={handleSpecificInfoSubmit}
                          size="lg"
                          className="gap-2"
                        >
                          {tB("continue")}
                          <ArrowLeft className="h-4 w-4 rotate-180" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {/* Patient Referral Form */}
                {bookingFor === "patient" && (
                  <>
                    <div className="p-6 border-b border-border/40">
                      <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                        <Stethoscope className="h-5 w-5 text-blue-500" />
                        {tB("patientReferralTitle")}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-2">
                        {tB("patientReferralSubtitle")}
                      </p>
                    </div>
                    <div className="p-6 space-y-6">
                      {/* Referrer Type */}
                      <div className="space-y-2">
                        <Label>
                          {tB("yourProfessionalRole")}
                        </Label>
                        <Select
                          value={referralInfo.referrerType}
                          onValueChange={(
                            value:
                              | "doctor"
                              | "specialist"
                              | "other_professional",
                          ) =>
                            setReferralInfo({
                              ...referralInfo,
                              referrerType: value,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="doctor">
                              {tB("roleDoctor")}
                            </SelectItem>
                            <SelectItem value="specialist">
                              {tB("roleSpecialist")}
                            </SelectItem>
                            <SelectItem value="other_professional">
                              {tB("roleOther")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="referrerName">
                            {tB("yourName")}{" "}
                            <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="referrerName"
                            value={referralInfo.referrerName}
                            onChange={(e) =>
                              setReferralInfo({
                                ...referralInfo,
                                referrerName: e.target.value,
                              })
                            }
                            placeholder={tB("placeholderDrName")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="referrerLicense">
                            {tB("licenseLabel")}{" "}
                            <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                              {tB("optional")}
                            </span>
                          </Label>
                          <Input
                            id="referrerLicense"
                            value={referralInfo.referrerLicense}
                            onChange={(e) =>
                              setReferralInfo({
                                ...referralInfo,
                                referrerLicense: e.target.value,
                              })
                            }
                            placeholder={tB("placeholderLicenseHash")}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="referrerPhone">
                            {tB("contactPhone")}{" "}
                            <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                              {tB("optional")}
                            </span>
                          </Label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              id="referrerPhone"
                              type="tel"
                              value={referralInfo.referrerPhone}
                              onChange={(e) =>
                                setReferralInfo({
                                  ...referralInfo,
                                  referrerPhone: e.target.value,
                                })
                              }
                              placeholder="+1 (555) 123-4567"
                              className="pl-10"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="referrerEmail">
                            {tB("contactEmail")}{" "}
                            {isGuest ? (
                              <span className="text-red-500">*</span>
                            ) : (
                              <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                                {tB("optional")}
                              </span>
                            )}
                          </Label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              id="referrerEmail"
                              type="email"
                              value={referralInfo.referrerEmail}
                              onChange={(e) =>
                                setReferralInfo({
                                  ...referralInfo,
                                  referrerEmail: e.target.value,
                                })
                              }
                              placeholder="doctor@clinic.com"
                              className="pl-10"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 col-span-full">
                        <Label htmlFor="referralReason" className="text-sm font-medium">
                          {tB("reasonReferralLabel")}{" "}
                          <span className="text-muted-foreground text-[10px] font-normal uppercase tracking-wider">
                            {tB("optional")}
                          </span>
                        </Label>
                        <div className="relative w-full">
                          <Textarea
                            id="referralReason"
                            value={referralInfo.referralReason}
                            onChange={(e) =>
                              setReferralInfo({
                                ...referralInfo,
                                referralReason: e.target.value,
                              })
                            }
                            placeholder={tB("reasonReferralPlaceholder")}
                            rows={5}
                            className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                          />
                          <span className="absolute bottom-2 right-3 text-[11px] text-muted-foreground/50 select-none pointer-events-none">
                            {referralInfo.referralReason && referralInfo.referralReason.length > 0 ? `${referralInfo.referralReason.length}` : ""}
                          </span>
                        </div>
                      </div>

                      {/* Patient Contact Information */}
                      <div className="space-y-4 pt-4 border-t border-border/40">
                        <h3 className="text-base font-medium text-foreground">
                          {tB("patientContactInfo")}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="patientFirstName">
                              {tB("firstName")}{" "}
                              <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="patientFirstName"
                              value={referralInfo.patientFirstName}
                              onChange={(e) =>
                                setReferralInfo({
                                  ...referralInfo,
                                  patientFirstName: e.target.value,
                                })
                              }
                              placeholder={tB("placeholderFirstName")}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="patientLastName">
                              {tB("lastName")}{" "}
                              <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="patientLastName"
                              value={referralInfo.patientLastName}
                              onChange={(e) =>
                                setReferralInfo({
                                  ...referralInfo,
                                  patientLastName: e.target.value,
                                })
                              }
                              placeholder={tB("placeholderLastName")}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="patientEmail">
                              {tB("emailLabel")}{" "}
                              <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                                {tB("optional")}
                              </span>
                            </Label>
                            <Input
                              id="patientEmail"
                              type="email"
                              value={referralInfo.patientEmail}
                              onChange={(e) =>
                                setReferralInfo({
                                  ...referralInfo,
                                  patientEmail: e.target.value,
                                })
                              }
                              placeholder="patient@email.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="patientPhone">
                              {tB("phoneLabel")}{" "}
                              <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                                {tB("optional")}
                              </span>
                            </Label>
                            <Input
                              id="patientPhone"
                              type="tel"
                              value={referralInfo.patientPhone}
                              onChange={(e) =>
                                setReferralInfo({
                                  ...referralInfo,
                                  patientPhone: e.target.value,
                                })
                              }
                              placeholder="+1 (555) 123-4567"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Document Upload Section */}
                      <div className="space-y-3 pt-4 border-t border-border/40">
                        <Label>
                          {tB("uploadReferralDocLabel")}{" "}
                          <span className="text-muted-foreground text-[10px] font-normal uppercase letter-spacing-wider">
                            {tB("optional")}
                          </span>
                        </Label>
                        <div className="border-2 border-dashed border-border/60 rounded-xl p-6">
                          {referralInfo.documentUrl ? (
                            <div className="flex items-center justify-between bg-muted/50 rounded-lg p-4">
                              <div className="flex items-center gap-3">
                                <FileText className="h-8 w-8 text-primary" />
                                <div>
                                  <p className="font-medium text-sm">
                                    {referralInfo.documentName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {tB("documentUploaded")}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRemoveDocument}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="text-center">
                              <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={handleFileUpload}
                                className="hidden"
                                id="referral-upload"
                              />
                              <label
                                htmlFor="referral-upload"
                                className="cursor-pointer flex flex-col items-center"
                              >
                                {uploading ? (
                                  <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
                                ) : (
                                  <Upload className="h-10 w-10 text-muted-foreground" />
                                )}
                                <p className="mt-2 text-sm text-muted-foreground">
                                  {uploading
                                    ? tB("uploading")
                                    : tB("clickUpload")}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {tB("fileTypes")}
                                </p>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-between pt-4">
                        <Button
                          variant="outline"
                          onClick={() => {
                            // For guest bookings, go back to Auth Choice (Step 0)
                            // For authenticated users, go back to Who is this for (Step 1)
                            if (isGuest) {
                              setCurrentStep(0);
                            } else {
                              setCurrentStep(1);
                            }
                          }}
                        >
                          {tB("back")}
                        </Button>
                        <Button
                          onClick={handleSpecificInfoSubmit}
                          size="lg"
                          className="gap-2"
                          disabled={uploading || loading}
                        >
                          {loading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {tB("submitting")}
                            </>
                          ) : bookingFor === "patient" ? (
                            tB("submitRequest")
                          ) : (
                            <>
                              {tB("continue")}
                              <ArrowLeft className="h-4 w-4 rotate-180" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 3: Appointment Details */}
            {currentStep === 3 && (
              <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                <div className="p-6 border-b border-border/40">
                  <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    {tB("appointmentDetails")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    {isGuest && bookingFor === "self"
                      ? tB("appointmentDetailsSubtitleGuest")
                      : tB("appointmentDetailsSubtitle")}
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  {/* Contact Information for Guest Self Bookings */}
                  {isGuest && bookingFor === "self" && (
                    <>
                      <div className="pb-4 border-b border-border/40">
                        <h3 className="text-lg font-medium text-foreground mb-4">
                          {tB("yourContactInfo")}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="guestFirstName">
                              {tB("firstName")}{" "}
                              <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="guestFirstName"
                              value={guestInfo.firstName}
                              onChange={(e) =>
                                setGuestInfo({
                                  ...guestInfo,
                                  firstName: e.target.value,
                                })
                              }
                              placeholder={tB("placeholderFirstName")}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="guestLastName">
                              {tB("lastName")}{" "}
                              <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="guestLastName"
                              value={guestInfo.lastName}
                              onChange={(e) =>
                                setGuestInfo({
                                  ...guestInfo,
                                  lastName: e.target.value,
                                })
                              }
                              placeholder={tB("placeholderLastName")}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                          <div className="space-y-2">
                            <Label htmlFor="guestEmail">
                              {tB("email")}{" "}
                              <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                id="guestEmail"
                                type="email"
                                value={guestInfo.email}
                                onChange={(e) =>
                                  setGuestInfo({
                                    ...guestInfo,
                                    email: e.target.value,
                                  })
                                }
                                placeholder="your.email@example.com"
                                className="pl-10"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="guestPhone">
                              {tB("phone")}{" "}
                              <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                id="guestPhone"
                                type="tel"
                                value={guestInfo.phone}
                                onChange={(e) =>
                                  setGuestInfo({
                                    ...guestInfo,
                                    phone: e.target.value,
                                  })
                                }
                                placeholder="+1 (555) 123-4567"
                                className="pl-10"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          <Label htmlFor="guestLocation">
                            {tB("location")}{" "}
                            <span className="text-red-500">*</span>
                          </Label>
                          <div className="relative">
                            <Home className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              id="guestLocation"
                              value={guestInfo.location}
                              onChange={(e) =>
                                setGuestInfo({
                                  ...guestInfo,
                                  location: e.target.value,
                                })
                              }
                              placeholder={tB("placeholderCity")}
                              className="pl-10"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {/* Session Type */}
                  <div className="space-y-2">
                    <Label>{tB("sessionType")}</Label>
                    <Select
                      value={therapyType}
                      onValueChange={(value: "solo" | "couple" | "group") =>
                        setTherapyType(value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="solo">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            {tB("individualSession")}
                          </div>
                        </SelectItem>
                        <SelectItem value="couple">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            {tB("coupleSession")}
                          </div>
                        </SelectItem>
                        <SelectItem value="group">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            {tB("groupSession")}
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Consultation / appointment modality */}
                  {bookingFor === "self" ? (
                    <div className="space-y-3">
                      <Label>{tB("consultationTypeSelf")}</Label>
                      <RadioGroup
                        value={selectedType}
                        onValueChange={(value) =>
                          setSelectedType(
                            value as "video" | "in-person" | "both",
                          )
                        }
                        className="space-y-2"
                      >
                        <label
                          htmlFor="self-mod-video"
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 p-3 has-[[data-state=checked]]:border-primary/60"
                        >
                          <RadioGroupItem value="video" id="self-mod-video" />
                          <div className="flex items-center gap-2 text-sm font-normal">
                            <Video className="h-4 w-4 shrink-0" />
                            {tB("videoCall")}
                          </div>
                        </label>
                        <label
                          htmlFor="self-mod-inperson"
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 p-3 has-[[data-state=checked]]:border-primary/60"
                        >
                          <RadioGroupItem
                            value="in-person"
                            id="self-mod-inperson"
                          />
                          <div className="flex items-center gap-2 text-sm font-normal">
                            <MapPin className="h-4 w-4 shrink-0" />
                            {tB("inPerson")}
                          </div>
                        </label>
                        <label
                          htmlFor="self-mod-both"
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 p-3 has-[[data-state=checked]]:border-primary/60"
                        >
                          <RadioGroupItem value="both" id="self-mod-both" />
                          <div className="flex items-center gap-2 text-sm font-normal">
                            <Layers className="h-4 w-4 shrink-0" />
                            {tB("bothModalities")}
                          </div>
                        </label>
                      </RadioGroup>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>{tB("preferredAppointmentType")}</Label>
                      <Select
                        value={selectedType}
                        onValueChange={(
                          value: "video" | "in-person" | "phone",
                        ) => setSelectedType(value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="video">
                            <div className="flex items-center gap-2">
                              <Video className="h-4 w-4" />
                              {tB("videoCall")}
                            </div>
                          </SelectItem>
                          <SelectItem value="in-person">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4" />
                              {tB("inPerson")}
                            </div>
                          </SelectItem>
                          <SelectItem value="phone">
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4" />
                              {tB("phoneCall")}
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Issue Type - Only show if not already collected in Step 2.5 */}
                  {bookingFor !== "patient" &&
                    (bookingFor === "self" ||
                      !issueType ||
                      (Array.isArray(issueType) && issueType.length === 0)) && (
                    <div className="space-y-2">
                      <Label htmlFor="issueType">
                        {tB("whatBringsYou")} *
                        {medicalProfile?.primaryIssue && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {tB("preFilledProfile")}
                          </span>
                        )}
                      </Label>
                      <MotifSearch
                        value={issueType}
                        onChange={(value) => {
                          setIssueType(Array.isArray(value) ? value : value ? [value] : []);
                        }}
                        placeholder={tB("motifPlaceholder")}
                        multiSelect={true}
                        maxSelections={3}
                      />
                    </div>
                  )}

                  {/* Preferred availability (clinical grid for all booking types) */}
                  {bookingFor !== "loved-one" && (
                    <div className="space-y-2">
                      <Label>
                        {tB("preferredAvailability")}
                        {medicalProfile?.availability &&
                          medicalProfile.availability.length > 0 && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {tB("preFilledProfile")}
                            </span>
                          )}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {tB("availabilityHintGeneric")}
                      </p>
                      <ClinicalAvailabilityGrid
                        value={preferredAvailability}
                        onChange={setPreferredAvailability}
                      />
                    </div>
                  )}

                  {/* Payment Method - Hidden from initial form */}
                  {/* Payment method will be collected after professional schedules the appointment */}
                  {/* 
                  <div className="space-y-2">
                    <Label>
                      Mode de paiement *
                      {isFirstAppointment && (
                        <span className="text-xs text-muted-foreground ml-2">
                          (Carte de crédit obligatoire pour le 1er rendez-vous)
                        </span>
                      )}
                    </Label>
                    ...
                  </div>
                  */}

                  {/* Notes */}
                  <div className="space-y-2 col-span-full">
                    <Label className="text-sm font-medium">
                      {tB("additionalNotesLabel")}{" "}
                      <span className="text-muted-foreground text-[10px] font-normal uppercase tracking-wider">
                        {tB("optional")}
                      </span>
                    </Label>
                    <div className="relative w-full">
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={tB("notesPlaceholder")}
                        rows={5}
                        className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                      />
                      <span className="absolute bottom-2 right-3 text-[11px] text-muted-foreground/50 select-none pointer-events-none">
                        {notes.length > 0 ? `${notes.length}` : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Go back to specific info form if patient/loved-one, otherwise to step 0 or 1
                        if (
                          bookingFor === "patient" ||
                          bookingFor === "loved-one"
                        ) {
                          setCurrentStep(2.5);
                        } else if (isGuest && bookingFor === "self") {
                          // For self guest bookings, go back to Auth Choice
                          setCurrentStep(0);
                        } else if (isGuest) {
                          setCurrentStep(2);
                        } else {
                          setCurrentStep(1);
                        }
                      }}
                    >
                      {tB("back")}
                    </Button>
                    <Button
                      onClick={() => {
                        // Validate guest info for self bookings
                        if (isGuest && bookingFor === "self") {
                          if (!guestInfo.firstName.trim() || !guestInfo.lastName.trim() || 
                              !guestInfo.email.trim() || !guestInfo.phone.trim() || !guestInfo.location.trim()) {
                            setError(tB("errors.contactGuest"));
                            return;
                          }
                          // Validate email format
                          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                          if (!emailRegex.test(guestInfo.email)) {
                            setError(tB("errors.emailInvalid"));
                            return;
                          }
                        }
                        if (preferredAvailability.length === 0) {
                          setError(tB("errors.availabilityRequired"));
                          return;
                        }
                        setError("");
                        setCurrentStep(4);
                      }}
                      disabled={
                        preferredAvailability.length === 0 ||
                        (((bookingFor ?? "") !== "patient") &&
                          (!issueType ||
                            !Array.isArray(issueType) ||
                            issueType.length === 0))
                      }
                    >
                      {tB("reviewRequest")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Confirmation */}
            {currentStep === 4 && (
              <div className="max-w-4xl mx-auto rounded-xl bg-card border border-border/40">
                <div className="p-6 border-b border-border/40">
                  <h2 className="text-xl font-serif font-light text-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    {tB("reviewYourRequest")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    {tB("reviewSubtitle")}
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  {/* Summary */}
                  <div className="space-y-4 bg-muted/30 rounded-lg p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          {tB("bookingForLabel")}
                        </p>
                        <p className="font-medium">
                          {bookingFor === "loved-one"
                            ? tB("lovedOneLabel")
                            : bookingFor === "self"
                              ? tB("selfLabel")
                              : tB("patientLabel")}
                        </p>
                      </div>
                      {isGuest && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">
                            {tB("contactLabel")}
                          </p>
                          <p className="font-medium">
                            {guestInfo.firstName} {guestInfo.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {guestInfo.email}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {guestInfo.phone}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          {tB("sessionTypeLabel")}
                        </p>
                        <p className="font-medium">
                          {therapyType === "solo"
                            ? tB("individualSession")
                            : therapyType === "couple"
                              ? tB("coupleSession")
                              : tB("groupSession")}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          {tB("appointmentTypeLabel")}
                        </p>
                        <div className="flex items-center gap-2">
                          {selectedType === "video" && (
                            <Video className="h-4 w-4" />
                          )}
                          {selectedType === "in-person" && (
                            <MapPin className="h-4 w-4" />
                          )}
                          {selectedType === "phone" && (
                            <Phone className="h-4 w-4" />
                          )}
                          {selectedType === "both" && (
                            <Layers className="h-4 w-4" />
                          )}
                          <span className="font-medium">
                            {selectedType === "video"
                              ? tB("videoCall")
                              : selectedType === "in-person"
                                ? tB("inPerson")
                                : selectedType === "both"
                                  ? tB("bothModalities")
                                  : tB("phoneCall")}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          {tB("topicLabel")}
                        </p>
                        <p className="font-medium">
                          {Array.isArray(issueType)
                            ? issueType.join(", ")
                            : String(issueType)}
                        </p>
                      </div>
                      {preferredAvailability.length > 0 && (
                        <div className="md:col-span-2">
                          <p className="text-xs text-muted-foreground mb-1">
                            {tB("preferredAvailabilityLabel")}
                          </p>
                          <p className="font-medium">
                            {preferredAvailability
                              .map(describeAvailabilitySlot)
                              .join(", ")}
                          </p>
                        </div>
                      )}
                      {notes && (
                        <div className="md:col-span-2">
                          <p className="text-xs text-muted-foreground mb-1">
                            {tB("additionalNotesLabel")}
                          </p>
                          <p className="text-sm">{notes}</p>
                        </div>
                      )}
                      {/* Payment Method - Removed from summary */}
                      {/* Payment method will be collected after professional schedules the appointment */}
                      {/* 
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Mode de paiement
                        </p>
                        ...
                      </div>
                      */}
                    </div>
                  </div>

                  {/* Info about what happens next */}
                  <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-4">
                    <div className="flex items-start gap-3">
                      <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-800 dark:text-blue-200">
                          {tB("whatNext")}
                        </p>
                        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                          {tB("whatNextBody", {
                            channel: isGuest
                              ? tB("channelGuest")
                              : tB("channelAccount"),
                          })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={() => setCurrentStep(bookingFor === "loved-one" ? 2.5 : 3)}>
                      {tB("back")}
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading}>
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {tB("submitting")}
                        </>
                      ) : (
                        tB("submitRequest")
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Success */}
            {currentStep === 5 && (
              <div className="max-w-2xl mx-auto text-center">
                <div className="rounded-xl bg-card border border-border/40 p-8">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h2 className="text-2xl font-serif font-light text-foreground mb-2">
                    {tB("requestSubmitted")}
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    {tB("requestSuccessBody")}
                  </p>

                  <div className="space-y-4 text-left bg-muted/30 rounded-lg p-6 mb-6">
                    <div className="flex items-start gap-3">
                      <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {tB("sessionTypeLabel")}
                        </p>
                        <p className="font-medium text-foreground">
                          {therapyType === "solo"
                            ? tB("individualSession")
                            : therapyType === "couple"
                              ? tB("coupleSession")
                              : tB("groupSession")}
                          {" · "}
                          {selectedType === "video"
                            ? tB("videoCall")
                            : selectedType === "in-person"
                              ? tB("inPerson")
                              : selectedType === "both"
                                ? tB("bothModalities")
                                : tB("phoneCall")}
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-border/40 pt-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {tB("topicLabel")}
                          </p>
                          <p className="font-medium text-foreground">
                            {Array.isArray(issueType)
                              ? issueType.join(", ")
                              : String(issueType)}
                          </p>
                        </div>
                      </div>
                    </div>
                    {isGuest && (
                      <div className="border-t border-border/40 pt-4">
                        <div className="flex items-start gap-3">
                          <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-sm text-muted-foreground">
                              {tB("wellContactYouAt")}
                            </p>
                            <p className="font-medium text-foreground">
                              {guestInfo.email}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {guestInfo.phone}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-4 mb-6">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>{tB("whatNextShort")}</strong>
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      {tB("whatNextShortBody")}
                    </p>
                  </div>

                  {isGuest ? (
                    <Button
                      variant="outline"
                      onClick={() => router.push("/")}
                      className="gap-2"
                    >
                      <Home className="h-4 w-4" />
                      {tB("returnHome")}
                    </Button>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Button
                        onClick={() =>
                          router.push("/client/dashboard/appointments")
                        }
                        className="gap-2"
                      >
                        <Calendar className="h-4 w-4" />
                        {tB("viewRequests")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => router.push("/client/dashboard")}
                      >
                        {tB("backDashboard")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
