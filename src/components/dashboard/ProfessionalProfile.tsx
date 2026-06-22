"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { IProfile } from "@/models/Profile";
import { isProfessionalProfileComplete } from "@/lib/professional-profile-complete";
import { profileAPI } from "@/lib/api-client";
import ProfileCompletionModal from "./ProfileCompletionModal";
import ProfessionalTermsAcceptanceModal from "@/components/legal/ProfessionalTermsAcceptanceModal";

interface ProfessionalProfileProps {
  profile?: IProfile;
  userId?: string;
  setProfile?: (profile: IProfile) => void;
  isEditable?: boolean;
  onSaveOverride?: (data: IProfile) => Promise<IProfile | null>;
  hideHeaderFields?: boolean;
}

// Completeness rule lives in a tested pure helper. `skills` is intentionally
// NOT required (it's "(Facultatif)" in the form) — see the helper's doc.
const isProfileCompleted = (profile: IProfile | null): boolean =>
  isProfessionalProfileComplete(profile);

function translatePaymentAgreement(
  value: string,
  t: (key: string) => string,
): string {
  const key = value.toLowerCase().trim().replace(/\s+/g, "-");
  if (key === "per-session") return t("paymentAgreementPerSession");
  if (key === "weekly") return t("paymentAgreementWeekly");
  if (key === "bi-weekly" || key === "biweekly")
    return t("paymentAgreementBiWeekly");
  if (key === "monthly") return t("paymentAgreementMonthly");
  return value.replace(/-/g, " ");
}

const AGE_CATEGORY_LABEL_KEYS: Record<
  string,
  "children" | "adolescents" | "youngAdults" | "adults" | "seniors"
> = {
  "Children (0-12)": "children",
  "Adolescents (13-17)": "adolescents",
  "Young Adults (18-25)": "youngAdults",
  "Adults (26-64)": "adults",
  "Seniors (65+)": "seniors",
};

const SKILL_LABEL_KEYS: Record<string, string> = {
  "Crisis Intervention": "crisisIntervention",
  "Group Therapy": "groupTherapy",
  "Couples Counseling": "couplesCounseling",
  "Family Therapy": "familyTherapy",
  "Neuropsychological Assessment": "neuropsychologicalAssessment",
  "Psychometric Testing": "psychometricTesting",
  "Bilingual Services (French/English)": "bilingualFrEn",
  "Cultural Competency": "culturalCompetency",
  "LGBTQ+ Affirmative Therapy": "lgbtqAffirmative",
};

const SESSION_TYPE_LABEL_KEYS: Record<string, string> = {
  Solo: "solo",
  Individual: "solo",
  Couple: "couple",
  Famille: "family",
  Family: "family",
  Groupe: "group",
  Group: "group",
  Coaching: "coaching",
};

const MODALITY_LABEL_KEYS: Record<string, string> = {
  "En ligne": "video",
  Vidéo: "video",
  Video: "video",
  Chat: "chat",
  "En personne": "inPerson",
  "In-person": "inPerson",
  Téléphone: "phone",
  Phone: "phone",
};

const LANGUAGE_LABEL_KEYS: Record<string, string> = {
  Français: "french",
  French: "french",
  Anglais: "english",
  English: "english",
  Arabe: "arabic",
  Arabic: "arabic",
  Espagnol: "spanish",
  Spanish: "spanish",
  Chinois: "chinese",
  Chinese: "chinese",
  Autre: "other",
  Other: "other",
};

export default function ProfessionalProfile({
  profile,
  userId,
  setProfile,
  isEditable = false,
  onSaveOverride,
  hideHeaderFields = false,
}: ProfessionalProfileProps) {
  const t = useTranslations("Dashboard.profile");
  const tModal = useTranslations("Dashboard.profileModal");

  const translateAgeCategoryLabel = (value: string) => {
    const key = AGE_CATEGORY_LABEL_KEYS[value];
    return key ? tModal(`step3.ageCategoryLabels.${key}`) : value;
  };

  const translateSkillLabel = (value: string) => {
    const key = SKILL_LABEL_KEYS[value];
    return key ? tModal(`step4.skillLabels.${key}`) : value;
  };

  const translateSessionTypeLabel = (value: string) => {
    const key = SESSION_TYPE_LABEL_KEYS[value];
    return key ? tModal(`step5.sessionTypesList.${key}`) : value;
  };

  const translateModalityLabel = (value: string) => {
    const key = MODALITY_LABEL_KEYS[value];
    return key ? tModal(`step5.modalitiesList.${key}`) : value;
  };

  const translateLanguageLabel = (value: string) => {
    const key = LANGUAGE_LABEL_KEYS[value];
    return key ? tModal(`step5.languagesList.${key}`) : value;
  };
  const [professionalProfile, setProfessionalProfile] =
    useState<IProfile | null>(profile || null);
  const [isLoading, setIsLoading] = useState(!profile);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);

  const updateProfile = useCallback(
    (updatedProfile: IProfile) => {
      setProfessionalProfile(updatedProfile);
      if (setProfile) setProfile(updatedProfile);
    },
    [setProfile],
  );

  const needsTermsAcceptance =
    !!professionalProfile &&
    isProfileCompleted(professionalProfile) &&
    !professionalProfile.professionalTermsAcceptedAt;

  useEffect(() => {
    if (isEditable && needsTermsAcceptance && !isModalOpen) {
      setIsTermsModalOpen(true);
    }
  }, [isEditable, needsTermsAcceptance, isModalOpen]);

  const handleTermsAccept = useCallback(async () => {
    const updated = (await profileAPI.update({
      acceptProfessionalTerms: true,
    })) as IProfile;
    setProfessionalProfile(updated);
    if (setProfile) setProfile(updated);
    setIsTermsModalOpen(false);
  }, [setProfile]);

  const fetchProfile = useCallback(async () => {
    if (profile) return;

    try {
      setIsLoading(true);
      const response = userId
        ? await profileAPI.getById(userId)
        : await profileAPI.get();
      if (response) {
        setProfessionalProfile(response as IProfile);
        if (setProfile) setProfile(response as IProfile);
      }
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
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!professionalProfile) {
    return (
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">{t("noData")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Profile Completion Banner */}
      {!isProfileCompleted(professionalProfile) && isEditable && (
        <div className="rounded-xl bg-primary/10 p-6 flex items-start gap-4">
          <AlertCircle className="h-6 w-6 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-light text-foreground text-lg mb-2">
              {t("completeSetupTitle")}
            </h3>
            <p className="text-sm text-muted-foreground font-light mb-4">
              {t("completeSetupDesc")}
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg text-sm"
            >
              {t("completeNow")}
            </button>
          </div>
        </div>
      )}
      {/* Professional Information */}
      {!hideHeaderFields && (
        <div className="rounded-xl bg-card p-6">
          <h2 className="text-xl font-serif font-light text-foreground mb-6">
            {t("professionalInfo")}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <Label className="font-light mb-2">{t("license")}</Label>
              <p className="text-foreground">
                {professionalProfile?.license || t("notAvailable")}
              </p>
            </div>

            <div>
              <Label className="font-light mb-2">{t("specialty")}</Label>
              <p className="text-foreground capitalize">
                {professionalProfile?.specialty || t("notAvailable")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Professional Specialization */}
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-serif font-light text-foreground">
            {t("professionalSpec")}
          </h2>
          {isEditable && (
            <Button
              onClick={() => setIsModalOpen(true)}
              variant="outline"
              size="sm"
              className="text-sm"
            >
              {isProfileCompleted(professionalProfile)
                ? t("edit")
                : t("complete")}
            </Button>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <Label className="font-light mb-3 text-base">
              {t("issueTypes")}
            </Label>
            {professionalProfile?.problematics &&
            professionalProfile.problematics.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.problematics.map((item) => (
                  <span
                    key={item}
                    className="px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm font-light"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>

          <div>
            <Label className="font-light mb-3 text-base">
              {t("approaches")}
            </Label>
            {professionalProfile?.approaches &&
            professionalProfile.approaches.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.approaches.map((item) => (
                  <span
                    key={item}
                    className="px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm font-light"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>

          <div>
            <Label className="font-light mb-3 text-base">
              {t("ageCategories")}
            </Label>
            {professionalProfile?.ageCategories &&
            professionalProfile.ageCategories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.ageCategories.map((item) => (
                  <span
                    key={item}
                    className="px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm font-light"
                  >
                    {translateAgeCategoryLabel(item)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>

          <div>
            <Label className="font-light mb-3 text-base">
              {t("additionalSkills")}
            </Label>
            {professionalProfile?.skills &&
            professionalProfile.skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.skills.map((item) => (
                  <span
                    key={item}
                    className="px-3 py-1.5 bg-muted text-foreground rounded-full text-sm font-light"
                  >
                    {translateSkillLabel(item)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>
        </div>
      </div>

      {/* About Section */}
      {!hideHeaderFields && (
        <div className="rounded-xl bg-card p-6">
          <div className="mb-6">
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("about")}
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="font-light mb-2 text-base">{t("yearsExp")}</Label>
              <p className="text-foreground">
                {professionalProfile.yearsOfExperience || t("notAvailable")}{" "}
                {professionalProfile.yearsOfExperience ? t("years") : ""}
              </p>
            </div>

            <div>
              <Label className="font-light mb-2 text-base">{t("bio")}</Label>
              <p className="text-foreground leading-relaxed">
                {professionalProfile?.bio || t("notAvailable")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Education & Certifications */}
      <div className="rounded-xl bg-card p-6">
        <h2 className="text-xl font-serif font-light text-foreground mb-6">
          {t("educationCredentials")}
        </h2>

        <div className="space-y-6">
          {professionalProfile?.education &&
          professionalProfile.education.length > 0 ? (
            <div>
              <Label className="font-light mb-3 text-base">
                {t("education")}
              </Label>
              <div className="space-y-3">
                {professionalProfile.education.map((edu, index) => (
                  <div key={index} className="p-4 bg-muted/30 rounded-lg">
                    <p className="font-medium text-foreground">{edu.degree}</p>
                    <p className="text-sm text-muted-foreground">
                      {edu.institution}
                    </p>
                    {edu.year && (
                      <p className="text-sm text-muted-foreground">
                        {edu.year}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <Label className="font-light mb-3 text-base">{t("education")}</Label>
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            </div>
          )}

          {professionalProfile?.certifications &&
          professionalProfile.certifications.length > 0 ? (
            <div>
              <Label className="font-light mb-3 text-base">
                {t("certifications")}
              </Label>
              <div className="flex flex-wrap gap-2">
                {professionalProfile.certifications.map((cert) => (
                  <span
                    key={cert}
                    className="px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-light"
                  >
                    {cert}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <Label className="font-light mb-3 text-base">
                {t("certifications")}
              </Label>
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            </div>
          )}
        </div>
      </div>

      {/* Session Types & Modalities */}
      <div className="rounded-xl bg-card p-6">
        <h2 className="text-xl font-serif font-light text-foreground mb-6">
          {t("servicesOffered")}
        </h2>

        <div className="space-y-6">
          <div>
            <Label className="font-light mb-3 text-base">
              {t("sessionTypes")}
            </Label>
            {professionalProfile?.sessionTypes &&
            professionalProfile.sessionTypes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.sessionTypes.map((type) => (
                  <span
                    key={type}
                    className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-light"
                  >
                    {translateSessionTypeLabel(type)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>

          <div>
            <Label className="font-light mb-3 text-base">
              {t("modalitiesLabel")}
            </Label>
            {professionalProfile?.modalities &&
            professionalProfile.modalities.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.modalities.map((modality) => (
                  <span
                    key={modality}
                    className="px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-light"
                  >
                    {translateModalityLabel(modality)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>

          <div>
            <Label className="font-light mb-3 text-base">
              {t("languagesSpoken")}
            </Label>
            {professionalProfile?.languages &&
            professionalProfile.languages.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {professionalProfile.languages.map((lang) => (
                  <span
                    key={lang}
                    className="px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-light"
                  >
                    {translateLanguageLabel(lang)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Pricing & Payment */}
      <div className="rounded-xl bg-card p-6">
        <h2 className="text-xl font-serif font-light text-foreground mb-6">
          {t("pricingPayment")}
        </h2>

        <div className="space-y-4">
          {professionalProfile?.pricing && (
            <div className="grid gap-4 md:grid-cols-3">
              {professionalProfile.pricing.individualSession && (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <Label className="font-light mb-1 text-sm">
                    {t("individualSession")}
                  </Label>
                  <p className="text-2xl font-medium text-foreground">
                    ${professionalProfile.pricing.individualSession}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("perSession")}
                  </p>
                </div>
              )}

              {professionalProfile.pricing.coupleSession && (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <Label className="font-light mb-1 text-sm">
                    {t("coupleSession")}
                  </Label>
                  <p className="text-2xl font-medium text-foreground">
                    ${professionalProfile.pricing.coupleSession}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("perSession")}
                  </p>
                </div>
              )}

              {professionalProfile.pricing.groupSession && (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <Label className="font-light mb-1 text-sm">
                    {t("groupSession")}
                  </Label>
                  <p className="text-2xl font-medium text-foreground">
                    ${professionalProfile.pricing.groupSession}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("perSession")}
                  </p>
                </div>
              )}
            </div>
          )}

          {!professionalProfile?.pricing?.individualSession &&
            !professionalProfile?.pricing?.coupleSession &&
            !professionalProfile?.pricing?.groupSession && (
              <p className="text-muted-foreground">{t("pricingNotSet")}</p>
            )}

          {professionalProfile?.paymentAgreement && (
            <div>
              <Label className="font-light mb-2 text-base">
                {t("paymentAgreement")}
              </Label>
              <p className="text-foreground">
                {translatePaymentAgreement(professionalProfile.paymentAgreement, t)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Profile Completion Modal */}
      <ProfileCompletionModal
        isOpen={isEditable && isModalOpen}
        onClose={() => setIsModalOpen(false)}
        setProfessionalProfile={updateProfile}
        profile={professionalProfile}
        onSaveOverride={onSaveOverride}
      />

      {/* Professional Terms Acceptance Modal */}
      <ProfessionalTermsAcceptanceModal
        open={isEditable && isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        onAccept={handleTermsAccept}
      />
    </>
  );
}
