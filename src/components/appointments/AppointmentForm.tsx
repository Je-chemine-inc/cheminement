"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MotifSearch } from "@/components/ui/MotifSearch";
import { Upload, X } from "lucide-react";

export interface AppointmentFormProps {
  userType: "client" | "professional" | "lovedOne";
  userInfo?: Partial<{
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth: string;
    gender: string;
    language: string;
    phone: string;
    location: string;
  }>;
  onSubmit: (formData: any) => void;
  disabledFields?: string[];
  initialValues?: Record<string, any>;
}

interface FormData {
  // Common fields
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  language: string;
  location: string;
  selectedMotifs: string[];
  message: string;
  // Client-specific
  gender: string;
  modality: string;
  sessionType: string;
  availability: string[];
  // Professional-specific
  referrerName: string;
  referrerPhone: string;
  referrerEmail: string;
  patientName: string;
  patientFirstName: string;
  patientDOB: string;
  patientPhone: string;
  patientEmail: string;
  approaches: string[];
  uploadedFile: File | null;
  // Loved One-specific
  requesterRelationship: string;
  clientDOB: string;
  clientLocation: string;
  clientLanguage: string;
}

const AppointmentForm = ({
  userType,
  userInfo,
  onSubmit,
  disabledFields = [],
  initialValues = {},
}: AppointmentFormProps) => {
  const t = useTranslations("AppointmentForm");
  const tCommon = useTranslations("Auth.memberSignup");
  const [formData, setFormData] = useState<FormData>({
    // Common fields
    firstName: userInfo?.firstName || initialValues.firstName || "",
    lastName: userInfo?.lastName || initialValues.lastName || "",
    email: userInfo?.email || initialValues.email || "",
    phone: userInfo?.phone || initialValues.phone || "",
    dateOfBirth: userInfo?.dateOfBirth || initialValues.dateOfBirth || "",
    language: userInfo?.language || initialValues.language || "FR",
    location: userInfo?.location || initialValues.location || "",
    selectedMotifs: initialValues.motifs || [],
    message: initialValues.message || "",
    // Client-specific
    gender: userInfo?.gender || initialValues.gender || "",
    modality: initialValues.modality || "in-person",
    sessionType: initialValues.sessionType || "individual",
    availability: initialValues.availability || [],
    // Professional-specific
    referrerName: initialValues.referrerName || "",
    referrerPhone: initialValues.referrerPhone || "",
    referrerEmail: initialValues.referrerEmail || "",
    patientName: initialValues.patientName || "",
    patientFirstName: initialValues.patientFirstName || "",
    patientDOB: initialValues.patientDOB || "",
    patientPhone: initialValues.patientPhone || "",
    patientEmail: initialValues.patientEmail || "",
    approaches: initialValues.approaches || [],
    uploadedFile: null,
    // Loved One-specific
    requesterRelationship: initialValues.requesterRelationship || "",
    clientDOB: initialValues.clientDOB || "",
    clientLocation: initialValues.clientLocation || "",
    clientLanguage: initialValues.clientLanguage || "FR",
  });

  // Helper function to update form data
  const updateField = (key: keyof FormData, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  // Check if field is disabled
  const isDisabled = (fieldName: string) => disabledFields.includes(fieldName);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      updateField("uploadedFile", e.target.files[0]);
    }
  };

  const removeFile = () => {
    updateField("uploadedFile", null);
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const submitData: any = {
      userType,
      ...formData,
    };

    onSubmit(submitData);
  };

  // CLIENT FORM
  if (userType === "client") {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Identity Section */}
          <div>
            <Label htmlFor="firstName">{tCommon("firstName")}</Label>
            <Input
              id="firstName"
              placeholder={tCommon("firstNamePlaceholder")}
              value={formData.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
              disabled={isDisabled("firstName")}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">{tCommon("lastName")}</Label>
            <Input
              id="lastName"
              placeholder={tCommon("lastNamePlaceholder")}
              value={formData.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              disabled={isDisabled("lastName")}
              required
            />
          </div>
          <div>
            <Label htmlFor="dob">{tCommon("dateOfBirth")}</Label>
            <Input
              id="dob"
              type="date"
              value={formData.dateOfBirth}
              onChange={(e) => updateField("dateOfBirth", e.target.value)}
              disabled={isDisabled("dateOfBirth")}
              required
            />
          </div>
          <div>
            <Label htmlFor="gender">{tCommon("gender")}</Label>
            <Select
              value={formData.gender}
              onValueChange={(value) => updateField("gender", value)}
            >
              <SelectTrigger disabled={isDisabled("gender")}>
                <SelectValue placeholder={tCommon("selectGender")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">{tCommon("male")}</SelectItem>
                <SelectItem value="F">{tCommon("female")}</SelectItem>
                <SelectItem value="Other">{tCommon("other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="language">{tCommon("language")}</Label>
            <Select
              value={formData.language}
              onValueChange={(value) => updateField("language", value)}
            >
              <SelectTrigger disabled={isDisabled("language")}>
                <SelectValue placeholder={tCommon("selectLanguage")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FR">{tCommon("french")}</SelectItem>
                <SelectItem value="EN">{tCommon("english")}</SelectItem>
                <SelectItem value="ES">{tCommon("spanish")}</SelectItem>
                <SelectItem value="AR">{tCommon("arabic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="location">{tCommon("location")}</Label>
            <Input
              id="location"
              placeholder={tCommon("locationPlaceholder")}
              value={formData.location}
              onChange={(e) => updateField("location", e.target.value)}
              disabled={isDisabled("location")}
              required
            />
          </div>
        </div>

        {/* Modality Section */}
        <div>
          <Label>Modalité</Label>
          <RadioGroup
            value={formData.modality}
            onValueChange={(value) => updateField("modality", value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="in-person" id="in-person" />
              <Label htmlFor="in-person">Présentiel</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="remote" id="remote" />
              <Label htmlFor="remote">À distance</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="both" id="both" />
              <Label htmlFor="both">Ouvert aux deux</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Session Type */}
        <div>
          <Label htmlFor="sessionType">Pour</Label>
          <Select
            value={formData.sessionType}
            onValueChange={(value) => updateField("sessionType", value)}
          >
            <SelectTrigger id="sessionType">
              <SelectValue placeholder="Sélectionner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Individuel</SelectItem>
              <SelectItem value="couple">Couple</SelectItem>
              <SelectItem value="family">Famille</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Motif Search */}
        <div>
          <Label>Motif de Consultation</Label>
          <MotifSearch
            value={formData.selectedMotifs[0] || ""}
            onChange={(value) => {
              const motifs = Array.isArray(value) ? value : value ? [value] : [];
              updateField("selectedMotifs", motifs);
            }}
            placeholder="Tapez vos motifs ex: anxiété, burnout..."
          />
        </div>

        {/* Message */}
        <div>
          <Label htmlFor="message">Message</Label>
          <Textarea
            id="message"
            placeholder="Message ou détails additionnels"
            value={formData.message}
            onChange={(e) => updateField("message", e.target.value)}
            rows={4}
          />
        </div>

        <Button type="submit" className="w-full">
          Soumettre
        </Button>
      </form>
    );
  }

  // PROFESSIONAL FORM
  if (userType === "professional") {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Referrer Section */}
        <div className="border-b pb-6">
          <h3 className="font-semibold mb-4">{t("referrerSection")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="referrerName">{tCommon("lastName")}</Label>
              <Input
                id="referrerName"
                placeholder={t("professionalName")}
                value={formData.referrerName}
                onChange={(e) => updateField("referrerName", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="referrerFirstName">{tCommon("firstName")}</Label>
              <Input
                id="referrerFirstName"
                placeholder={tCommon("firstNamePlaceholder")}
                value={formData.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="referrerPhone">{tCommon("phone")} ({t("optional")})</Label>
              <Input
                id="referrerPhone"
                type="tel"
                placeholder={tCommon("phonePlaceholder")}
                value={formData.referrerPhone}
                onChange={(e) => updateField("referrerPhone", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="referrerEmail">{tCommon("email")} ({t("optional")})</Label>
              <Input
                id="referrerEmail"
                type="email"
                placeholder={tCommon("emailPlaceholder")}
                value={formData.referrerEmail}
                onChange={(e) => updateField("referrerEmail", e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Patient Section */}
        <div className="border-b pb-6">
          <h3 className="font-semibold mb-4">{t("patientSection")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="patientName">{tCommon("lastName")}</Label>
              <Input
                id="patientName"
                placeholder={t("patientName")}
                value={formData.patientName}
                onChange={(e) => updateField("patientName", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="patientFirstName">{tCommon("firstName")}</Label>
              <Input
                id="patientFirstName"
                placeholder={tCommon("firstNamePlaceholder")}
                value={formData.patientFirstName}
                onChange={(e) =>
                  updateField("patientFirstName", e.target.value)
                }
                required
              />
            </div>
            <div>
              <Label htmlFor="patientDOB">Date de naissance</Label>
              <Input
                id="patientDOB"
                type="date"
                value={formData.patientDOB}
                onChange={(e) => updateField("patientDOB", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="patientPhone">{t("phoneOrEmail")}</Label>
              <Input
                id="patientPhone"
                placeholder={t("phoneOrEmail")}
                value={formData.patientPhone}
                onChange={(e) => updateField("patientPhone", e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Document Upload */}
        <div className="border-b pb-6">
          <Label>Document - Requête PDF</Label>
          <div className="mt-2 border-2 border-dashed rounded-lg p-6 text-center">
            {formData.uploadedFile ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {formData.uploadedFile.name}
                </span>
                <button
                  type="button"
                  onClick={removeFile}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="cursor-pointer">
                <div className="flex justify-center mb-2">
                  <Upload className="h-8 w-8 text-gray-400" />
                </div>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                  required
                />
                <p className="text-sm text-gray-600">
                  Cliquez pour télécharger
                </p>
              </label>
            )}
          </div>
        </div>

        <Button type="submit" className="w-full">
          Envoyer la demande
        </Button>
      </form>
    );
  }

  // LOVED ONE FORM
  if (userType === "lovedOne") {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Requester Section */}
        <div className="border-b pb-6">
          <h3 className="font-semibold mb-4">Le Demandeur</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="requesterFirstName">Prénom</Label>
              <Input
                id="requesterFirstName"
                placeholder="Votre prénom"
                value={formData.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                disabled={isDisabled("firstName")}
                required
              />
            </div>
            <div>
              <Label htmlFor="requesterLastName">Nom</Label>
              <Input
                id="requesterLastName"
                placeholder="Votre nom"
                value={formData.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                disabled={isDisabled("lastName")}
                required
              />
            </div>
            <div>
              <Label htmlFor="relationship">Lien de parenté</Label>
              <Select
                value={formData.requesterRelationship}
                onValueChange={(value) =>
                  updateField("requesterRelationship", value)
                }
              >
                <SelectTrigger id="relationship">
                  <SelectValue placeholder={tCommon("select")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">{tCommon("parent")}</SelectItem>
                  <SelectItem value="spouse">{tCommon("spouse")}</SelectItem>
                  <SelectItem value="sibling">{tCommon("sibling")}</SelectItem>
                  <SelectItem value="other">{tCommon("other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Client Section */}
        <div className="border-b pb-6">
          <h3 className="font-semibold mb-4">{t("clientSection")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="clientFirstName">{tCommon("firstName")}</Label>
              <Input
                id="clientFirstName"
                placeholder={tCommon("firstNamePlaceholder")}
                value={formData.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="clientLastName">{tCommon("lastName")}</Label>
              <Input
                id="clientLastName"
                placeholder={tCommon("lastNamePlaceholder")}
                value={formData.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="clientDOB">{tCommon("dateOfBirth")}</Label>
              <Input
                id="clientDOB"
                type="date"
                value={formData.clientDOB}
                onChange={(e) => updateField("clientDOB", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="clientLocation">{tCommon("location")}</Label>
              <Input
                id="clientLocation"
                placeholder={tCommon("locationPlaceholder")}
                value={formData.clientLocation}
                onChange={(e) => updateField("clientLocation", e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="clientLanguage">{tCommon("language")}</Label>
              <Select
                value={formData.clientLanguage}
                onValueChange={(value) => updateField("clientLanguage", value)}
              >
                <SelectTrigger id="clientLanguage">
                  <SelectValue placeholder={tCommon("selectLanguage")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FR">{tCommon("french")}</SelectItem>
                  <SelectItem value="EN">{tCommon("english")}</SelectItem>
                  <SelectItem value="ES">{tCommon("spanish")}</SelectItem>
                  <SelectItem value="AR">{tCommon("arabic")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Modality */}
        <div>
          <Label>Modalité</Label>
          <RadioGroup
            value={formData.modality}
            onValueChange={(value) => updateField("modality", value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="in-person" id="loved-in-person" />
              <Label htmlFor="loved-in-person">Présentiel</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="remote" id="loved-remote" />
              <Label htmlFor="loved-remote">À distance</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="both" id="loved-both" />
              <Label htmlFor="loved-both">Ouvert aux deux</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Session Type */}
        <div>
          <Label htmlFor="sessionType">Type de suivi</Label>
          <Select
            value={formData.sessionType}
            onValueChange={(value) => updateField("sessionType", value)}
          >
            <SelectTrigger id="sessionType">
              <SelectValue placeholder="Sélectionner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Individuel</SelectItem>
              <SelectItem value="family">Familial</SelectItem>
              <SelectItem value="couple">Couple</SelectItem>
              <SelectItem value="evaluation">Évaluation</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Motif Search */}
        <div>
          <Label>Motif de Consultation</Label>
          <MotifSearch
            value={formData.selectedMotifs[0] || ""}
            onChange={(value) => {
              const motifs = Array.isArray(value) ? value : value ? [value] : [];
              updateField("selectedMotifs", motifs);
            }}
            placeholder="Tapez vos motifs ex: anxiété, burnout..."
          />
        </div>

        {/* Message */}
        <div>
          <Label htmlFor="message">Message</Label>
          <Textarea
            id="message"
            placeholder="Précisions additionnelles"
            value={formData.message}
            onChange={(e) => updateField("message", e.target.value)}
            rows={4}
          />
        </div>

        <Button type="submit" className="w-full">
          Soumettre
        </Button>
      </form>
    );
  }

  return null;
};

export default AppointmentForm;
