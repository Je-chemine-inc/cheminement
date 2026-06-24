"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { usersAPI } from "@/lib/api-client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CitySearch } from "@/components/ui/CitySearch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  X,
  UserCheck,
} from "lucide-react";
import { IUser } from "@/models/User";
import { Badge } from "@/components/ui/badge";

interface BasicInformationProps {
  isEditable?: boolean;
  userId?: string;
  user?: IUser;
}

export default function BasicInformation({
  isEditable = true,
  userId,
  user: userProp,
}: BasicInformationProps) {
  const t = useTranslations("BasicInformation");
  const [user, setUser] = useState<IUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalData, setModalData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    location: "",
    dateOfBirth: "",
    gender: "",
    language: "",
  });

  const fetchUser = useCallback(async () => {
    try {
      setIsLoading(true);
      const userData = userId
        ? await usersAPI.getById(userId)
        : await usersAPI.get();
      setUser(userData as IUser);
    } catch (error) {
      console.error("Error fetching user:", error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userProp) {
      setUser(userProp);
      setIsLoading(false);
    } else {
      fetchUser();
    }
  }, [fetchUser, userProp]);

  const handleOpenModal = () => {
    if (!user) return;

    setModalData({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      location: user.location || "",
      dateOfBirth: user.dateOfBirth?.toString() || "",
      gender: user.gender || "",
      language: user.language || "",
    });
    setIsModalOpen(true);
  };

  const handleModalChange = (field: string, value: string) => {
    setModalData((prev) => ({ ...prev, [field]: value }));
  };

  const handleModalSave = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      // Build update object with only changed fields
      const updates: Record<string, string> = {};

      if (modalData.firstName !== user.firstName) {
        updates.firstName = modalData.firstName;
      }
      if (modalData.lastName !== user.lastName) {
        updates.lastName = modalData.lastName;
      }
      if (modalData.phone !== user.phone) {
        updates.phone = modalData.phone;
      }
      if (modalData.location !== user.location) {
        updates.location = modalData.location;
      }
      if (
        modalData.dateOfBirth !== user.dateOfBirth?.toString().split("T")[0]
      ) {
        updates.dateOfBirth = modalData.dateOfBirth;
      }
      if (modalData.gender !== user.gender) {
        updates.gender = modalData.gender;
      }
      if (modalData.language !== user.language) {
        updates.language = modalData.language;
      }

      // Update via API
      if (Object.keys(updates).length > 0) {
        if (userId) {
          await usersAPI.updateById(userId, updates);
        } else {
          await usersAPI.update(updates);
        }
        await fetchUser();
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const isProfileIncomplete = () => {
    if (!user) return true;

    return (
      !user.firstName ||
      !user.lastName ||
      !user.phone ||
      !user.location ||
      !user.dateOfBirth ||
      !user.gender ||
      !user.language
    );
  };

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return t("notAvailable");
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString();
  };

  const formatLanguage = (lang: string | undefined) => {
    if (!lang) return t("notAvailable");
    switch (lang) {
      case "en":
        return t("languages.en");
      case "fr":
        return t("languages.fr");
      default:
        return lang;
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">{t("noData")}</p>
        </div>
      </div>
    );
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "guest":
        return (
          <Badge variant="secondary" className="ml-2">
            {t("roles.guest")}
          </Badge>
        );
      case "client":
        return (
          <Badge variant="default" className="ml-2">
            {t("roles.client")}
          </Badge>
        );
      case "professional":
        return (
          <Badge variant="outline" className="ml-2">
            {t("roles.professional")}
          </Badge>
        );
      case "admin":
        return (
          <Badge variant="destructive" className="ml-2">
            {t("roles.admin")}
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="rounded-xl bg-card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <h2 className="text-xl font-serif font-light text-foreground">
              {t("title")}
            </h2>
            {user.role && getRoleBadge(user.role)}
          </div>
          {isEditable && (
            <Button
              onClick={handleOpenModal}
              variant="outline"
              size="sm"
              className="text-sm"
            >
              {isProfileIncomplete() ? t("completeProfile") : t("edit")}
            </Button>
          )}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              {t("firstName")}
            </Label>
            <p className="text-foreground">{user.firstName || t("notAvailable")}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              {t("lastName")}
            </Label>
            <p className="text-foreground">{user.lastName || t("notAvailable")}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {t("email")}
            </Label>
            <p className="text-foreground">{user.email || t("notAvailable")}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {t("phone")}
            </Label>
            <p className="text-foreground">{user.phone || t("notAvailable")}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {t("location")}
            </Label>
            <p className="text-foreground">{user.location || t("notAvailable")}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {t("dateOfBirth")}
            </Label>
            <p className="text-foreground">{formatDate(user.dateOfBirth)}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light">{t("gender")}</Label>
            <p className="text-foreground">{user.gender || t("notAvailable")}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light">{t("language")}</Label>
            <p className="text-foreground">{formatLanguage(user.language)}</p>
          </div>

          <div className="space-y-2">
            <Label className="font-light flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              {t("accountType")}
            </Label>
            <p className="text-foreground capitalize">{user.role || t("notAvailable")}</p>
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl m-4">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-background border-b border-border/40 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-serif font-light text-foreground">
                  {t("completeProfileTitle")}
                </h2>
                <p className="text-sm text-muted-foreground font-light mt-1">
                  {t("subtitle")}
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-full hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-8">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="modal-firstName" className="font-light">
                    {t("firstName")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="modal-firstName"
                    type="text"
                    value={modalData.firstName}
                    onChange={(e) =>
                      handleModalChange("firstName", e.target.value)
                    }
                    placeholder={t("firstName")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modal-lastName" className="font-light">
                    {t("lastName")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="modal-lastName"
                    type="text"
                    value={modalData.lastName}
                    onChange={(e) =>
                      handleModalChange("lastName", e.target.value)
                    }
                    placeholder={t("lastName")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modal-phone" className="font-light">
                    {t("phone")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="modal-phone"
                    type="tel"
                    value={modalData.phone}
                    onChange={(e) => handleModalChange("phone", e.target.value)}
                    placeholder={t("phone")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modal-location" className="font-light">
                    {t("location")} <span className="text-red-500">*</span>
                  </Label>
                  <CitySearch
                    id="modal-location"
                    value={modalData.location}
                    onChange={(v) => handleModalChange("location", v)}
                    placeholder={t("location")}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modal-dateOfBirth" className="font-light">
                    {t("dateOfBirth")} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="modal-dateOfBirth"
                    type="date"
                    value={modalData.dateOfBirth}
                    onChange={(e) =>
                      handleModalChange("dateOfBirth", e.target.value)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modal-gender" className="font-light">
                    {t("gender")} <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={modalData.gender}
                    onValueChange={(value) =>
                      handleModalChange("gender", value)
                    }
                  >
                    <SelectTrigger id="modal-gender">
                      <SelectValue placeholder={t("gender")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">{t("male")}</SelectItem>
                      <SelectItem value="Female">{t("female")}</SelectItem>
                      <SelectItem value="Other">{t("other")}</SelectItem>
                      <SelectItem value="Prefer not to say">
                        {t("preferNotToSay")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modal-language" className="font-light">
                    {t("language")} <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={modalData.language}
                    onValueChange={(value) =>
                      handleModalChange("language", value)
                    }
                  >
                    <SelectTrigger id="modal-language">
                      <SelectValue placeholder={t("language")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("languages.en")}</SelectItem>
                      <SelectItem value="fr">{t("languages.fr")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isSaving}
                className="px-6 py-3 text-foreground font-light transition-colors hover:text-muted-foreground disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleModalSave}
                disabled={
                  isSaving || !modalData.firstName || !modalData.lastName
                }
                className="px-8 py-3 bg-primary text-primary-foreground rounded-full font-light tracking-wide transition-all duration-300 hover:scale-105 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isSaving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
