"use client";

import { X, Calendar, Check, X as XIcon, Video } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BasicInformation from "./BasicInformation";
import MedicalProfile from "./MedicalProfile";
import { appointmentsAPI } from "@/lib/api-client";
import { useMemo, useState } from "react";
import { AppointmentResponse } from "@/types/api";
import { useLocale, useTranslations } from "next-intl";
import { useMotifs, buildMotifLabelResolver } from "@/hooks/useMotifs";
import { AvailabilitySlots } from "@/components/appointments/AvailabilitySlots";

interface AppointmentDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: AppointmentResponse | null;
  onAction?: () => void;
}

export default function AppointmentDetailsModal({
  isOpen,
  onClose,
  appointment,
  onAction,
}: AppointmentDetailsModalProps) {
  const t = useTranslations("Professional.proposals.modal");
  const locale = useLocale();
  const [meetingLink, setMeetingLink] = useState("");
  const [showMeetingLinkInput, setShowMeetingLinkInput] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { motifs } = useMotifs();
  // Stored motifs are persisted in the locale the client booked in — normalize
  // every displayed label back to the active locale.
  const resolveMotifLabel = useMemo(
    () => buildMotifLabelResolver(motifs, locale),
    [motifs, locale],
  );

  if (!isOpen || !appointment) return null;

  // Problématique / motifs: prefer the full `needs` list, fall back to the
  // single `issueType` (the table folds in the referral reason separately).
  const motifsDisplay =
    appointment.needs && appointment.needs.length > 0
      ? appointment.needs.map((n) => resolveMotifLabel(n)).join(", ")
      : appointment.issueType
        ? resolveMotifLabel(appointment.issueType)
        : t("notAvailable");

  const therapyTypeLabel = appointment.therapyType
    ? t(`therapyType.${appointment.therapyType}`)
    : t("notAvailable");

  const bookingForKey =
    appointment.bookingFor === "loved-one"
      ? "lovedOne"
      : appointment.bookingFor === "patient"
        ? "patient"
        : "self";
  const bookingForLabel = appointment.bookingFor
    ? t(`bookingFor.${bookingForKey}`)
    : null;

  const typeKeyMap: Record<string, string> = {
    video: "video",
    "in-person": "inPerson",
    phone: "phone",
    both: "both",
  };

  const statusKeyMap: Record<string, string> = {
    pending: "pending",
    scheduled: "scheduled",
    cancelled: "cancelled",
    completed: "completed",
    "no-show": "noShow",
  };

  const getTypeLabel = (type: AppointmentResponse["type"] | undefined) => {
    if (!type) return t("notAvailable");
    const key = typeKeyMap[type];
    return key ? t(`sessionType.${key}`) : type;
  };

  const getStatusLabel = (status: AppointmentResponse["status"]) => {
    const key = statusKeyMap[status];
    return key ? t(`status.${key}`) : status;
  };

  const getTypeBadge = (type: AppointmentResponse["type"] | undefined) => {
    if (!type) return null;
    const styles: Record<string, string> = {
      video: "bg-blue-100 text-blue-700",
      "in-person": "bg-green-100 text-green-700",
      phone: "bg-purple-100 text-purple-700",
      both: "bg-amber-100 text-amber-800",
    };

    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-light ${styles[type] ?? "bg-muted text-muted-foreground"}`}
      >
        {getTypeLabel(type)}
      </span>
    );
  };

  const getStatusBadge = (status: AppointmentResponse["status"]) => {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-light`}>
        {getStatusLabel(status)}
      </span>
    );
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return t("toBeScheduled");
    const date = new Date(dateString);
    return date.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl m-4">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-serif">
              {appointment.clientId.firstName.charAt(0)}
            </div>
            <div>
              <h2 className="text-2xl font-serif font-light text-foreground">
                {appointment.clientId.firstName} {appointment.clientId.lastName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {getTypeBadge(appointment.type)}
                {getStatusBadge(appointment.status)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <Tabs defaultValue="appointment-details" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-3">
              <TabsTrigger
                value="appointment-details"
                className="h-auto whitespace-normal px-1 py-1.5 text-center text-xs leading-tight sm:text-sm"
              >
                {t("tabs.appointmentDetails")}
              </TabsTrigger>
              <TabsTrigger
                value="basic-info"
                className="h-auto whitespace-normal px-1 py-1.5 text-center text-xs leading-tight sm:text-sm"
              >
                {t("tabs.basicInfo")}
              </TabsTrigger>
              <TabsTrigger
                value="medical-info"
                className="h-auto whitespace-normal px-1 py-1.5 text-center text-xs leading-tight sm:text-sm"
              >
                {t("tabs.medicalInfo")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="appointment-details" className="space-y-6 mt-6">
              {/* Appointment Details */}
              <div className="rounded-xl bg-card p-6 border border-border/40">
                <h3 className="text-lg font-serif font-light text-foreground mb-4 flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  {t("sectionTitle")}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("date")}
                      </p>
                      <p className="text-sm text-foreground font-light">
                        {formatDate(appointment.date)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("time")}
                      </p>
                      <p className="text-sm text-foreground font-light">
                        {appointment.time || t("toBeScheduled")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("duration")}
                      </p>
                      <p className="text-sm text-foreground font-light">
                        {t("minutes", { count: appointment.duration })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("therapyTypeLabel")}
                      </p>
                      <p className="text-sm text-foreground font-light">
                        {therapyTypeLabel}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("type")}
                      </p>
                      <p className="text-sm text-foreground font-light">
                        {getTypeLabel(appointment.type)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("issueType")}
                      </p>
                      <p className="text-sm text-foreground font-light">
                        {motifsDisplay}
                      </p>
                    </div>
                    {bookingForLabel && (
                      <div>
                        <p className="text-xs text-muted-foreground font-light mb-1">
                          {t("bookingForLabel")}
                        </p>
                        <p className="text-sm text-foreground font-light">
                          {bookingForLabel}
                          {appointment.bookingFor === "loved-one" &&
                            appointment.lovedOneInfo?.firstName &&
                            ` · ${appointment.lovedOneInfo.firstName}`}
                        </p>
                      </div>
                    )}
                    {appointment.location && (
                      <div>
                        <p className="text-xs text-muted-foreground font-light mb-1">
                          {t("location")}
                        </p>
                        <p className="text-sm text-foreground font-light">
                          {appointment.location}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-6 pt-6 border-t border-border/40">
                  <p className="text-xs text-muted-foreground font-light mb-2">
                    {t("preferredAvailability")}
                  </p>
                  <AvailabilitySlots
                    slots={appointment.preferredAvailability}
                    emptyLabel={t("flexible")}
                  />
                </div>
                {appointment.bookingFor === "patient" &&
                  appointment.referralInfo &&
                  (appointment.referralInfo.referrerName ||
                    appointment.referralInfo.referralReason ||
                    (appointment.referralInfo.desiredApproaches?.length ??
                      0) > 0) && (
                    <div className="mt-6 pt-6 border-t border-border/40 space-y-3">
                      {appointment.referralInfo.referrerName && (
                        <div>
                          <p className="text-xs text-muted-foreground font-light mb-1">
                            {t("referredBy")}
                          </p>
                          <p className="text-sm text-foreground font-light">
                            {appointment.referralInfo.referrerName}
                          </p>
                        </div>
                      )}
                      {appointment.referralInfo.referralReason && (
                        <div>
                          <p className="text-xs text-muted-foreground font-light mb-1">
                            {t("referralReason")}
                          </p>
                          <p className="text-sm text-foreground font-light leading-relaxed">
                            {appointment.referralInfo.referralReason}
                          </p>
                        </div>
                      )}
                      {appointment.referralInfo.desiredApproaches &&
                        appointment.referralInfo.desiredApproaches.length >
                          0 && (
                          <div>
                            <p className="text-xs text-muted-foreground font-light mb-1">
                              {t("desiredApproaches")}
                            </p>
                            <p className="text-sm text-foreground font-light leading-relaxed">
                              {appointment.referralInfo.desiredApproaches.join(
                                ", ",
                              )}
                            </p>
                          </div>
                        )}
                    </div>
                  )}
                {appointment.notes && (
                  <div className="mt-6 pt-6 border-t border-border/40">
                    <p className="text-xs text-muted-foreground font-light mb-2">
                      {t("notes")}
                    </p>
                    <p className="text-sm text-foreground font-light leading-relaxed">
                      {appointment.notes}
                    </p>
                  </div>
                )}
                {appointment.meetingLink && (
                  <div className="mt-6 pt-6 border-t border-border/40">
                    <p className="text-xs text-muted-foreground font-light mb-2">
                      {t("meetingLink")}
                    </p>
                    <a
                      href={appointment.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary font-light hover:underline"
                    >
                      {appointment.meetingLink}
                    </a>
                  </div>
                )}
                {appointment.referralInfo?.documentUrl && (
                  <div className="mt-6 pt-6 border-t border-border/40">
                    <p className="text-xs text-muted-foreground font-light mb-2">
                      {t("referralDocument")}
                    </p>
                    <a
                      href={appointment.referralInfo.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary font-light hover:underline break-all"
                    >
                      {appointment.referralInfo.documentName ||
                        t("referralDocument")}
                    </a>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-6 border-t border-border/40">
                <Button
                  onClick={onClose}
                  variant="outline"
                  className="rounded-full"
                >
                  {t("close")}
                </Button>
                {appointment.status === "pending" && (
                  <>
                    <Button
                      onClick={async () => {
                        try {
                          await appointmentsAPI.update(appointment._id, {
                            status: "cancelled",
                          });
                          onClose();
                          onAction?.();
                        } catch (error) {
                          console.error("Error denying appointment:", error);
                        }
                      }}
                      variant="destructive"
                      className="gap-2 rounded-full"
                    >
                      <XIcon className="h-4 w-4" />
                      {t("denyRequest")}
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          await appointmentsAPI.update(appointment._id, {
                            status: "scheduled",
                          });
                          onClose();
                          onAction?.();
                        } catch (error) {
                          console.error("Error accepting appointment:", error);
                        }
                      }}
                      className="gap-2 rounded-full"
                    >
                      <Check className="h-4 w-4" />
                      {t("acceptRequest")}
                    </Button>
                  </>
                )}
                {appointment.status === "scheduled" &&
                  !appointment.meetingLink &&
                  appointment.type === "video" && (
                    <Button
                      onClick={() => setShowMeetingLinkInput(true)}
                      className="gap-2 rounded-full"
                    >
                      <Video className="h-4 w-4" />
                      {t("addMeetingLink")}
                    </Button>
                  )}
                {appointment.status === "scheduled" && (
                  <Button
                    onClick={async () => {
                      try {
                        await appointmentsAPI.update(appointment._id, {
                          status: "cancelled",
                        });
                        onClose();
                        onAction?.();
                      } catch (error) {
                        console.error("Error cancelling appointment:", error);
                      }
                    }}
                    variant="destructive"
                    className="gap-2 rounded-full"
                  >
                    <XIcon className="h-4 w-4" />
                    {t("cancelAppointment")}
                  </Button>
                )}
              </div>

              {/* Meeting Link Input Section */}
              {showMeetingLinkInput && (
                <div className="rounded-xl bg-muted/50 p-6 border border-border/40 space-y-4">
                  <div className="flex items-center gap-2">
                    <Video className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-serif font-light text-foreground">
                      {t("addMeetingLink")}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground font-light">
                    {t("meetingLinkPrompt")}
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="meetingLink" className="text-sm font-light">
                      {t("meetingLinkUrlLabel")}
                    </Label>
                    <Input
                      id="meetingLink"
                      type="url"
                      placeholder={t("meetingLinkPlaceholder")}
                      value={meetingLink}
                      onChange={(e) => setMeetingLink(e.target.value)}
                      className="font-light"
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button
                      onClick={() => {
                        setShowMeetingLinkInput(false);
                        setMeetingLink("");
                      }}
                      variant="outline"
                      className="rounded-full"
                      disabled={isSubmitting}
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={async () => {
                        if (!meetingLink) return;

                        try {
                          setIsSubmitting(true);
                          await appointmentsAPI.update(appointment._id, {
                            status: "scheduled",
                            meetingLink: meetingLink,
                          });
                          setShowMeetingLinkInput(false);
                          setMeetingLink("");
                          onClose();
                          onAction?.();
                        } catch (error) {
                          console.error("Error accepting appointment:", error);
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className="gap-2 rounded-full"
                      disabled={!meetingLink || isSubmitting}
                    >
                      <Check className="h-4 w-4" />
                      {isSubmitting ? t("saving") : t("confirmAndAccept")}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="basic-info" className="mt-6">
              <BasicInformation
                isEditable={false}
                userId={appointment.clientId._id}
              />
            </TabsContent>

            <TabsContent value="medical-info" className="mt-6 space-y-6">
              <MedicalProfile
                isEditable={false}
                userId={appointment.clientId._id}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
