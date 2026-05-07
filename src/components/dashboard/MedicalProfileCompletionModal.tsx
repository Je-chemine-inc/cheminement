"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { useTranslations } from "next-intl";
import { IMedicalProfile } from "@/models/MedicalProfile";
import { medicalProfileAPI } from "@/lib/api-client";
import {
  CHILD_DIAGNOSTICS,
  CHILD_DIAGNOSTICS_EN,
} from "@/data/childDiagnostics";
import {
  ADULT_DIAGNOSTICS,
  ADULT_DIAGNOSTICS_EN,
} from "@/data/adultDiagnostics";
import { useLocale } from "next-intl";
import { translateFromMap } from "@/lib/bilingual";

interface MedicalProfileCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  setMedicalProfile: (data: IMedicalProfile) => void;
  profile?: IMedicalProfile;
}

export interface MedicalProfileData {
  concernedPerson: string;
  medicalConditions: string[];
  currentMedications: string[];
  allergies: string[];
  substanceUse: string;
  previousTherapy: boolean;
  previousTherapyDetails: string;
  psychiatricHospitalization: boolean;
  currentTreatment: string;
  diagnosedConditions: string[];
  primaryIssue: string;
  secondaryIssues: string[];
  issueDescription: string;
  severity: string;
  duration: string;
  triggeringSituation: string;
  symptoms: string[];
  dailyLifeImpact: string;
  sleepQuality: string;
  appetiteChanges: string;
  treatmentGoals: string[];
  therapyApproach: string[];
  concernsAboutTherapy: string;
  availability: string[];
  modality: string;
  location: string;
  sessionFrequency: string;
  notes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  preferredGender: string;
  preferredAge: string;
  languagePreference: string;
  culturalConsiderations: string;
}

export default function MedicalProfileCompletionModal({
  isOpen,
  onClose,
  setMedicalProfile,
  profile,
}: MedicalProfileCompletionModalProps) {
  const t = useTranslations("Client.profileModal");
  const locale = useLocale();
  const diagnosticsMap: Record<string, string> = {
    ...CHILD_DIAGNOSTICS_EN,
    ...ADULT_DIAGNOSTICS_EN,
  };
  const [currentStep, setCurrentStep] = useState(0);

  const STEPS = [
    {
      title: t("steps.healthBackground"),
      description: t("steps.healthBackgroundDesc"),
    },
    {
      title: t("steps.mentalHealthHistory"),
      description: t("steps.mentalHealthHistoryDesc"),
    },
    {
      title: t("steps.currentConcerns"),
      description: t("steps.currentConcernsDesc"),
    },
    {
      title: t("steps.symptomsImpact"),
      description: t("steps.symptomsImpactDesc"),
    },
    {
      title: t("steps.goalsPreferences"),
      description: t("steps.goalsPreferencesDesc"),
    },
    {
      title: t("steps.appointmentPreferences"),
      description: t("steps.appointmentPreferencesDesc"),
    },
    {
      title: t("steps.emergencyInfo"),
      description: t("steps.emergencyInfoDesc"),
    },
    {
      title: t("steps.matchingPreferences"),
      description: t("steps.matchingPreferencesDesc"),
    },
  ];

  const [formData, setFormData] = useState<MedicalProfileData>({
    concernedPerson: profile?.concernedPerson || "",
    medicalConditions: profile?.medicalConditions || [],
    currentMedications: profile?.currentMedications || [],
    allergies: profile?.allergies || [],
    substanceUse: profile?.substanceUse || "",
    previousTherapy: profile?.previousTherapy || false,
    previousTherapyDetails: profile?.previousTherapyDetails || "",
    psychiatricHospitalization: profile?.psychiatricHospitalization || false,
    currentTreatment: profile?.currentTreatment || "",
    diagnosedConditions: profile?.diagnosedConditions || [],
    primaryIssue: profile?.primaryIssue || "",
    secondaryIssues: profile?.secondaryIssues || [],
    issueDescription: profile?.issueDescription || "",
    severity: profile?.severity || "",
    duration: profile?.duration || "",
    triggeringSituation: profile?.triggeringSituation || "",
    symptoms: profile?.symptoms || [],
    dailyLifeImpact: profile?.dailyLifeImpact || "",
    sleepQuality: profile?.sleepQuality || "",
    appetiteChanges: profile?.appetiteChanges || "",
    treatmentGoals: profile?.treatmentGoals || [],
    therapyApproach: profile?.therapyApproach || [],
    concernsAboutTherapy: profile?.concernsAboutTherapy || "",
    availability: profile?.availability || [],
    modality: profile?.modality || "",
    location: profile?.location || "",
    sessionFrequency: profile?.sessionFrequency || "",
    notes: profile?.notes || "",
    emergencyContactName: profile?.emergencyContactName || "",
    emergencyContactPhone: profile?.emergencyContactPhone || "",
    emergencyContactRelation: profile?.emergencyContactRelation || "",
    preferredGender: profile?.preferredGender || "",
    preferredAge: profile?.preferredAge || "",
    languagePreference: profile?.languagePreference || "",
    culturalConsiderations: profile?.culturalConsiderations || "",
  });

  const medicalConditions = [
    "Diabetes",
    "Hypertension",
    "Asthma",
    "Heart Disease",
    "Cancer",
    "Thyroid Disorders",
    "Arthritis",
    "Chronic Pain",
    "Migraines",
    "Epilepsy",
    "Other",
  ];

  // Determine if child based on concernedPerson field
  const isChild = formData.concernedPerson?.toLowerCase().includes("enfant") || 
                 formData.concernedPerson?.toLowerCase().includes("child");

  // Diagnostics pour les enfants (liste affichée au client pour son profil médical)
  const childDiagnosedConditions = CHILD_DIAGNOSTICS;

  // Diagnostics pour les adultes (liste affichée au client pour son profil médical)
  const adultDiagnosedConditions = ADULT_DIAGNOSTICS;

  const diagnosedConditions = isChild ? childDiagnosedConditions : adultDiagnosedConditions;

  const secondaryIssues = [
    { key: "anxiety", value: "Anxiety" },
    { key: "depression", value: "Depression" },
    { key: "stress", value: "Stress" },
    { key: "relationshipProblems", value: "Relationship Problems" },
    { key: "trauma", value: "Trauma" },
    { key: "selfEsteemIssues", value: "Self-Esteem Issues" },
    { key: "addiction", value: "Addiction" },
    { key: "grief", value: "Grief" },
    { key: "angerManagement", value: "Anger Management" },
    { key: "familyIssues", value: "Family Issues" },
    { key: "workSchoolProblems", value: "Work/School Problems" },
    { key: "other", value: "Other" },
  ];

  const symptoms = [
    { key: "persistentSadness", value: "Persistent Sadness" },
    { key: "anxietyAttacks", value: "Anxiety Attacks" },
    { key: "sleepProblems", value: "Sleep Problems" },
    { key: "lossOfInterest", value: "Loss of Interest" },
    { key: "irritability", value: "Irritability" },
    { key: "fatigue", value: "Fatigue" },
    { key: "concentrationIssues", value: "Concentration Issues" },
    { key: "appetiteChanges", value: "Appetite Changes" },
    { key: "socialWithdrawal", value: "Social Withdrawal" },
    { key: "panicAttacks", value: "Panic Attacks" },
    { key: "moodSwings", value: "Mood Swings" },
    { key: "suicidalThoughts", value: "Suicidal Thoughts" },
    { key: "hallucinations", value: "Hallucinations" },
    { key: "delusions", value: "Delusions" },
    { key: "other", value: "Other" },
  ];

  const treatmentGoals = [
    "Reduce Anxiety",
    "Improve Mood",
    "Better Sleep",
    "Increase Self-Esteem",
    "Manage Stress",
    "Improve Relationships",
    "Overcome Trauma",
    "Develop Coping Skills",
    "Address Addiction",
    "Weight Management",
    "Other",
  ];

  const therapyApproaches = [
    "Cognitive Behavioral Therapy (CBT)",
    "Psychodynamic Therapy",
    "Humanistic Therapy",
    "Dialectical Behavior Therapy (DBT)",
    "EMDR",
    "Solution-Focused Therapy",
    "Mindfulness-Based Therapy",
    "Family Systems Therapy",
    "Acceptance and Commitment Therapy (ACT)",
    "No Preference",
  ];

  const availabilityOptions = ["morning", "afternoon", "evening", "weekends"];

  const severityOptions = [
    { value: "mild", label: "Mild" },
    { value: "moderate", label: "Moderate" },
    { value: "severe", label: "Severe" },
  ];

  const durationOptions = [
    { value: "lessThanMonth", label: "Less than a month" },
    { value: "oneToThree", label: "1-3 months" },
    { value: "threeToSix", label: "3-6 months" },
    { value: "moreThanSix", label: "More than 6 months" },
  ];

  const sleepQualityOptions = [
    { value: "normal", label: "Normal" },
    { value: "poor", label: "Poor" },
    { value: "insomnia", label: "Insomnia" },
    { value: "excessive", label: "Excessive" },
  ];

  const modalityOptions = [
    { value: "online", label: "Online" },
    { value: "inPerson", label: "In Person" },
    { value: "both", label: "Both" },
  ];

  const sessionFrequencyOptions = [
    { value: "weekly", label: "Weekly" },
    { value: "biweekly", label: "Bi-weekly" },
    { value: "monthly", label: "Monthly" },
  ];

  const preferredGenderOptions = [
    { value: "noPreference", label: "No Preference" },
    { value: "male", label: "Male" },
    { value: "female", label: "Female" },
  ];

  const preferredAgeOptions = [
    { value: "any", label: "Any Age" },
    { value: "younger", label: "Younger (20-35)" },
    { value: "middle", label: "Middle-aged (36-55)" },
    { value: "older", label: "Older (56+)" },
  ];

  const handleMultiSelect = (
    field: keyof MedicalProfileData,
    value: string,
  ) => {
    const currentValues = formData[field] as string[];
    if (currentValues.includes(value)) {
      setFormData((prev) => ({
        ...prev,
        [field]: currentValues.filter((v) => v !== value),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: [...currentValues, value],
      }));
    }
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({
        ...prev,
        [name]: checked,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async (data: MedicalProfileData) => {
    try {
      const newProfile = (await medicalProfileAPI.update(
        data,
      )) as IMedicalProfile;
      setMedicalProfile(newProfile);
    } catch (error) {
      console.error("Error updating profile:", error);
    }
    onClose();
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return true; // Health background is optional
      case 1:
        return true; // Mental health history is optional
      case 2:
        return formData.primaryIssue.trim() !== "";
      case 3:
        return true; // Symptoms optional
      case 4:
        return formData.treatmentGoals.length > 0;
      case 5:
        return formData.availability.length > 0;
      case 6:
        return (
          formData.emergencyContactName.trim() !== "" &&
          formData.emergencyContactPhone.trim() !== ""
        );
      case 7:
        return true; // Matching preferences optional
      default:
        return false;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl m-4">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-serif font-light text-foreground">
              {t("title")}
            </h2>
            <p className="text-sm text-muted-foreground font-light mt-1">
              {t("subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-6 border-b border-border/40">
          <Stepper steps={STEPS} currentStep={currentStep} />
        </div>

        {/* Content */}
        <div className="px-6 py-8">
          {/* Step 1: Health Background */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step1.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step1.subtitle")}
                </p>
              </div>

              <div>
                <Label
                  htmlFor="concernedPerson"
                  className="font-light mb-3 text-base"
                >
                  {t("step1.concernedPerson")}
                </Label>
                <Input
                  id="concernedPerson"
                  name="concernedPerson"
                  value={formData.concernedPerson}
                  onChange={handleChange}
                  placeholder={t("step1.concernedPersonPlaceholder")}
                />
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step1.medicalConditions")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step1.medicalConditionsDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {medicalConditions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() =>
                        handleMultiSelect("medicalConditions", item)
                      }
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.medicalConditions.includes(item)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label
                  htmlFor="currentMedications"
                  className="font-light mb-3 text-base"
                >
                  {t("step1.currentMedications")}
                </Label>
                <Input
                  id="currentMedications"
                  name="currentMedications"
                  value={formData.currentMedications.join(", ")}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      currentMedications: e.target.value
                        .split(", ")
                        .filter(Boolean),
                    }))
                  }
                  placeholder={t("step1.currentMedicationsPlaceholder")}
                />
              </div>

              <div>
                <Label
                  htmlFor="allergies"
                  className="font-light mb-3 text-base"
                >
                  {t("step1.allergies")}
                </Label>
                <Input
                  id="allergies"
                  name="allergies"
                  value={formData.allergies.join(", ")}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      allergies: e.target.value.split(", ").filter(Boolean),
                    }))
                  }
                  placeholder={t("step1.allergiesPlaceholder")}
                />
              </div>

              <div>
                <Label
                  htmlFor="substanceUse"
                  className="font-light mb-3 text-base"
                >
                  {t("step1.substanceUse")}
                </Label>
                <Input
                  id="substanceUse"
                  name="substanceUse"
                  value={formData.substanceUse}
                  onChange={handleChange}
                  placeholder={t("step1.substanceUsePlaceholder")}
                />
              </div>
            </div>
          )}

          {/* Step 2: Mental Health History */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step2.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step2.subtitle")}
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step2.previousTherapy")}
                  </Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="previousTherapy"
                        value="true"
                        checked={formData.previousTherapy === true}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            previousTherapy: true,
                          }))
                        }
                      />
                      <span className="text-sm font-light">Yes</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="previousTherapy"
                        value="false"
                        checked={formData.previousTherapy === false}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            previousTherapy: false,
                          }))
                        }
                      />
                      <span className="text-sm font-light">No</span>
                    </label>
                  </div>
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step2.psychiatricHospitalization")}
                  </Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="psychiatricHospitalization"
                        value="true"
                        checked={formData.psychiatricHospitalization === true}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            psychiatricHospitalization: true,
                          }))
                        }
                      />
                      <span className="text-sm font-light">Yes</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="psychiatricHospitalization"
                        value="false"
                        checked={formData.psychiatricHospitalization === false}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            psychiatricHospitalization: false,
                          }))
                        }
                      />
                      <span className="text-sm font-light">No</span>
                    </label>
                  </div>
                </div>
              </div>

              {formData.previousTherapy && (
                <div>
                  <Label
                    htmlFor="previousTherapyDetails"
                    className="font-light mb-3 text-base"
                  >
                    {t("step2.previousTherapyDetails")}
                  </Label>
                  <textarea
                    id="previousTherapyDetails"
                    name="previousTherapyDetails"
                    value={formData.previousTherapyDetails}
                    onChange={handleChange}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                    placeholder={t("step2.previousTherapyDetailsPlaceholder")}
                  />
                </div>
              )}

              <div>
                <Label
                  htmlFor="currentTreatment"
                  className="font-light mb-3 text-base"
                >
                  {t("step2.currentTreatment")}
                </Label>
                <Input
                  id="currentTreatment"
                  name="currentTreatment"
                  value={formData.currentTreatment}
                  onChange={handleChange}
                  placeholder={t("step2.currentTreatmentPlaceholder")}
                />
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step2.diagnosedConditions")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step2.diagnosedConditionsDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {diagnosedConditions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() =>
                        handleMultiSelect("diagnosedConditions", item)
                      }
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.diagnosedConditions.includes(item)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {translateFromMap(item, diagnosticsMap, locale)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Current Concerns */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step3.title")}
                  <span className="text-primary ml-1">
                    {t("step3.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step3.subtitle")}
                </p>
              </div>

              <div>
                <Label
                  htmlFor="primaryIssue"
                  className="font-light mb-3 text-base"
                >
                  {t("step3.primaryIssue")}
                  <span className="text-primary ml-1">*</span>
                </Label>
                <Input
                  id="primaryIssue"
                  name="primaryIssue"
                  value={formData.primaryIssue}
                  onChange={handleChange}
                  placeholder={t("step3.primaryIssuePlaceholder")}
                />
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step3.secondaryIssues")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step3.secondaryIssuesDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {secondaryIssues.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() =>
                        handleMultiSelect("secondaryIssues", item.value)
                      }
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.secondaryIssues.includes(item.value)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {t(`step3.secondaryIssueOptions.${item.key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label
                  htmlFor="issueDescription"
                  className="font-light mb-3 text-base"
                >
                  {t("step3.issueDescription")}
                </Label>
                <textarea
                  id="issueDescription"
                  name="issueDescription"
                  value={formData.issueDescription}
                  onChange={handleChange}
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                  placeholder={t("step3.issueDescriptionPlaceholder")}
                />
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <div className="flex flex-col">
                  <Label className="mb-3 block text-left text-base font-light">
                    {t("step3.severity")}
                  </Label>
                  <select
                    name="severity"
                    value={formData.severity}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{t("step3.severityPlaceholder")}</option>
                    {severityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col">
                  <Label className="mb-3 block text-left text-base font-light">
                    {t("step3.duration")}
                  </Label>
                  <select
                    name="duration"
                    value={formData.duration}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{t("step3.durationPlaceholder")}</option>
                    {durationOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col">
                  <Label
                    htmlFor="triggeringSituation"
                    className="mb-3 block text-left text-base font-light"
                  >
                    {t("step3.triggeringSituation")}
                  </Label>
                  <Input
                    id="triggeringSituation"
                    name="triggeringSituation"
                    value={formData.triggeringSituation}
                    onChange={handleChange}
                    placeholder={t("step3.triggeringSituationPlaceholder")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Symptoms & Impact */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step4.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step4.subtitle")}
                </p>
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step4.symptoms")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step4.symptomsDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {symptoms.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleMultiSelect("symptoms", item.value)}
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.symptoms.includes(item.value)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {t(`step4.symptomOptions.${item.key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label
                  htmlFor="dailyLifeImpact"
                  className="font-light mb-3 text-base"
                >
                  {t("step4.dailyLifeImpact")}
                </Label>
                <textarea
                  id="dailyLifeImpact"
                  name="dailyLifeImpact"
                  value={formData.dailyLifeImpact}
                  onChange={handleChange}
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                  placeholder={t("step4.dailyLifeImpactPlaceholder")}
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step4.sleepQuality")}
                  </Label>
                  <select
                    name="sleepQuality"
                    value={formData.sleepQuality}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {t("step4.sleepQualityPlaceholder")}
                    </option>
                    {sleepQualityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label
                    htmlFor="appetiteChanges"
                    className="font-light mb-3 text-base"
                  >
                    {t("step4.appetiteChanges")}
                  </Label>
                  <Input
                    id="appetiteChanges"
                    name="appetiteChanges"
                    value={formData.appetiteChanges}
                    onChange={handleChange}
                    placeholder={t("step4.appetiteChangesPlaceholder")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Goals & Preferences */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step5.title")}
                  <span className="text-primary ml-1">
                    {t("step5.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step5.subtitle")}
                </p>
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step5.treatmentGoals")}
                  <span className="text-primary ml-1">*</span>
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step5.treatmentGoalsDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {treatmentGoals.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleMultiSelect("treatmentGoals", item)}
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.treatmentGoals.includes(item)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step5.therapyApproach")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step5.therapyApproachDesc")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {therapyApproaches.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleMultiSelect("therapyApproach", item)}
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.therapyApproach.includes(item)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label
                  htmlFor="concernsAboutTherapy"
                  className="font-light mb-3 text-base"
                >
                  {t("step5.concernsAboutTherapy")}
                </Label>
                <textarea
                  id="concernsAboutTherapy"
                  name="concernsAboutTherapy"
                  value={formData.concernsAboutTherapy}
                  onChange={handleChange}
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                  placeholder={t("step5.concernsAboutTherapyPlaceholder")}
                />
              </div>
            </div>
          )}

          {/* Step 6: Appointment Preferences */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step6.title")}
                  <span className="text-primary ml-1">
                    {t("step6.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step6.subtitle")}
                </p>
              </div>

              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step6.availability")}
                  <span className="text-primary ml-1">*</span>
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step6.availabilityDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {availabilityOptions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleMultiSelect("availability", item)}
                      className={`rounded-lg px-4 py-3 text-sm font-light text-center transition-all ${
                        formData.availability.includes(item)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {t(`preferences.${item}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step6.modality")}
                  </Label>
                  <select
                    name="modality"
                    value={formData.modality}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{t("step6.modalityPlaceholder")}</option>
                    {modalityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step6.sessionFrequency")}
                  </Label>
                  <select
                    name="sessionFrequency"
                    value={formData.sessionFrequency}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {t("step6.sessionFrequencyPlaceholder")}
                    </option>
                    {sessionFrequencyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label
                    htmlFor="location"
                    className="font-light mb-3 text-base"
                  >
                    {t("step6.location")}
                  </Label>
                  <Input
                    id="location"
                    name="location"
                    value={formData.location}
                    onChange={handleChange}
                    placeholder={t("step6.locationPlaceholder")}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="notes" className="font-light mb-3 text-base">
                  {t("step6.notes")}
                </Label>
                <textarea
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                  placeholder={t("step6.notesPlaceholder")}
                />
              </div>
            </div>
          )}

          {/* Step 7: Emergency Information */}
          {currentStep === 6 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step7.title")}
                  <span className="text-primary ml-1">
                    {t("step7.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step7.subtitle")}
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <Label
                    htmlFor="emergencyContactName"
                    className="font-light mb-3 text-base"
                  >
                    {t("step7.emergencyContactName")}
                    <span className="text-primary ml-1">*</span>
                  </Label>
                  <Input
                    id="emergencyContactName"
                    name="emergencyContactName"
                    value={formData.emergencyContactName}
                    onChange={handleChange}
                    placeholder={t("step7.emergencyContactNamePlaceholder")}
                  />
                </div>

                <div>
                  <Label
                    htmlFor="emergencyContactPhone"
                    className="font-light mb-3 text-base"
                  >
                    {t("step7.emergencyContactPhone")}
                    <span className="text-primary ml-1">*</span>
                  </Label>
                  <Input
                    id="emergencyContactPhone"
                    name="emergencyContactPhone"
                    value={formData.emergencyContactPhone}
                    onChange={handleChange}
                    placeholder={t("step7.emergencyContactPhonePlaceholder")}
                  />
                </div>

                <div>
                  <Label
                    htmlFor="emergencyContactRelation"
                    className="font-light mb-3 text-base"
                  >
                    {t("step7.emergencyContactRelation")}
                  </Label>
                  <Input
                    id="emergencyContactRelation"
                    name="emergencyContactRelation"
                    value={formData.emergencyContactRelation}
                    onChange={handleChange}
                    placeholder={t("step7.emergencyContactRelationPlaceholder")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 8: Matching Preferences */}
          {currentStep === 7 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step8.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step8.subtitle")}
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step8.preferredGender")}
                  </Label>
                  <select
                    name="preferredGender"
                    value={formData.preferredGender}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {t("step8.preferredGenderPlaceholder")}
                    </option>
                    {preferredGenderOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {t("step8.preferredAge")}
                  </Label>
                  <select
                    name="preferredAge"
                    value={formData.preferredAge}
                    onChange={handleChange}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {t("step8.preferredAgePlaceholder")}
                    </option>
                    {preferredAgeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label
                  htmlFor="languagePreference"
                  className="font-light mb-3 text-base"
                >
                  {t("step8.languagePreference")}
                </Label>
                <Input
                  id="languagePreference"
                  name="languagePreference"
                  value={formData.languagePreference}
                  onChange={handleChange}
                  placeholder={t("step8.languagePreferencePlaceholder")}
                />
              </div>

              <div>
                <Label
                  htmlFor="culturalConsiderations"
                  className="font-light mb-3 text-base"
                >
                  {t("step8.culturalConsiderations")}
                </Label>
                <textarea
                  id="culturalConsiderations"
                  name="culturalConsiderations"
                  value={formData.culturalConsiderations}
                  onChange={handleChange}
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                  placeholder={t("step8.culturalConsiderationsPlaceholder")}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 0}
            className="px-6 py-3 text-foreground font-light transition-opacity disabled:opacity-0 disabled:pointer-events-none hover:text-muted-foreground"
          >
            {t("buttons.back")}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-foreground font-light transition-colors hover:text-muted-foreground"
            >
              {t("buttons.saveForLater")}
            </button>
            {currentStep < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!canProceed()}
                className="px-8 py-3 bg-primary text-primary-foreground rounded-full font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {t("buttons.next")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(formData)}
                disabled={!canProceed()}
                className="px-8 py-3 bg-primary text-primary-foreground rounded-full font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {t("buttons.complete")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
