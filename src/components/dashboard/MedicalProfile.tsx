"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Edit, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IMedicalProfile } from "@/models/MedicalProfile";
import { medicalProfileAPI } from "@/lib/api-client";
import { CHILD_DIAGNOSTICS } from "@/data/childDiagnostics";
import { ADULT_DIAGNOSTICS } from "@/data/adultDiagnostics";
import { ClinicalAvailabilityGrid } from "@/components/ui/ClinicalAvailabilityGrid";
import { migrateLegacyAvailabilitySlots } from "@/config/clinical-availability-grid";

interface MedicalProfileProps {
  profile?: IMedicalProfile;
  userId?: string;
  setProfile?: (profile: IMedicalProfile) => void;
  isEditable?: boolean;
  onSaveOverride?: (data: IMedicalProfile) => Promise<IMedicalProfile | null>;
}

export default function MedicalProfile({
  profile,
  userId,
  setProfile,
  isEditable = false,
  onSaveOverride,
}: MedicalProfileProps) {
  const t = useTranslations("Client.profile");
  const tMp = useTranslations("Client.profileModal");
  const tMv = useTranslations("Client.medicalProfile");
  const [medicalProfile, setMedicalProfile] = useState<IMedicalProfile | null>(
    profile || null,
  );
  const [isLoading, setIsLoading] = useState(!profile);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("health-background");

  const updateProfile = useCallback(
    (updatedProfile: IMedicalProfile) => {
      setMedicalProfile(updatedProfile);
      if (setProfile) setProfile(updatedProfile);
    },
    [setProfile],
  );

  const fetchProfile = useCallback(async () => {
    if (profile) return;

    try {
      setIsLoading(true);
      const response = userId
        ? await medicalProfileAPI.getByUserId(userId)
        : await medicalProfileAPI.get();
      setMedicalProfile(response as IMedicalProfile);
      if (setProfile) setProfile(response as IMedicalProfile);
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, profile, setProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">{tMv("loading")}</p>
        </div>
      </div>
    );
  }

  if (!medicalProfile) {
    return (
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">{tMv("noData")}</p>
        </div>
      </div>
    );
  }

  const secondaryIssueKeyByValue: Record<string, string> = {
    Anxiety: "anxiety",
    Depression: "depression",
    Stress: "stress",
    "Relationship Problems": "relationshipProblems",
    Trauma: "trauma",
    "Self-Esteem Issues": "selfEsteemIssues",
    Addiction: "addiction",
    Grief: "grief",
    "Anger Management": "angerManagement",
    "Family Issues": "familyIssues",
    "Work/School Problems": "workSchoolProblems",
    Other: "other",
    Relationships: "relationshipProblems",
    Family: "familyIssues",
    "Work/School": "workSchoolProblems",
    "Life transitions": "lifeTransitions",
    "Self-esteem": "selfEsteemIssues",
  };

  const symptomKeyByValue: Record<string, string> = {
    Sadness: "sadness",
    Worry: "worry",
    "Panic attacks": "panicAttacks",
    "Mood swings": "moodSwings",
    Irritability: "irritability",
    Fatigue: "fatigue",
    "Concentration issues": "concentrationIssues",
    "Memory problems": "memoryProblems",
    Nightmares: "nightmares",
    Flashbacks: "flashbacks",
    "Persistent Sadness": "persistentSadness",
    "Anxiety Attacks": "anxietyAttacks",
    "Sleep Problems": "sleepProblems",
    "Loss of Interest": "lossOfInterest",
    "Concentration Issues": "concentrationIssues",
    "Appetite Changes": "appetiteChanges",
    "Social Withdrawal": "socialWithdrawal",
    "Panic Attacks": "panicAttacks",
    "Suicidal Thoughts": "suicidalThoughts",
    Hallucinations: "hallucinations",
    Delusions: "delusions",
    Other: "other",
  };

  const normalizeCondition = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const diagnosedConditionKeyByValue: Record<string, string> = {
    "tdah": "tdah",
    "trouble du langage": "troubleLangage",
    "dyslexie": "dyslexie",
    "syndrome de la tourette": "syndromeTourette",
    "syndrome de la tourette sgt": "syndromeTourette",
    "tics": "tics",
    "trouble du spectre de lautisme tsa": "tsa",
    "douance": "douance",
    "trouble danxiete de separation": "anxieteSeparation",
    "trouble de lanxiete de separation": "anxieteSeparation",
  };

  const translateSecondaryIssue = (value: string): string => {
    const key = secondaryIssueKeyByValue[value];
    return key ? tMp(`step3.secondaryIssueOptions.${key}`) : value;
  };

  const translateSymptom = (value: string): string => {
    const key = symptomKeyByValue[value];
    return key ? tMp(`step4.symptomOptions.${key}`) : value;
  };

  const translateDiagnosedCondition = (value: string): string => {
    const normalized = normalizeCondition(value);
    let key = diagnosedConditionKeyByValue[normalized];

    // Fallback matching for noisy persisted values
    if (!key) {
      if (normalized.includes("tdah")) key = "tdah";
      else if (normalized.includes("trouble du langage")) key = "troubleLangage";
      else if (normalized.includes("dyslexie")) key = "dyslexie";
      else if (
        normalized.includes("syndrome de la tourette") ||
        normalized.includes("tourette")
      )
        key = "syndromeTourette";
      else if (normalized === "tics" || normalized.includes(" tics ")) key = "tics";
      else if (
        normalized.includes("spectre de lautisme") ||
        normalized.includes("autisme tsa") ||
        normalized.includes("tsa")
      )
        key = "tsa";
      else if (normalized.includes("douance")) key = "douance";
      else if (
        normalized.includes("anxiete de separation") ||
        normalized.includes("anxiete separation")
      )
        key = "anxieteSeparation";
    }

    return key ? tMp(`step2.conditionLabels.${key}`) : value;
  };

  const treatmentGoalKeyByValue: Record<string, string> = {
    "Reduce Anxiety": "reduceAnxiety",
    "Improve Mood": "improveMood",
    "Better Sleep": "betterSleep",
    "Increase Self-Esteem": "increaseSelfEsteem",
    "Manage Stress": "manageStress",
    "Improve Relationships": "improveRelationships",
    "Overcome Trauma": "overcomeTrauma",
    "Develop Coping Skills": "developCopingSkills",
    "Address Addiction": "addressAddiction",
    "Weight Management": "weightManagement",
    Other: "other",
    "Reduce symptoms": "reduceSymptoms",
    "Self-understanding": "selfUnderstanding",
    "Personal growth": "personalGrowth",
  };

  const translateTreatmentGoal = (value: string): string => {
    const key = treatmentGoalKeyByValue[value];
    return key ? tMp(`step5.treatmentGoalOptions.${key}`) : value;
  };

  const therapyApproachKeyByValue: Record<string, string> = {
    "Cognitive Behavioral Therapy (CBT)": "cbt",
    "Psychodynamic Therapy": "psychodynamicTherapy",
    Psychodynamic: "psychodynamic",
    "Humanistic Therapy": "humanisticTherapy",
    "Dialectical Behavior Therapy (DBT)": "dbt",
    EMDR: "emdr",
    "Solution-Focused Therapy": "solutionFocusedTherapy",
    "Solution-focused": "solutionFocused",
    "Mindfulness-Based Therapy": "mindfulnessBasedTherapy",
    "Family Systems Therapy": "familySystemsTherapy",
    "Acceptance and Commitment Therapy (ACT)": "act",
    "Group therapy": "groupTherapy",
    "No Preference": "noPreference",
  };

  const translateTherapyApproach = (value: string): string => {
    const key = therapyApproachKeyByValue[value];
    return key ? tMp(`step5.therapyApproachOptions.${key}`) : value;
  };

  return (
    <>
      {/* Health Background */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMp("steps.healthBackground")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("health-background");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{tMp("step1.medicalConditions")}</Label>
            {medicalProfile.medicalConditions &&
            medicalProfile.medicalConditions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.medicalConditions.map((condition, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 rounded-full text-sm font-light"
                  >
                    {translateDiagnosedCondition(condition)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tMv("empty.noneReported")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tMp("step1.currentMedications")}</Label>
            {medicalProfile.currentMedications &&
            medicalProfile.currentMedications.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.currentMedications.map((medication, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300 rounded-full text-sm font-light"
                  >
                    {medication}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tMv("empty.noneReported")}
              </p>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tMp("step1.allergies")}</Label>
              {medicalProfile.allergies &&
              medicalProfile.allergies.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {medicalProfile.allergies.map((allergy, index) => (
                    <span
                      key={index}
                      className="px-3 py-1.5 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-full text-sm font-light"
                    >
                      {allergy}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {tMv("empty.noneReported")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{tMp("step1.substanceUse")}</Label>
              <p className="text-foreground">
                {medicalProfile.substanceUse || tMv("empty.notReported")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Mental Health History */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMp("steps.mentalHealthHistory")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("mental-health-history");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tMp("step2.previousTherapy")}</Label>
              <p className="text-foreground">
                {medicalProfile.previousTherapy ? t("yes") : t("no")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMp("step2.psychiatricHospitalization")}</Label>
              <p className="text-foreground">
                {medicalProfile.psychiatricHospitalization ? t("yes") : t("no")}
              </p>
            </div>
          </div>

          {medicalProfile.previousTherapy && (
            <div className="space-y-2">
              <Label>{tMp("step2.previousTherapyDetails")}</Label>
              <p className="text-foreground leading-relaxed">
                {medicalProfile.previousTherapyDetails ||
                  tMv("empty.noDetailsProvided")}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>{tMp("step2.diagnosedConditions")}</Label>
            {medicalProfile.diagnosedConditions &&
            medicalProfile.diagnosedConditions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.diagnosedConditions.map((condition, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 rounded-full text-sm font-light"
                  >
                    {condition}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tMv("empty.noneReported")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tMp("step2.currentTreatment")}</Label>
            <p className="text-foreground leading-relaxed">
              {medicalProfile.currentTreatment ||
                tMv("empty.noCurrentTreatment")}
            </p>
          </div>
        </div>
      </section>

      {/* Current Concerns */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMp("steps.currentConcerns")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("current-concerns");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{tMp("step3.primaryIssue")}</Label>
            <p className="text-foreground">
              {medicalProfile.primaryIssue || tMv("empty.notSpecified")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{tMp("step3.secondaryIssues")}</Label>
            {medicalProfile.secondaryIssues &&
            medicalProfile.secondaryIssues.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.secondaryIssues.map((issue, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 rounded-full text-sm font-light"
                  >
                    {translateSecondaryIssue(issue)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tMv("empty.noneReported")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tMp("step3.issueDescription")}</Label>
            <p className="text-foreground leading-relaxed">
              {medicalProfile.issueDescription ||
                tMv("empty.noDescriptionProvided")}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{tMp("step3.severity")}</Label>
              <p className="text-foreground capitalize">
                {medicalProfile.severity || tMv("empty.notSpecified")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMp("step3.duration")}</Label>
              <p className="text-foreground">
                {medicalProfile.duration
                  ? t(`issueDetails.${medicalProfile.duration}`)
                  : tMv("empty.notSpecified")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMv("labels.triggeringEvent")}</Label>
              <p className="text-foreground">
                {medicalProfile.triggeringSituation ||
                  tMv("empty.notReported")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Symptoms & Impact */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMv("sections.symptomsDailyLife")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("symptoms-impact");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{tMp("step4.symptoms")}</Label>
            {medicalProfile.symptoms && medicalProfile.symptoms.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.symptoms.map((symptom, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-300 rounded-full text-sm font-light"
                  >
                    {translateSymptom(symptom)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tMv("empty.noneReported")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tMp("step4.dailyLifeImpact")}</Label>
            <p className="text-foreground leading-relaxed">
              {medicalProfile.dailyLifeImpact || tMv("empty.notSpecified")}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tMp("step4.sleepQuality")}</Label>
              <p className="text-foreground capitalize">
                {medicalProfile.sleepQuality
                  ? tMp(`step4.sleepQualityOptions.${medicalProfile.sleepQuality}`)
                  : tMv("empty.normalSleep")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMp("step4.appetiteChanges")}</Label>
              <p className="text-foreground">
                {medicalProfile.appetiteChanges ||
                  tMv("empty.noChangesReported")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Goals & Treatment Preferences */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMv("sections.treatmentGoalsPrefs")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("goals-preferences");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>{tMp("step5.treatmentGoals")}</Label>
            {medicalProfile.treatmentGoals &&
            medicalProfile.treatmentGoals.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.treatmentGoals.map((goal, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 rounded-full text-sm font-light"
                  >
                    {translateTreatmentGoal(goal)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tMv("empty.notSpecified")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tMp("step5.therapyApproach")}</Label>
            {medicalProfile.therapyApproach &&
            medicalProfile.therapyApproach.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {medicalProfile.therapyApproach.map((approach, index) => (
                  <span
                    key={index}
                    className="px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm font-light"
                  >
                    {translateTherapyApproach(approach)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("noPreference")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tMp("step5.concernsAboutTherapy")}</Label>
            <p className="text-foreground leading-relaxed">
              {medicalProfile.concernsAboutTherapy ||
                tMv("empty.noConcernsReported")}
            </p>
          </div>
        </div>
      </section>

      {/* Appointment Preferences */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMp("step6.title")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("appointment-preferences");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tMv("labels.preferredTimeSlots")}</Label>
              <div className="flex flex-wrap gap-2">
                {medicalProfile.availability &&
                medicalProfile.availability.length > 0 ? (
                  medicalProfile.availability.map((time) => (
                    <span
                      key={time}
                      className="rounded-full px-4 py-2 text-sm font-medium bg-primary/10 text-primary"
                    >
                      {t(`preferences.${time}`)}
                    </span>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("noPreference")}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tMp("step6.sessionFrequency")}</Label>
              <p className="text-foreground capitalize">
                {medicalProfile.sessionFrequency
                  ? tMp(
                      `step6.sessionFrequencyOptions.${medicalProfile.sessionFrequency}`,
                    )
                  : tMv("empty.notSpecified")}
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tMv("labels.sessionModality")}</Label>
              <p className="text-foreground">
                {medicalProfile.modality
                  ? t(`preferences.${medicalProfile.modality}`)
                  : tMv("empty.notSpecified")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMp("step6.location")}</Label>
              <p className="text-foreground">
                {medicalProfile.location || tMv("empty.notSpecified")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{tMp("step6.notes")}</Label>
            <p className="text-foreground leading-relaxed">
              {medicalProfile.notes || tMv("empty.noAdditionalNotes")}
            </p>
          </div>
        </div>
      </section>

      {/* Emergency Information */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMv("labels.emergencyContactTitle")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("emergency-info");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground font-light mb-6">
          {tMv("labels.emergencyConfidential")}
        </p>
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{tMv("labels.contactName")}</Label>
              <p className="text-foreground">
                {medicalProfile.emergencyContactName ||
                  tMv("empty.notProvided")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMv("labels.phoneNumber")}</Label>
              <p className="text-foreground">
                {medicalProfile.emergencyContactPhone ||
                  tMv("empty.notProvided")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMv("labels.relationship")}</Label>
              <p className="text-foreground">
                {medicalProfile.emergencyContactRelation ||
                  tMv("empty.notSpecified")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Matching Preferences */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {tMv("labels.matchingPrefsTitle")}
          </h2>
          {isEditable && (
            <button
              onClick={() => {
                setActiveTab("matching-preferences");
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Edit className="h-4 w-4" />
              {t("edit")}
            </button>
          )}
        </div>
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tMp("step8.preferredGender")}</Label>
              <p className="text-foreground capitalize">
                {medicalProfile.preferredGender === "noPreference"
                  ? t("noPreference")
                  : medicalProfile.preferredGender || tMv("empty.notSpecified")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{tMv("labels.preferredAgeRange")}</Label>
              <p className="text-foreground">
                {medicalProfile.preferredAge === "any"
                  ? tMv("labels.anyAge")
                  : medicalProfile.preferredAge === "younger"
                    ? tMv("labels.ageYounger")
                    : medicalProfile.preferredAge === "middle"
                      ? tMv("labels.ageMiddle")
                      : medicalProfile.preferredAge === "older"
                        ? tMv("labels.ageOlder")
                        : tMv("empty.notSpecified")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{tMp("step8.languagePreference")}</Label>
            <p className="text-foreground">
              {medicalProfile.languagePreference || tMv("empty.notSpecified")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{tMp("step8.culturalConsiderations")}</Label>
            <p className="text-foreground leading-relaxed">
              {medicalProfile.culturalConsiderations ||
                tMv("empty.notSpecified")}
            </p>
          </div>
        </div>
      </section>

      <MedicalProfileModal
        isOpen={isEditable && isModalOpen}
        onClose={() => setIsModalOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        profile={medicalProfile}
        setMedicalProfile={updateProfile}
        onSaveOverride={onSaveOverride}
      />
    </>
  );
}

interface MedicalProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  profile?: IMedicalProfile;
  setMedicalProfile: (profile: IMedicalProfile) => void;
  onSaveOverride?: (data: IMedicalProfile) => Promise<IMedicalProfile | null>;
}

function MedicalProfileModal({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  profile,
  setMedicalProfile,
  onSaveOverride,
}: MedicalProfileModalProps) {
  const tMp = useTranslations("Client.profileModal");
  const tProfile = useTranslations("Client.profile");
  const tMv = useTranslations("Client.medicalProfile");

  const normalizeCondition = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const diagnosedConditionKeyByValue: Record<string, string> = {
    "tdah": "tdah",
    "trouble du langage": "troubleLangage",
    "dyslexie": "dyslexie",
    "syndrome de la tourette": "syndromeTourette",
    "syndrome de la tourette sgt": "syndromeTourette",
    "tics": "tics",
    "trouble du spectre de lautisme tsa": "tsa",
    "douance": "douance",
    "trouble danxiete de separation": "anxieteSeparation",
    "trouble de lanxiete de separation": "anxieteSeparation",
  };

  const translateDiagnosedCondition = (value: string): string => {
    const normalized = normalizeCondition(value);
    let key = diagnosedConditionKeyByValue[normalized];

    // Fallback matching for noisy persisted values
    if (!key) {
      if (normalized.includes("tdah")) key = "tdah";
      else if (normalized.includes("trouble du langage")) key = "troubleLangage";
      else if (normalized.includes("dyslexie")) key = "dyslexie";
      else if (
        normalized.includes("syndrome de la tourette") ||
        normalized.includes("tourette")
      )
        key = "syndromeTourette";
      else if (normalized === "tics" || normalized.includes(" tics ")) key = "tics";
      else if (
        normalized.includes("spectre de lautisme") ||
        normalized.includes("autisme tsa") ||
        normalized.includes("tsa")
      )
        key = "tsa";
      else if (normalized.includes("douance")) key = "douance";
      else if (
        normalized.includes("anxiete de separation") ||
        normalized.includes("anxiete separation")
      )
        key = "anxieteSeparation";
    }

    return key ? tMp(`step2.conditionLabels.${key}`) : value;
  };

  const treatmentGoalsOptions = [
    { key: "reduceAnxiety", value: "Reduce Anxiety" },
    { key: "improveMood", value: "Improve Mood" },
    { key: "betterSleep", value: "Better Sleep" },
    { key: "increaseSelfEsteem", value: "Increase Self-Esteem" },
    { key: "manageStress", value: "Manage Stress" },
    { key: "improveRelationships", value: "Improve Relationships" },
    { key: "overcomeTrauma", value: "Overcome Trauma" },
    { key: "developCopingSkills", value: "Develop Coping Skills" },
    { key: "addressAddiction", value: "Address Addiction" },
    { key: "weightManagement", value: "Weight Management" },
    { key: "other", value: "Other" },
  ];

  const therapyApproachOptions = [
    { key: "cbt", value: "Cognitive Behavioral Therapy (CBT)" },
    { key: "psychodynamicTherapy", value: "Psychodynamic Therapy" },
    { key: "humanisticTherapy", value: "Humanistic Therapy" },
    { key: "dbt", value: "Dialectical Behavior Therapy (DBT)" },
    { key: "emdr", value: "EMDR" },
    { key: "solutionFocusedTherapy", value: "Solution-Focused Therapy" },
    { key: "mindfulnessBasedTherapy", value: "Mindfulness-Based Therapy" },
    { key: "familySystemsTherapy", value: "Family Systems Therapy" },
    { key: "act", value: "Acceptance and Commitment Therapy (ACT)" },
    { key: "noPreference", value: "No Preference" },
  ];

  const medicalConditionOptions = [
    { key: "diabetes", value: "Diabetes" },
    { key: "hypertension", value: "Hypertension" },
    { key: "asthma", value: "Asthma" },
    { key: "heartDisease", value: "Heart Disease" },
    { key: "cancer", value: "Cancer" },
    { key: "thyroidDisorders", value: "Thyroid Disorders" },
    { key: "arthritis", value: "Arthritis" },
    { key: "chronicPain", value: "Chronic Pain" },
    { key: "migraines", value: "Migraines" },
    { key: "epilepsy", value: "Epilepsy" },
    { key: "other", value: "Other" },
  ];

  // State for each tab's form data, initialized with profile data
  const [healthBackgroundData, setHealthBackgroundData] = useState({
    concernedPerson: profile?.concernedPerson || "",
    medicalConditions: profile?.medicalConditions || [],
    currentMedications: profile?.currentMedications || [],
    allergies: profile?.allergies || [],
    substanceUse: profile?.substanceUse || "",
  });

  const [mentalHealthHistoryData, setMentalHealthHistoryData] = useState({
    previousTherapy: profile?.previousTherapy || false,
    previousTherapyDetails: profile?.previousTherapyDetails || "",
    psychiatricHospitalization: profile?.psychiatricHospitalization || false,
    diagnosedConditions: profile?.diagnosedConditions || [],
    currentTreatment: profile?.currentTreatment || "",
  });

  const [currentConcernsData, setCurrentConcernsData] = useState({
    primaryIssue: profile?.primaryIssue || "",
    secondaryIssues: profile?.secondaryIssues || [],
    issueDescription: profile?.issueDescription || "",
    severity: profile?.severity || "",
    duration: profile?.duration || "",
    triggeringSituation: profile?.triggeringSituation || "",
  });

  const [symptomsImpactData, setSymptomsImpactData] = useState({
    symptoms: profile?.symptoms || [],
    dailyLifeImpact: profile?.dailyLifeImpact || "",
    sleepQuality: profile?.sleepQuality || "",
    appetiteChanges: profile?.appetiteChanges || "",
  });

  const [goalsPreferencesData, setGoalsPreferencesData] = useState({
    treatmentGoals: profile?.treatmentGoals || [],
    therapyApproach: profile?.therapyApproach || [],
    concernsAboutTherapy: profile?.concernsAboutTherapy || "",
  });

  const [appointmentPreferencesData, setAppointmentPreferencesData] = useState<{
    availability: string[];
    sessionFrequency: string;
    modality: string;
    location: string;
    notes: string;
  }>({
    availability: migrateLegacyAvailabilitySlots(profile?.availability || []),
    sessionFrequency: profile?.sessionFrequency || "",
    modality: profile?.modality || "",
    location: profile?.location || "",
    notes: profile?.notes || "",
  });

  const [emergencyInfoData, setEmergencyInfoData] = useState({
    emergencyContactName: profile?.emergencyContactName || "",
    emergencyContactPhone: profile?.emergencyContactPhone || "",
    emergencyContactRelation: profile?.emergencyContactRelation || "",
  });

  const [matchingPreferencesData, setMatchingPreferencesData] = useState({
    preferredGender: profile?.preferredGender || "",
    preferredAge: profile?.preferredAge || "",
    languagePreference: profile?.languagePreference || "",
    culturalConsiderations: profile?.culturalConsiderations || "",
  });

  const handleSave = async () => {
    if (!appointmentPreferencesData.availability?.length) {
      alert(tMp("step6.availabilityRequired"));
      return;
    }
    // Collect all data
    const updatedProfile = {
      ...profile,
      ...healthBackgroundData,
      ...mentalHealthHistoryData,
      ...currentConcernsData,
      ...symptomsImpactData,
      ...goalsPreferencesData,
      ...appointmentPreferencesData,
      ...emergencyInfoData,
      ...matchingPreferencesData,
    };
    try {
      let newProfile;
      if (onSaveOverride) {
        newProfile = await onSaveOverride(updatedProfile as unknown as IMedicalProfile);
        // Sometimes the override might just be doing side effects and returning void
        if (newProfile) {
          setMedicalProfile(newProfile);
        } else {
          setMedicalProfile(updatedProfile as unknown as IMedicalProfile);
        }
      } else {
        newProfile = await medicalProfileAPI.update(updatedProfile);
        setMedicalProfile(newProfile as IMedicalProfile);
      }
      onClose();
    } catch (error) {
      console.error("Error updating profile:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-[95vw] h-[80vh] overflow-y-auto bg-background rounded-2xl shadow-2xl m-4">
        <div className="sticky top-0 z-10 bg-background border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-serif font-light text-foreground">
              {tMp("title")}
            </h2>
            <p className="text-sm text-muted-foreground font-light mt-1">
              {tMp("subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-6 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-4 lg:grid-cols-8">
              {[
                { value: "health-background", label: tMp("steps.healthBackground") },
                { value: "mental-health-history", label: tMp("steps.mentalHealthHistory") },
                { value: "current-concerns", label: tMp("steps.currentConcerns") },
                { value: "symptoms-impact", label: tMp("steps.symptomsImpact") },
                { value: "goals-preferences", label: tMp("steps.goalsPreferences") },
                { value: "appointment-preferences", label: tMp("steps.appointmentPreferences") },
                { value: "emergency-info", label: tMp("steps.emergencyInfo") },
                { value: "matching-preferences", label: tMp("steps.matchingPreferences") },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="h-auto whitespace-normal rounded-md border border-border/40 bg-card px-3 py-2 text-center text-xs font-medium leading-snug text-foreground shadow-none transition-colors hover:bg-muted/40 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none dark:bg-card dark:text-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground md:text-sm"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="health-background">
              {/* Health Background Form */}
              <div className="space-y-6">
                <div>
                  <Label
                    htmlFor="concernedPerson"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step1.concernedPerson")}
                  </Label>
                  <Input
                    id="concernedPerson"
                    name="concernedPerson"
                    value={healthBackgroundData.concernedPerson}
                    onChange={(e) =>
                      setHealthBackgroundData((prev) => ({
                        ...prev,
                        concernedPerson: e.target.value,
                      }))
                    }
                    placeholder={tMp("step1.concernedPersonPlaceholder")}
                  />
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step1.medicalConditions")}
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    {tMp("step1.medicalConditionsDesc")}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {medicalConditionOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          const current =
                            healthBackgroundData.medicalConditions;
                          if (current.includes(item.value)) {
                            setHealthBackgroundData((prev) => ({
                              ...prev,
                              medicalConditions: current.filter(
                                (v) => v !== item.value,
                              ),
                            }));
                          } else {
                            setHealthBackgroundData((prev) => ({
                              ...prev,
                              medicalConditions: [...current, item.value],
                            }));
                          }
                        }}
                        className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                          healthBackgroundData.medicalConditions.includes(item.value)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-foreground hover:bg-muted"
                        }`}
                      >
                        {tMp(`step1.medicalConditionOptions.${item.key}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="currentMedications"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step1.currentMedications")}
                  </Label>
                  <Input
                    id="currentMedications"
                    name="currentMedications"
                    value={healthBackgroundData.currentMedications.join(", ")}
                    onChange={(e) =>
                      setHealthBackgroundData((prev) => ({
                        ...prev,
                        currentMedications: e.target.value
                          .split(", ")
                          .filter(Boolean),
                      }))
                    }
                    placeholder={tMp("step1.currentMedicationsPlaceholder")}
                  />
                </div>

                <div>
                  <Label
                    htmlFor="allergies"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step1.allergies")}
                  </Label>
                  <Input
                    id="allergies"
                    name="allergies"
                    value={healthBackgroundData.allergies.join(", ")}
                    onChange={(e) =>
                      setHealthBackgroundData((prev) => ({
                        ...prev,
                        allergies: e.target.value.split(", ").filter(Boolean),
                      }))
                    }
                    placeholder={tMp("step1.allergiesPlaceholder")}
                  />
                </div>

                <div>
                  <Label
                    htmlFor="substanceUse"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step1.substanceUse")}
                  </Label>
                  <Input
                    id="substanceUse"
                    name="substanceUse"
                    value={healthBackgroundData.substanceUse}
                    onChange={(e) =>
                      setHealthBackgroundData((prev) => ({
                        ...prev,
                        substanceUse: e.target.value,
                      }))
                    }
                    placeholder={tMp("step1.substanceUsePlaceholder")}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="mental-health-history">
              {/* Mental Health History Form */}
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step2.previousTherapy")}
                    </Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="previousTherapy"
                          checked={
                            mentalHealthHistoryData.previousTherapy === true
                          }
                          onChange={() =>
                            setMentalHealthHistoryData((prev) => ({
                              ...prev,
                              previousTherapy: true,
                            }))
                          }
                        />
                        <span className="text-sm font-light">{tProfile("yes")}</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="previousTherapy"
                          checked={
                            mentalHealthHistoryData.previousTherapy === false
                          }
                          onChange={() =>
                            setMentalHealthHistoryData((prev) => ({
                              ...prev,
                              previousTherapy: false,
                            }))
                          }
                        />
                        <span className="text-sm font-light">{tProfile("no")}</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step2.psychiatricHospitalization")}
                    </Label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="psychiatricHospitalization"
                          checked={
                            mentalHealthHistoryData.psychiatricHospitalization ===
                            true
                          }
                          onChange={() =>
                            setMentalHealthHistoryData((prev) => ({
                              ...prev,
                              psychiatricHospitalization: true,
                            }))
                          }
                        />
                        <span className="text-sm font-light">{tProfile("yes")}</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="psychiatricHospitalization"
                          checked={
                            mentalHealthHistoryData.psychiatricHospitalization ===
                            false
                          }
                          onChange={() =>
                            setMentalHealthHistoryData((prev) => ({
                              ...prev,
                              psychiatricHospitalization: false,
                            }))
                          }
                        />
                        <span className="text-sm font-light">{tProfile("no")}</span>
                      </label>
                    </div>
                  </div>
                </div>

                {mentalHealthHistoryData.previousTherapy && (
                  <div>
                    <Label
                      htmlFor="previousTherapyDetails"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step2.previousTherapyDetails")}
                    </Label>
                    <Textarea
                      id="previousTherapyDetails"
                      name="previousTherapyDetails"
                      value={mentalHealthHistoryData.previousTherapyDetails}
                      onChange={(e) =>
                        setMentalHealthHistoryData((prev) => ({
                          ...prev,
                          previousTherapyDetails: e.target.value,
                        }))
                      }
                      rows={4}
                      placeholder={tMp("step2.previousTherapyDetailsPlaceholder")}
                    />
                  </div>
                )}

                <div>
                  <Label
                    htmlFor="currentTreatment"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step2.currentTreatment")}
                  </Label>
                  <Input
                    id="currentTreatment"
                    name="currentTreatment"
                    value={mentalHealthHistoryData.currentTreatment}
                    onChange={(e) =>
                      setMentalHealthHistoryData((prev) => ({
                        ...prev,
                        currentTreatment: e.target.value,
                      }))
                    }
                    placeholder={tMp("step2.currentTreatmentPlaceholder")}
                  />
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step2.diagnosedConditions")}
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    {tMp("step2.diagnosedConditionsDesc")}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
                    {(() => {
                      // Determine if child based on concernedPerson field
                      const isChild = healthBackgroundData.concernedPerson?.toLowerCase().includes("enfant") || 
                                     healthBackgroundData.concernedPerson?.toLowerCase().includes("child");

                      // Diagnostics pour les enfants (liste affichée au client pour son profil médical)
                      const childDiagnosedConditions = CHILD_DIAGNOSTICS;

                      // Diagnostics pour les adultes (liste affichée au client pour son profil médical)
                      const adultDiagnosedConditions = ADULT_DIAGNOSTICS;

                      const conditionsList = isChild ? childDiagnosedConditions : adultDiagnosedConditions;

                      return conditionsList.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            const current =
                              mentalHealthHistoryData.diagnosedConditions;
                            if (current.includes(item)) {
                              setMentalHealthHistoryData((prev) => ({
                                ...prev,
                                diagnosedConditions: current.filter(
                                  (v) => v !== item,
                                ),
                              }));
                            } else {
                              setMentalHealthHistoryData((prev) => ({
                                ...prev,
                                diagnosedConditions: [...current, item],
                              }));
                            }
                          }}
                          className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                            mentalHealthHistoryData.diagnosedConditions.includes(
                              item,
                            )
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/50 text-foreground hover:bg-muted"
                          }`}
                        >
                          {translateDiagnosedCondition(item)}
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="current-concerns">
              <div className="space-y-6">
                <div>
                  <Label
                    htmlFor="primaryIssue"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step3.primaryIssue")}{" "}
                    <span className="text-primary ml-1">*</span>
                  </Label>
                  <Input
                    id="primaryIssue"
                    name="primaryIssue"
                    value={currentConcernsData.primaryIssue}
                    onChange={(e) =>
                      setCurrentConcernsData((prev) => ({
                        ...prev,
                        primaryIssue: e.target.value,
                      }))
                    }
                    placeholder={tMp("step3.primaryIssuePlaceholder")}
                  />
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step3.secondaryIssues")}
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    {tMp("step3.secondaryIssuesDesc")}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
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
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          const current = currentConcernsData.secondaryIssues;
                          if (current.includes(item.value)) {
                            setCurrentConcernsData((prev) => ({
                              ...prev,
                              secondaryIssues: current.filter(
                                (v) => v !== item.value,
                              ),
                            }));
                          } else {
                            setCurrentConcernsData((prev) => ({
                              ...prev,
                              secondaryIssues: [...current, item.value],
                            }));
                          }
                        }}
                        className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                          currentConcernsData.secondaryIssues.includes(item.value)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-foreground hover:bg-muted"
                        }`}
                      >
                        {tMp(`step3.secondaryIssueOptions.${item.key}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="issueDescription"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step3.issueDescription")}
                  </Label>
                  <Textarea
                    id="issueDescription"
                    name="issueDescription"
                    value={currentConcernsData.issueDescription}
                    onChange={(e) =>
                      setCurrentConcernsData((prev) => ({
                        ...prev,
                        issueDescription: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={tMp("step3.issueDescriptionPlaceholder")}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step3.severity")}
                    </Label>
                    <Select
                      value={currentConcernsData.severity}
                      onValueChange={(value) =>
                        setCurrentConcernsData((prev) => ({
                          ...prev,
                          severity: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step3.severityPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mild">{tProfile("issueDetails.mild")}</SelectItem>
                        <SelectItem value="moderate">{tProfile("issueDetails.moderate")}</SelectItem>
                        <SelectItem value="severe">{tProfile("issueDetails.severe")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step3.duration")}
                    </Label>
                    <Select
                      value={currentConcernsData.duration}
                      onValueChange={(value) =>
                        setCurrentConcernsData((prev) => ({
                          ...prev,
                          duration: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step3.durationPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lessThanMonth">
                          {tProfile("issueDetails.lessThanMonth")}
                        </SelectItem>
                        <SelectItem value="oneToThree">{tProfile("issueDetails.oneToThree")}</SelectItem>
                        <SelectItem value="threeToSix">{tProfile("issueDetails.threeToSix")}</SelectItem>
                        <SelectItem value="moreThanSix">
                          {tProfile("issueDetails.moreThanSix")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label
                      htmlFor="triggeringSituation"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step3.triggeringSituation")}
                    </Label>
                    <Input
                      id="triggeringSituation"
                      name="triggeringSituation"
                      value={currentConcernsData.triggeringSituation}
                      onChange={(e) =>
                        setCurrentConcernsData((prev) => ({
                          ...prev,
                          triggeringSituation: e.target.value,
                        }))
                      }
                    placeholder={tMp("step3.triggeringSituationPlaceholder")}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="symptoms-impact">
              <div className="space-y-6">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step4.symptoms")}
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    {tMp("step4.symptomsDesc")}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
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
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          const current = symptomsImpactData.symptoms;
                          if (current.includes(item.value)) {
                            setSymptomsImpactData((prev) => ({
                              ...prev,
                              symptoms: current.filter((v) => v !== item.value),
                            }));
                          } else {
                            setSymptomsImpactData((prev) => ({
                              ...prev,
                              symptoms: [...current, item.value],
                            }));
                          }
                        }}
                        className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                          symptomsImpactData.symptoms.includes(item.value)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-foreground hover:bg-muted"
                        }`}
                      >
                        {tMp(`step4.symptomOptions.${item.key}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="dailyLifeImpact"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step4.dailyLifeImpact")}
                  </Label>
                  <Textarea
                    id="dailyLifeImpact"
                    name="dailyLifeImpact"
                    value={symptomsImpactData.dailyLifeImpact}
                    onChange={(e) =>
                      setSymptomsImpactData((prev) => ({
                        ...prev,
                        dailyLifeImpact: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={tMp("step4.dailyLifeImpactPlaceholder")}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step4.sleepQuality")}
                    </Label>
                    <Select
                      value={symptomsImpactData.sleepQuality}
                      onValueChange={(value) =>
                        setSymptomsImpactData((prev) => ({
                          ...prev,
                          sleepQuality: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step4.sleepQualityPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">{tMp("step4.sleepQualityOptions.normal")}</SelectItem>
                        <SelectItem value="poor">{tMp("step4.sleepQualityOptions.poor")}</SelectItem>
                        <SelectItem value="insomnia">{tMp("step4.sleepQualityOptions.insomnia")}</SelectItem>
                        <SelectItem value="excessive">{tMp("step4.sleepQualityOptions.excessive")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label
                      htmlFor="appetiteChanges"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step4.appetiteChanges")}
                    </Label>
                    <Input
                      id="appetiteChanges"
                      name="appetiteChanges"
                      value={symptomsImpactData.appetiteChanges}
                      onChange={(e) =>
                        setSymptomsImpactData((prev) => ({
                          ...prev,
                          appetiteChanges: e.target.value,
                        }))
                      }
                    placeholder={tMp("step4.appetiteChangesPlaceholder")}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="goals-preferences">
              <div className="space-y-6">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step5.treatmentGoals")}{" "}
                    <span className="text-primary ml-1">*</span>
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    {tMp("step5.treatmentGoalsDesc")}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {treatmentGoalsOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          const current = goalsPreferencesData.treatmentGoals;
                          if (current.includes(item.value)) {
                            setGoalsPreferencesData((prev) => ({
                              ...prev,
                              treatmentGoals: current.filter((v) => v !== item.value),
                            }));
                          } else {
                            setGoalsPreferencesData((prev) => ({
                              ...prev,
                              treatmentGoals: [...current, item.value],
                            }));
                          }
                        }}
                        className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                          goalsPreferencesData.treatmentGoals.includes(item.value)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-foreground hover:bg-muted"
                        }`}
                      >
                        {tMp(`step5.treatmentGoalOptions.${item.key}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step5.therapyApproach")}
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    Select preferred therapeutic approaches
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {therapyApproachOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          const current = goalsPreferencesData.therapyApproach;
                          if (current.includes(item.value)) {
                            setGoalsPreferencesData((prev) => ({
                              ...prev,
                              therapyApproach: current.filter(
                                (v) => v !== item.value,
                              ),
                            }));
                          } else {
                            setGoalsPreferencesData((prev) => ({
                              ...prev,
                              therapyApproach: [...current, item.value],
                            }));
                          }
                        }}
                        className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                          goalsPreferencesData.therapyApproach.includes(item.value)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-foreground hover:bg-muted"
                        }`}
                      >
                        {tMp(`step5.therapyApproachOptions.${item.key}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="concernsAboutTherapy"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step5.concernsAboutTherapy")}
                  </Label>
                  <Textarea
                    id="concernsAboutTherapy"
                    name="concernsAboutTherapy"
                    value={goalsPreferencesData.concernsAboutTherapy}
                    onChange={(e) =>
                      setGoalsPreferencesData((prev) => ({
                        ...prev,
                        concernsAboutTherapy: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={tMp("step5.concernsAboutTherapyPlaceholder")}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="appointment-preferences">
              <div className="space-y-6">
                <div>
                  <Label className="font-light mb-3 text-base">
                    {tMp("step6.preferredTimeSlots")}{" "}
                    <span className="text-primary ml-1">{tMp("step6.required")}</span>
                  </Label>
                  <p className="text-sm text-muted-foreground font-light mb-4">
                    {tMp("step6.preferredTimeSlotsDesc")}
                  </p>
                  <p className="text-sm text-muted-foreground font-light mb-3">
                    {tMp("step6.clinicalGridHint")}
                  </p>
                  <ClinicalAvailabilityGrid
                    value={appointmentPreferencesData.availability}
                    onChange={(availability) =>
                      setAppointmentPreferencesData((prev) => ({
                        ...prev,
                        availability,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step6.modality")}
                    </Label>
                    <Select
                      value={appointmentPreferencesData.modality}
                      onValueChange={(value) =>
                        setAppointmentPreferencesData((prev) => ({
                          ...prev,
                          modality: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step6.modalityPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online">{tProfile("preferences.online")}</SelectItem>
                        <SelectItem value="inPerson">{tProfile("preferences.inPerson")}</SelectItem>
                        <SelectItem value="both">{tProfile("preferences.both")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step6.sessionFrequency")}
                    </Label>
                    <Select
                      value={appointmentPreferencesData.sessionFrequency}
                      onValueChange={(value) =>
                        setAppointmentPreferencesData((prev) => ({
                          ...prev,
                          sessionFrequency: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step6.sessionFrequencyPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">{tMp("step6.sessionFrequencyOptions.weekly")}</SelectItem>
                        <SelectItem value="biweekly">{tMp("step6.sessionFrequencyOptions.biweekly")}</SelectItem>
                        <SelectItem value="monthly">{tMp("step6.sessionFrequencyOptions.monthly")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label
                      htmlFor="location"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step6.location")}
                    </Label>
                    <Input
                      id="location"
                      name="location"
                      value={appointmentPreferencesData.location}
                      onChange={(e) =>
                        setAppointmentPreferencesData((prev) => ({
                          ...prev,
                          location: e.target.value,
                        }))
                      }
                      placeholder={tMp("step6.locationPlaceholder")}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes" className="font-light mb-3 text-base">
                    {tMp("step6.notes")}
                  </Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={appointmentPreferencesData.notes}
                    onChange={(e) =>
                      setAppointmentPreferencesData((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={tMp("step6.notesPlaceholder")}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="emergency-info">
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <Label
                      htmlFor="emergencyContactName"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step7.emergencyContactName")}{" "}
                      <span className="text-primary ml-1">*</span>
                    </Label>
                    <Input
                      id="emergencyContactName"
                      name="emergencyContactName"
                      value={emergencyInfoData.emergencyContactName}
                      onChange={(e) =>
                        setEmergencyInfoData((prev) => ({
                          ...prev,
                          emergencyContactName: e.target.value,
                        }))
                      }
                      placeholder={tMp("step7.emergencyContactNamePlaceholder")}
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="emergencyContactPhone"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step7.emergencyContactPhone")}{" "}
                      <span className="text-primary ml-1">*</span>
                    </Label>
                    <Input
                      id="emergencyContactPhone"
                      name="emergencyContactPhone"
                      value={emergencyInfoData.emergencyContactPhone}
                      onChange={(e) =>
                        setEmergencyInfoData((prev) => ({
                          ...prev,
                          emergencyContactPhone: e.target.value,
                        }))
                      }
                      placeholder={tMp("step7.emergencyContactPhonePlaceholder")}
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="emergencyContactRelation"
                      className="font-light mb-3 text-base"
                    >
                      {tMp("step7.emergencyContactRelation")}
                    </Label>
                    <Input
                      id="emergencyContactRelation"
                      name="emergencyContactRelation"
                      value={emergencyInfoData.emergencyContactRelation}
                      onChange={(e) =>
                        setEmergencyInfoData((prev) => ({
                          ...prev,
                          emergencyContactRelation: e.target.value,
                        }))
                      }
                    placeholder={tMp("step7.emergencyContactRelationPlaceholder")}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="matching-preferences">
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step8.preferredGender")}
                    </Label>
                    <Select
                      value={matchingPreferencesData.preferredGender}
                      onValueChange={(value) =>
                        setMatchingPreferencesData((prev) => ({
                          ...prev,
                          preferredGender: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step8.preferredGenderPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="noPreference">
                          {tMp("step8.genderOptions.noPreference")}
                        </SelectItem>
                        <SelectItem value="male">
                          {tMp("step8.genderOptions.male")}
                        </SelectItem>
                        <SelectItem value="female">
                          {tMp("step8.genderOptions.female")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="font-light mb-3 text-base">
                      {tMp("step8.preferredAge")}
                    </Label>
                    <Select
                      value={matchingPreferencesData.preferredAge}
                      onValueChange={(value) =>
                        setMatchingPreferencesData((prev) => ({
                          ...prev,
                          preferredAge: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tMp("step8.preferredAgePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{tProfile("matching.any")}</SelectItem>
                        <SelectItem value="younger">{tProfile("matching.younger")}</SelectItem>
                        <SelectItem value="middle">
                          {tProfile("matching.middle")}
                        </SelectItem>
                        <SelectItem value="older">{tProfile("matching.older")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="languagePreference"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step8.languagePreference")}
                  </Label>
                  <Input
                    id="languagePreference"
                    name="languagePreference"
                    value={matchingPreferencesData.languagePreference}
                    onChange={(e) =>
                      setMatchingPreferencesData((prev) => ({
                        ...prev,
                        languagePreference: e.target.value,
                      }))
                    }
                    placeholder={tMp("step8.languagePreferencePlaceholder")}
                  />
                </div>

                <div>
                  <Label
                    htmlFor="culturalConsiderations"
                    className="font-light mb-3 text-base"
                  >
                    {tMp("step8.culturalConsiderations")}
                  </Label>
                  <Textarea
                    id="culturalConsiderations"
                    name="culturalConsiderations"
                    value={matchingPreferencesData.culturalConsiderations}
                    onChange={(e) =>
                      setMatchingPreferencesData((prev) => ({
                        ...prev,
                        culturalConsiderations: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={tMp("step8.culturalConsiderationsPlaceholder")}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tProfile("cancel")}
          </Button>
          <Button onClick={handleSave}>{tProfile("save")}</Button>
        </div>
      </div>
    </div>
  );
}
