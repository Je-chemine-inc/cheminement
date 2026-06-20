"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { MotifSearch } from "@/components/ui/MotifSearch";
import { useTranslations, useLocale } from "next-intl";
import { IProfile } from "@/models/Profile";
import { profileAPI } from "@/lib/api-client";
import { APPROACHES_ET_THERAPIES } from "@/data/approaches";
import {
  CHILD_PROBLEMATICS,
  CHILD_PROBLEMATICS_EN,
} from "@/data/childProblematics";
import {
  ADULT_PROBLEMATICS,
  ADULT_PROBLEMATICS_EN,
} from "@/data/adultProblematics";
import { translateFromMap } from "@/lib/bilingual";

interface ProfileCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  setProfessionalProfile: (data: IProfile) => void;
  profile?: IProfile;
  onSaveOverride?: (data: IProfile) => Promise<IProfile | null>;
}

export interface ProfileData {
  problematics: string[];
  approaches: string[];
  ageCategories: string[];
  diagnosedConditions: string[];
  skills: string[];
  bio: string;
  yearsOfExperience: string;
  languages: string[];
  sessionTypes: string[];
  modalities: string[];
  pricing: {
    individualSession: number;
    coupleSession: number;
    groupSession: number;
  };
  education: {
    degree: string;
    institution: string;
    year: number | string;
  }[];
  certifications: string[];
  specialty: string;
  license: string;
}

export default function ProfileCompletionModal({
  isOpen,
  onClose,
  setProfessionalProfile,
  profile,
  onSaveOverride,
}: ProfileCompletionModalProps) {
  const t = useTranslations("Dashboard.profileModal");
  const locale = useLocale();
  const problematicsMap: Record<string, string> = {
    ...CHILD_PROBLEMATICS_EN,
    ...ADULT_PROBLEMATICS_EN,
  };
  const [currentStep, setCurrentStep] = useState(0);

  const STEPS = [
    { title: t("steps.issueTypes"), description: t("steps.issueTypesDesc") },
    { title: t("steps.approaches"), description: t("steps.approachesDesc") },
    { title: t("steps.ageGroups"), description: t("steps.ageGroupsDesc") },
    {
      title: t("steps.additionalInfo"),
      description: t("steps.additionalInfoDesc"),
    },
    {
      title: t("steps.credentials"),
      description: t("steps.credentialsDesc"),
    },
  ];

  const [formData, setFormData] = useState<ProfileData>({
    problematics: profile?.problematics || [],
    approaches: profile?.approaches || [],
    ageCategories: profile?.ageCategories || [],
    diagnosedConditions: profile?.diagnosedConditions || [],
    skills: profile?.skills || [],
    bio: profile?.bio || "",
    yearsOfExperience: profile?.yearsOfExperience?.toString() || "",
    languages: profile?.languages || ["Français"],
    sessionTypes: profile?.sessionTypes || ["Solo"],
    modalities: profile?.modalities || ["En ligne"],
    pricing: profile?.pricing || {
      individualSession: 0,
      coupleSession: 0,
      groupSession: 0,
    },
    education: profile?.education || [{ degree: "", institution: "", year: "" }],
    certifications: profile?.certifications || [],
    specialty: profile?.specialty || "",
    license: profile?.license || "",
  });

  const problematics = [
    "Intervention auprès des employés des services d'urgence (ambulanciers, policiers, pompiers…)",
    "Estime/affirmation de soi",
    "Oncologie",
    "Accident de la route",
    "Accident de travail",
    "Adaptation à l'école",
    "Adoption internationale",
    "Alcoolisme / toxicomanies",
    "Aliénation mentale",
    "Abus sexuel",
    "Anxiété",
    "Anxiété de performance",
    "Arrêt de travail",
    "Retour progressif au travail",
    "Approche intégrative",
    "Approche humaniste",
    "Approche TCC",
    "ACT",
    "Psychodynamique",
    "Pleine conscience",
    "Changement organisationnel",
    "Changements sociaux",
    "Charge mentale",
    "Climat de travail",
    "Conflits interpersonnels",
    "Communication",
    "Curatelle publique",
    "Déficit de l'attention/hyperactivité",
    "Déficience intellectuelle",
    "Dépendance affective",
    "Dépendance aux jeux de hasard et d'argent (en ligne)",
    "Dépendance aux jeux vidéo",
    "Dépendance aux contenus pornographiques",
    "Difficultés académiques",
    "Recherche de sens",
    "Relations amoureuses",
    "Relations au travail",
    "Intervention en milieu de travail",
    "Santé psychologique au travail",
    "Deuil",
    "Diversité culturelle",
    "Douance",
    "Douleur chronique / fibromyalgie",
    "Dynamique organisationnelle",
    "EMDR",
    "Épuisement professionnel/burnout",
    "Estime de soi",
    "Étape de la vie",
    "Évaluation neuropsychologique",
    "Évaluation psychologique",
    "Évaluation psychologique milieu scolaire",
    "Fertilité / Procréation assistée",
    "Garde d'enfants (expertise psychosociale)",
    "Gestion de carrière",
    "Gestion du stress",
    "Gestion de la colère",
    "Gestion des émotions",
    "Guerre / conflits armés (vétérans)",
    "Guerre / conflits armés (victimes)",
    "Habiletés de gestion",
    "Harcèlement au travail",
    "HPI-adulte",
    "TSA",
    "TSA adulte évaluation",
    "TSA adulte intervention",
    "Hypnose thérapeutique",
    "IMO",
    "Immigration",
    "Vieillissement",
    "Intérêts / Aptitudes au travail",
    "Intimidation",
    "Violence (agresseurs)",
    "Violence (victimes)",
    "Maladie dégénératives / sida",
    "Maladies physiques / handicaps",
    "Médiation familiale",
    "Monoparentalité / famille recomposée",
    "Orientation scolaire et professionnelle",
    "Orientation sexuelle",
    "Peur de vomir",
    "Peur d'avoir peur",
    "Peur de mourir",
    "Périnatalité",
    "Problématiques propres aux autochtones",
    "Problématiques propres aux agriculteurs",
    "Problématiques propres aux réfugiés",
    "Problèmes relationnels",
    "Proche aidant",
    "Psychosomatique",
    "Psychologie du sport",
    "La psychologie gériatrique",
    "Relations familiales",
    "Sectes",
    "Sélection de personnel/réaffectation",
    "Séparation/divorce",
    "Situations de crise",
    "Soins palliatifs",
    "Spiritualité",
    "Stress post-traumatique",
    "Stress financier",
    "Transexualité",
    "Troubles alimentaires",
    "Troubles anxieux, phobies, panique",
    "Troubles d'apprentissages",
    "Troubles de la personnalité",
    "TPL",
    "Troubles de l'humeur",
    "Troubles du langage",
    "Troubles du sommeil",
    "Troubles mentaux sévères et persistants",
    "Troubles neuropsychologiques",
    "Troubles obsessifs-compulsifs",
    "Identité de genre / LGBTQ+",
    "Addiction sexuelle et hypersexualité",
    "Affirmation de soi",
    "Anxiété de séparation",
    "Anxiété post-partum",
    "Asexualité et aromantisme",
    "Attachement chez les adultes",
    "Autosabotage",
    "Blessure morale",
    "Boulimie",
    "Leadership",
    "Gestion d'équipe",
    "Rôle de gestionnaire",
    "Compétences en matière de résolution de problèmes",
    "Compétences parentales",
    "Étape ou transition de vie",
    "Difficultés masculines",
    "Famille recomposée",
    "Fugue",
    "Gestion de la colère ordonnée par le tribunal",
    "Gestion de la douleur chronique",
    "Gestion du temps et organisation",
    "Grossesse et maternité",
    "Identité de genre",
    "Insomnie",
    "Le mensonge",
    "Motivation",
    "Perfectionnisme",
    "Procrastination",
    "Racisme, soutien à la discrimination",
    "Relations interpersonnelles",
    "Séparation ou divorce",
    "Problèmes professionnels",
    "Soutien aux réfugiés et aux immigrants",
    "Survivre à la maltraitance",
    "Fatigue chronique",
    "L'agoraphobie",
    "L'anxiété liée à la santé",
    "Dysrégulation émotionnelle",
    "Phobie",
    "Colère",
    "Personnalité dépendante",
    "Traitement du jeu pathologique",
    "Interventions/moyens TDAH",
    "Accumulation compulsive",
    "Traitement du trouble obsessionnel compulsif (TOC)",
    "Traitement du trouble panique",
    "Traitement pour l'anxiété sociale",
    "Trouble affectif saisonnier (TAS)",
    "Trouble de l'adaptation",
    "Trouble de la dépersonnalisation-déréalisation",
    "Troubles de l'attachement",
    "Psychose",
    "État dépressif",
    "Bipolarité",
    "Peur de vieillir",
    "Exposition mentale",
    "Anxiété chez les personnes âgées",
    "Fatigabilité",
    "Irritabilité",
    "Problèmes de sommeil",
    "Difficultés de concentration",
    "Difficultés à prendre des décisions",
    "Déficits des fonctions exécutives",
    "Médiation en milieu de travail lorsqu'une personne a un problème de santé mentale",
  ];

  const therapeuticApproaches = APPROACHES_ET_THERAPIES;

  const ageCategoryOptions: {
    value: string;
    labelKey:
      | "children"
      | "adolescents"
      | "youngAdults"
      | "adults"
      | "seniors";
  }[] = [
    { value: "Children (0-12)", labelKey: "children" },
    { value: "Adolescents (13-17)", labelKey: "adolescents" },
    { value: "Young Adults (18-25)", labelKey: "youngAdults" },
    { value: "Adults (26-64)", labelKey: "adults" },
    { value: "Seniors (65+)", labelKey: "seniors" },
  ];

  const skillOptions: {
    value: string;
    labelKey:
      | "crisisIntervention"
      | "groupTherapy"
      | "couplesCounseling"
      | "familyTherapy"
      | "neuropsychologicalAssessment"
      | "psychometricTesting"
      | "bilingualFrEn"
      | "culturalCompetency"
      | "lgbtqAffirmative";
  }[] = [
    { value: "Crisis Intervention", labelKey: "crisisIntervention" },
    { value: "Group Therapy", labelKey: "groupTherapy" },
    { value: "Couples Counseling", labelKey: "couplesCounseling" },
    { value: "Family Therapy", labelKey: "familyTherapy" },
    {
      value: "Neuropsychological Assessment",
      labelKey: "neuropsychologicalAssessment",
    },
    { value: "Psychometric Testing", labelKey: "psychometricTesting" },
    {
      value: "Bilingual Services (French/English)",
      labelKey: "bilingualFrEn",
    },
    { value: "Cultural Competency", labelKey: "culturalCompetency" },
    {
      value: "LGBTQ+ Affirmative Therapy",
      labelKey: "lgbtqAffirmative",
    },
  ];

  const handleMultiSelect = (field: keyof ProfileData, value: string) => {
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
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
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

  const handleSubmit = async (data: ProfileData) => {
    try {
      let newProfile;
      if (onSaveOverride) {
        newProfile = await onSaveOverride(data as unknown as IProfile);
        if (newProfile) {
          setProfessionalProfile(newProfile);
        } else {
          setProfessionalProfile(data as unknown as IProfile);
        }
      } else {
        newProfile = (await profileAPI.update(data)) as IProfile;
        setProfessionalProfile(newProfile);
      }
    } catch (error) {
      console.error("Error updating profile:", error);
    }
    onClose();
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return formData.problematics.length > 0;
      case 1:
        return formData.approaches.length > 0;
      case 2:
        return formData.ageCategories.length > 0;
      case 3:
        return formData.bio.trim() !== "" && formData.yearsOfExperience !== "";
      case 4:
        return true; // Optional fields for now or validate at least one degree
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
          {/* Step 1: Issue Types */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step1.title")}
                  <span className="text-primary ml-1">
                    {t("step1.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step1.subtitle")}
                </p>
              </div>
              <MotifSearch
                multiSelect
                maxSelections={50}
                items={problematics}
                value={formData.problematics}
                onChange={(v) =>
                  setFormData((prev) => ({
                    ...prev,
                    problematics: Array.isArray(v) ? v : v ? [v] : [],
                  }))
                }
                placeholder={t("step1.searchPlaceholder")}
              />
            </div>
          )}

          {/* Step 2: Therapeutic Approaches */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step2.title")}
                  <span className="text-primary ml-1">
                    {t("step1.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step2.subtitle")}
                </p>
              </div>
              <MotifSearch
                multiSelect
                maxSelections={20}
                items={[...therapeuticApproaches]}
                value={formData.approaches}
                onChange={(v) =>
                  setFormData((prev) => ({
                    ...prev,
                    approaches: Array.isArray(v) ? v : v ? [v] : [],
                  }))
                }
                placeholder={t("step2.searchPlaceholder")}
              />
            </div>
          )}

          {/* Step 3: Age Categories */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-light text-foreground mb-2">
                  {t("step3.title")}
                  <span className="text-primary ml-1">
                    {t("step1.required")}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground font-light">
                  {t("step3.subtitle")}
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {ageCategoryOptions.map(({ value, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleMultiSelect("ageCategories", value)}
                    className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                      formData.ageCategories.includes(value)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-foreground hover:bg-muted"
                    }`}
                  >
                    {t(`step3.ageCategoryLabels.${labelKey}`)}
                  </button>
                ))}
              </div>

              {/* Diagnosed Conditions Selection */}
              <div className="space-y-2 mt-6">
                <Label className="font-light mb-3 text-base">
                  {t("step3.diagnosedConditionsLabel")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step3.diagnosedConditionsDesc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto">
                  {(() => {
                    // Determine if professional treats children or adults based on ageCategories
                    const treatsChildren = formData.ageCategories.some(
                      (cat) =>
                        cat.toLowerCase().includes("child") ||
                        cat.toLowerCase().includes("adolescent"),
                    );
                    const treatsAdults = formData.ageCategories.some(
                      (cat) =>
                        cat.toLowerCase().includes("adult") ||
                        cat.toLowerCase().includes("senior"),
                    );

                    // Problématiques et mandats (enfants et adolescents)
                    const childDiagnosedConditions = CHILD_PROBLEMATICS;

                    // Problématiques et mandats (adultes)
                    const adultDiagnosedConditions = ADULT_PROBLEMATICS;

                    // Combine lists based on what the professional treats.
                    // Deduplicate when merging: child/adult lists may share identical labels.
                    let conditionsList: string[] = [];
                    if (treatsChildren && treatsAdults) {
                      const seen = new Set<string>();
                      for (const entry of [
                        ...childDiagnosedConditions,
                        ...adultDiagnosedConditions,
                      ]) {
                        if (!seen.has(entry)) {
                          seen.add(entry);
                          conditionsList.push(entry);
                        }
                      }
                    } else if (treatsChildren) {
                      conditionsList = childDiagnosedConditions;
                    } else if (treatsAdults) {
                      conditionsList = adultDiagnosedConditions;
                    }

                    return conditionsList.length > 0 ? (
                      conditionsList.map((item) => (
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
                          {translateFromMap(item, problematicsMap, locale)}
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground col-span-3">
                        {t("step3.selectAgeCategoryFirst")}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Additional Information */}
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

              {/* Years of Experience */}
              <div>
                <Label
                  htmlFor="yearsOfExperience"
                  className="font-light mb-3 text-base"
                >
                  {t("step4.yearsExp")}
                  <span className="text-primary ml-1">
                    {t("step4.yearsExpRequired")}
                  </span>
                </Label>
                <Input
                  id="yearsOfExperience"
                  name="yearsOfExperience"
                  type="number"
                  min="0"
                  value={formData.yearsOfExperience}
                  onChange={handleChange}
                  className="max-w-xs"
                  placeholder={t("step4.yearsPlaceholder")}
                />
              </div>

              {/* Skills */}
              <div>
                <Label className="font-light mb-3 text-base">
                  {t("step4.additionalSkills")}
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step4.additionalSkillsDesc")}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {skillOptions.map(({ value, labelKey }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleMultiSelect("skills", value)}
                      className={`rounded-lg px-4 py-3 text-sm font-light text-left transition-all ${
                        formData.skills.includes(value)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-muted"
                      }`}
                    >
                      {t(`step4.skillLabels.${labelKey}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Specialty & License */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div className="space-y-2">
                  <Label htmlFor="specialty" className="font-light text-base">
                    {t("step4.specialty")}
                    <span className="text-primary ml-1">{t("step4.specialtyRequired")}</span>
                  </Label>
                  <Input
                    id="specialty"
                    name="specialty"
                    value={formData.specialty}
                    onChange={handleChange}
                    placeholder={t("step4.specialtyPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="license" className="font-light text-base">
                    {t("step4.license")}
                    <span className="text-primary ml-1">{t("step4.licenseRequired")}</span>
                  </Label>
                  <Input
                    id="license"
                    name="license"
                    value={formData.license}
                    onChange={handleChange}
                    placeholder={t("step4.licensePlaceholder")}
                  />
                </div>
              </div>

              {/* Professional Bio */}
              <div>
                <Label htmlFor="bio" className="font-light mb-3 text-base">
                  {t("step4.bio")}
                  <span className="text-primary ml-1">
                    {t("step4.bioRequired")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground font-light mb-4">
                  {t("step4.subtitle")}
                </p>
                <textarea
                  id="bio"
                  name="bio"
                  value={formData.bio}
                  onChange={handleChange}
                  rows={6}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y"
                  placeholder={t("step4.bioPlaceholder")}
                />
              </div>
            </div>
          )}

          {/* Step 5: Professional credentials & Services */}
          {currentStep === 4 && (
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-light text-foreground mb-6">{t("step5.title")}</h3>
                
                {/* Languages */}
                <div className="space-y-3 mb-8">
                  <Label>{t("step5.languages")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {
                      [
                        { value: "Français", labelKey: "french" },
                        { value: "Anglais", labelKey: "english" },
                        { value: "Arabe", labelKey: "arabic" },
                        { value: "Espagnol", labelKey: "spanish" },
                        { value: "Chinois", labelKey: "chinese" },
                        { value: "Autre", labelKey: "other" },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleMultiSelect("languages", opt.value)}
                          className={`rounded-full px-4 py-1.5 text-sm font-light transition-all ${
                            formData.languages.includes(opt.value)
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground hover:bg-muted/80"
                          }`}
                        >
                          {t(`step5.languagesList.${opt.labelKey}`)}
                        </button>
                      ))
                    }
                  </div>
                </div>

                {/* Education */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center justify-between">
                    <Label>{t("step5.education")}</Label>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 text-primary" 
                      onClick={() => setFormData({...formData, education: [...formData.education, { degree: "", institution: "", year: "" }]})}
                    >
                      {t("step5.addEducation")}
                    </Button>
                  </div>
                  {formData.education.map((edu, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-muted/20 rounded-xl relative group">
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase text-muted-foreground font-semibold">{t("step5.degree")}</span>
                        <Input 
                          placeholder={t("step5.degreePlaceholder")} 
                          value={edu.degree} 
                          onChange={(e) => {
                            const newEdu = [...formData.education];
                            newEdu[idx].degree = e.target.value;
                            setFormData({...formData, education: newEdu});
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase text-muted-foreground font-semibold">{t("step5.institution")}</span>
                        <Input 
                          placeholder={t("step5.institutionPlaceholder")} 
                          value={edu.institution} 
                          onChange={(e) => {
                            const newEdu = [...formData.education];
                            newEdu[idx].institution = e.target.value;
                            setFormData({...formData, education: newEdu});
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase text-muted-foreground font-semibold">{t("step5.year")}</span>
                        <Input 
                          type="number" 
                          placeholder="2015" 
                          value={edu.year} 
                          onChange={(e) => {
                            const newEdu = [...formData.education];
                            newEdu[idx].year = e.target.value;
                            setFormData({...formData, education: newEdu});
                          }}
                        />
                      </div>
                      {formData.education.length > 1 && (
                        <button 
                          type="button"
                          className="absolute -top-2 -right-2 bg-red-100 text-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => {
                            const newEdu = formData.education.filter((_, i) => i !== idx);
                            setFormData({...formData, education: newEdu});
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <hr className="border-border/40 my-8" />

                {/* Session Types & Modalities */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <Label>{t("step5.sessionTypes")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "Solo", labelKey: "solo" },
                        { value: "Couple", labelKey: "couple" },
                        { value: "Famille", labelKey: "family" },
                        { value: "Groupe", labelKey: "group" },
                        { value: "Coaching", labelKey: "coaching" },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleMultiSelect("sessionTypes", opt.value)}
                          className={`rounded-lg px-4 py-2 text-sm font-light transition-all ${
                            formData.sessionTypes.includes(opt.value)
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-muted/50 text-foreground border border-transparent"
                          }`}
                        >
                          {t(`step5.sessionTypesList.${opt.labelKey}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>{t("step5.modalities")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "Vidéo", labelKey: "video" },
                        { value: "Chat", labelKey: "chat" },
                        { value: "En personne", labelKey: "inPerson" },
                        { value: "Téléphone", labelKey: "phone" },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleMultiSelect("modalities", opt.value)}
                          className={`rounded-lg px-4 py-2 text-sm font-light transition-all ${
                            formData.modalities.includes(opt.value)
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-muted/50 text-foreground border border-transparent"
                          }`}
                        >
                          {t(`step5.modalitiesList.${opt.labelKey}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Pricing */}
                <div className="mt-8 space-y-4">
                  <Label>{t("step5.pricing")}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
                        <Label className="text-xs font-semibold uppercase text-primary/70">{t("step5.individualSession")}</Label>
                        <Input 
                            type="number" 
                            value={formData.pricing.individualSession}
                            onChange={(e) => setFormData({...formData, pricing: {...formData.pricing, individualSession: parseFloat(e.target.value) || 0}})}
                        />
                    </div>
                    <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
                        <Label className="text-xs font-semibold uppercase text-primary/70">{t("step5.coupleSession")}</Label>
                        <Input 
                            type="number" 
                            value={formData.pricing.coupleSession}
                            onChange={(e) => setFormData({...formData, pricing: {...formData.pricing, coupleSession: parseFloat(e.target.value) || 0}})}
                        />
                    </div>
                    <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
                        <Label className="text-xs font-semibold uppercase text-primary/70">{t("step5.groupSession")}</Label>
                        <Input 
                            type="number" 
                            value={formData.pricing.groupSession}
                            onChange={(e) => setFormData({...formData, pricing: {...formData.pricing, groupSession: parseFloat(e.target.value) || 0}})}
                        />
                    </div>
                  </div>
                </div>

                {/* Certifications */}
                <div className="mt-8 space-y-3">
                  <Label>{t("step5.certifications")}</Label>
                  <Input 
                    placeholder={t("step5.certPlaceholder")} 
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const val = e.currentTarget.value.trim();
                        if (val && !formData.certifications.includes(val)) {
                          setFormData({...formData, certifications: [...formData.certifications, val]});
                          e.currentTarget.value = "";
                        }
                      }
                    }}
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.certifications.map(cert => (
                      <span key={cert} className="px-3 py-1 bg-green-50 text-green-700 text-xs rounded-full border border-green-200 flex items-center gap-1">
                        {cert}
                        <button onClick={() => setFormData({...formData, certifications: formData.certifications.filter(c => c !== cert)})}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
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
