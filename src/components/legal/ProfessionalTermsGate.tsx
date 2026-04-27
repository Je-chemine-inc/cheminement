"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import ProfessionalTermsAcceptanceModal from "./ProfessionalTermsAcceptanceModal";

interface Props {
  needsAcceptance: boolean;
}

export default function ProfessionalTermsGate({ needsAcceptance }: Props) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);

  if (!needsAcceptance || accepted) return null;

  const handleAccept = async () => {
    const res = await fetch("/api/auth/account/accept-professional-terms", {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to record acceptance");
    setAccepted(true);
    router.refresh();
  };

  const handleClose = async () => {
    // Declining means the professional cannot use the platform — sign them out
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <ProfessionalTermsAcceptanceModal
      open={true}
      onClose={handleClose}
      onAccept={handleAccept}
    />
  );
}
