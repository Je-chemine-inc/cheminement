import jsPDF from "jspdf";
import type { SessionActNature } from "@/lib/session-closure";

const ACT_LABELS_FR: Record<SessionActNature, string> = {
  parental_coaching: "Coaching parental",
  punctual_consultation: "Consultation ponctuelle / conseils",
  psychological_evaluation: "Évaluation psychologique/neuropsychologique",
  individual_psychotherapy: "Psychothérapie individuelle",
  couple_psychotherapy: "Psychothérapie de couple",
  family_psychotherapy: "Psychothérapie familiale",
  evaluation_report: "Rédaction rapport d'évaluation",
  notes_synthesis: "Rédaction notes, synthèse du dossier",
  work_stoppage: "Rédaction : arrêt de travail / plan de retour progressif au travail",
  psychological_follow_up: "Suivi psychologique",
  parent_support: "Soutien aux parents",
};

export function getSessionActNatureLabelFr(key: string | undefined): string {
  if (!key || !(key in ACT_LABELS_FR)) return key || "—";
  return ACT_LABELS_FR[key as SessionActNature];
}

export type ReceiptAudience = "client" | "professional" | "admin";

export type FiscalReceiptPdfInput = {
  appointmentId: string;
  issuedAt: Date;
  /** Service recipient (populated client name). May differ from billedTo when bookingFor !== "self". */
  clientName: string;
  clientEmail: string;
  /** When booking is for a loved-one / patient, this is the person receiving the service. */
  recipientName?: string;
  professionalName: string;
  professionalEmail: string;
  professionalTitle?: string;
  professionalLicense?: string;
  appointmentDateLabel: string;
  sessionTime: string;
  durationMinutes: number;
  sessionType: string;
  therapyTypeLabel: string;
  actNatureKey?: string;
  actNatureOther?: string;
  /** Determines dynamic description: absence_or_late_cancel → management/cancellation fees. */
  sessionOutcome?: string;
  amountCad: number;
  platformFeeCad: number;
  professionalPayoutCad: number;
  paymentStatus: "paid" | "pending_transfer";
  paymentMethodLabel: string;
  stripePaymentIntentId?: string;
  /** Hides client gross + platform fee; shows only the professional's net earnings. */
  audience?: ReceiptAudience;
};

export function buildFiscalReceiptInputFromPopulatedAppointment(
  appointment: {
    _id: string | { toString: () => string };
    date?: Date;
    time?: string;
    duration: number;
    type?: string;
    therapyType?: string;
    bookingFor?: string;
    lovedOneInfo?: { firstName: string; lastName: string };
    referralInfo?: { patientFirstName?: string; patientLastName?: string };
    sessionActNature?: string;
    sessionActNatureOther?: string;
    sessionOutcome?: string;
    payment: {
      price: number;
      platformFee: number;
      professionalPayout: number;
      status: string;
      method?: string;
      stripePaymentIntentId?: string;
      paidAt?: Date;
    };
    clientId: unknown;
    professionalId: unknown;
  },
  professionalLicense?: string,
  professionalTitle?: string,
): FiscalReceiptPdfInput {
  const id =
    typeof appointment._id === "string"
      ? appointment._id
      : String(appointment._id);

  const client = appointment.clientId as {
    firstName: string;
    lastName: string;
    email: string;
  };
  const professional = appointment.professionalId as {
    firstName?: string;
    lastName?: string;
    email?: string;
  };

  const aptDate = appointment.date ? new Date(appointment.date) : null;
  const dateLabel =
    aptDate && !isNaN(aptDate.getTime())
      ? `${aptDate.toLocaleDateString("fr-CA", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}${appointment.time ? ` — ${appointment.time}` : ""}`
      : "—";

  const paymentPendingTransfer =
    appointment.payment.method === "transfer" &&
    appointment.payment.status !== "paid";

  // Determine if there's a separate service recipient (loved-one / referred patient)
  let recipientName: string | undefined;
  if (appointment.bookingFor === "loved-one" && appointment.lovedOneInfo) {
    recipientName =
      `${appointment.lovedOneInfo.firstName} ${appointment.lovedOneInfo.lastName}`.trim();
  } else if (
    appointment.bookingFor === "patient" &&
    appointment.referralInfo?.patientFirstName
  ) {
    recipientName =
      `${appointment.referralInfo.patientFirstName} ${appointment.referralInfo.patientLastName ?? ""}`.trim();
  }

  return {
    appointmentId: id,
    issuedAt: appointment.payment.paidAt
      ? new Date(appointment.payment.paidAt)
      : new Date(),
    clientName: `${client.firstName} ${client.lastName}`,
    clientEmail: client.email,
    recipientName,
    professionalName:
      `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim(),
    professionalEmail: professional.email ?? "",
    professionalTitle,
    professionalLicense,
    appointmentDateLabel: dateLabel,
    sessionTime: appointment.time || "—",
    durationMinutes: appointment.duration,
    sessionType:
      appointment.type === "in-person"
        ? "En personne"
        : appointment.type === "video"
          ? "Vidéo"
          : appointment.type === "phone"
            ? "Téléphone"
            : appointment.type === "both"
              ? "Vidéo ou en personne"
              : appointment.type || "—",
    therapyTypeLabel:
      appointment.therapyType === "solo"
        ? "Individuel"
        : appointment.therapyType === "couple"
          ? "Couple"
          : appointment.therapyType === "group"
            ? "Groupe"
            : appointment.therapyType || "—",
    actNatureKey: appointment.sessionActNature,
    actNatureOther: appointment.sessionActNatureOther,
    sessionOutcome: appointment.sessionOutcome,
    amountCad: appointment.payment.price,
    platformFeeCad: appointment.payment.platformFee,
    professionalPayoutCad: appointment.payment.professionalPayout,
    paymentStatus: paymentPendingTransfer ? "pending_transfer" : "paid",
    paymentMethodLabel:
      appointment.payment.method === "transfer"
        ? "Virement Interac"
        : appointment.payment.method === "direct_debit"
          ? "Prélèvement bancaire (PAD)"
          : "Carte (Stripe)",
    stripePaymentIntentId: appointment.payment.stripePaymentIntentId,
  };
}

export function buildFiscalReceiptPdfBuffer(
  input: FiscalReceiptPdfInput,
): Buffer {
  const doc = new jsPDF();

  const primaryColor: [number, number, number] = [79, 70, 229];
  const textColor: [number, number, number] = [31, 41, 55];
  const grayColor: [number, number, number] = [107, 114, 128];
  const lightGray: [number, number, number] = [243, 244, 246];
  const MARGIN = 20;
  const COL_RIGHT = 120;
  const PAGE_RIGHT = 190;

  const { appointmentId } = input;
  const isProVariant = input.audience === "professional";

  // ── HEADER ───────────────────────────────────────────────────────────────────
  let headerBottomY = 40;
  let logoEmbedded = false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const logoPath = path.join(process.cwd(), "public", "Logo.png");
    const logoData = fs.readFileSync(logoPath);
    doc.addImage(
      `data:image/png;base64,${logoData.toString("base64")}`,
      "PNG",
      MARGIN,
      5,
      50,
      29,
    );
    logoEmbedded = true;
    headerBottomY = 36;
  } catch {
    // Fallback: text banner when logo file is unavailable
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 40, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("Je Chemine", MARGIN, 25);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Plateforme de services en santé mentale", MARGIN, 33);
  }

  if (logoEmbedded) {
    doc.setFillColor(...primaryColor);
    doc.rect(0, headerBottomY, 210, 3, "F");
  }

  // ── TITLE & RECEIPT META ─────────────────────────────────────────────────────
  let y = headerBottomY + 12;
  doc.setTextColor(...textColor);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(isProVariant ? "RELEVÉ DE REVENU" : "REÇU", MARGIN, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayColor);
  doc.text(
    `Reçu n° REC-${appointmentId.slice(-8).toUpperCase()}`,
    MARGIN,
    y,
  );
  y += 6;
  if (input.appointmentDateLabel && input.appointmentDateLabel !== "—") {
    doc.text(`Date de la rencontre : ${input.appointmentDateLabel}`, MARGIN, y);
    y += 6;
  }
  doc.text(
    `Émis le : ${input.issuedAt.toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`,
    MARGIN,
    y,
  );
  y += 10;

  // ── DIVIDER ──────────────────────────────────────────────────────────────────
  doc.setDrawColor(229, 231, 235);
  doc.line(MARGIN, y, PAGE_RIGHT, y);
  y += 8;

  // ── IDENTITY SECTION ─────────────────────────────────────────────────────────
  const identityTopY = y;

  // Left column — Client / Facturé à
  doc.setTextColor(...textColor);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Client", MARGIN, identityTopY);

  let leftY = identityTopY + 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayColor);

  if (input.recipientName) {
    doc.text(input.recipientName, MARGIN, leftY);
    leftY += 6;
    doc.setFontSize(9);
    doc.text(`Facturé à : ${input.clientName}`, MARGIN, leftY);
    leftY += 5;
    doc.setFontSize(10);
    doc.text(input.clientEmail, MARGIN, leftY);
    leftY += 6;
  } else {
    doc.text(input.clientName, MARGIN, leftY);
    leftY += 6;
    doc.text(input.clientEmail, MARGIN, leftY);
    leftY += 6;
  }

  // Right column — Professional
  doc.setTextColor(...textColor);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Professionnel", COL_RIGHT, identityTopY);

  let rightY = identityTopY + 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayColor);
  doc.text(input.professionalName, COL_RIGHT, rightY);
  rightY += 6;
  if (input.professionalTitle) {
    doc.text(input.professionalTitle, COL_RIGHT, rightY);
    rightY += 6;
  }
  if (input.professionalLicense) {
    doc.text(`N° permis : ${input.professionalLicense}`, COL_RIGHT, rightY);
    rightY += 6;
  }

  y = Math.max(leftY, rightY) + 4;

  // ── DIVIDER ──────────────────────────────────────────────────────────────────
  doc.setDrawColor(229, 231, 235);
  doc.line(MARGIN, y, PAGE_RIGHT, y);
  y += 8;

  // ── SÉANCE SECTION ───────────────────────────────────────────────────────────
  doc.setTextColor(...textColor);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Séance", MARGIN, y);
  y += 6;

  const isAbsenceOrLateCancel = input.sessionOutcome === "absence_or_late_cancel";
  const descriptionLine = isAbsenceOrLateCancel
    ? "Frais de gestion de dossier / Annulation tardive"
    : getSessionActNatureLabelFr(input.actNatureKey) +
      (input.actNatureOther ? ` — ${input.actNatureOther}` : "");

  // Wrap long description
  const maxDescWidth = 155;
  const descWrapped = doc.splitTextToSize(descriptionLine, maxDescWidth) as string[];
  const BOX_PADDING = 8;
  const LINE_H = 7;
  const seanceInfoLines = [
    `Durée : ${input.durationMinutes} min`,
    `Type : ${input.sessionType} — ${input.therapyTypeLabel}`,
  ];
  const boxHeight =
    BOX_PADDING +
    seanceInfoLines.length * LINE_H +
    8 + // spacing before description
    descWrapped.length * 6 +
    BOX_PADDING;

  doc.setFillColor(...lightGray);
  doc.roundedRect(MARGIN, y, 170, boxHeight, 3, 3, "F");

  let boxY = y + BOX_PADDING;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...textColor);

  for (const line of seanceInfoLines) {
    doc.text(line, MARGIN + 5, boxY);
    boxY += LINE_H;
  }
  boxY += 4;
  doc.setFont("helvetica", "bold");
  if (isAbsenceOrLateCancel) {
    doc.setTextColor(180, 83, 9); // amber for cancellation/no-show
  }
  doc.text(descWrapped, MARGIN + 5, boxY);

  y += boxHeight + 10;

  // ── PAIEMENT SECTION ─────────────────────────────────────────────────────────
  doc.setTextColor(...textColor);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Paiement", MARGIN, y);
  y += 6;

  doc.setFillColor(...lightGray);
  doc.roundedRect(MARGIN, y, 170, 10, 2, 2, "F");
  doc.setFontSize(10);
  doc.text("Description", MARGIN + 5, y + 7);
  doc.text("Montant", PAGE_RIGHT, y + 7, { align: "right" });
  y += 16;

  doc.setFont("helvetica", "normal");

  if (isProVariant) {
    doc.text("Revenu professionnel (séance)", MARGIN + 5, y);
    doc.text(`$${input.professionalPayoutCad.toFixed(2)}`, PAGE_RIGHT, y, {
      align: "right",
    });
    y += 10;
  } else {
    doc.text("Prestation (séance)", MARGIN + 5, y);
    doc.text(`$${input.amountCad.toFixed(2)}`, PAGE_RIGHT, y, {
      align: "right",
    });
    y += 10;

    if (input.platformFeeCad > 0) {
      doc.setTextColor(...grayColor);
      doc.setFontSize(9);
      doc.text("Frais plateforme", MARGIN + 8, y);
      doc.text(`$${input.platformFeeCad.toFixed(2)}`, PAGE_RIGHT, y, {
        align: "right",
      });
      y += 7;
      doc.text("Montant net professionnel", MARGIN + 8, y);
      doc.text(`$${input.professionalPayoutCad.toFixed(2)}`, PAGE_RIGHT, y, {
        align: "right",
      });
      y += 9;
    }
  }

  doc.setDrawColor(229, 231, 235);
  doc.line(MARGIN + 5, y, PAGE_RIGHT - 5, y);
  y += 7;

  doc.setTextColor(...textColor);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Total", MARGIN + 5, y);
  const totalCad = isProVariant ? input.professionalPayoutCad : input.amountCad;
  doc.text(`$${totalCad.toFixed(2)} CAD`, PAGE_RIGHT, y, { align: "right" });
  y += 12;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayColor);
  doc.text(`Mode : ${input.paymentMethodLabel}`, MARGIN + 5, y);
  y += 5;
  if (input.paymentStatus === "pending_transfer") {
    doc.setTextColor(180, 83, 9);
    doc.text(
      "Paiement en attente — virement Interac selon les instructions envoyées par courriel.",
      MARGIN + 5,
      y,
    );
    y += 8;
  } else if (input.stripePaymentIntentId) {
    doc.setTextColor(...grayColor);
    doc.text(
      `Réf. transaction : ${input.stripePaymentIntentId.slice(-18)}`,
      MARGIN + 5,
      y,
    );
    y += 6;
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────────
  const footerY = 265;
  doc.setDrawColor(229, 231, 235);
  doc.line(MARGIN, footerY, PAGE_RIGHT, footerY);
  doc.setFontSize(8);
  doc.setTextColor(...grayColor);
  doc.text("Merci d'avoir choisi Je Chemine.", 105, footerY + 8, {
    align: "center",
  });
  doc.text("support@jechemine.ca", 105, footerY + 14, { align: "center" });
  doc.setFontSize(7);
  doc.text("Document généré automatiquement.", 105, footerY + 22, {
    align: "center",
  });

  return Buffer.from(doc.output("arraybuffer"));
}
