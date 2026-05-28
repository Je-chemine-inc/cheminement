/**
 * Seed script for validating the appointment auto-routing system.
 *
 * Creates 1 test client + 3 test professionals with contrasting profiles,
 * triggers `routeAppointmentToProfessionals`, and prints expected vs. actual
 * outcomes for 5 key scenarios. Idempotent: wipes prior `*+routing-test@test.local`
 * entries before re-seeding.
 *
 * Run with:  pnpm seed-routing-test     (or)     npm run seed-routing-test
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectToDatabase from "./mongodb";
import User from "@/models/User";
import Profile from "@/models/Profile";
import MedicalProfile from "@/models/MedicalProfile";
import Appointment from "@/models/Appointment";
import { routeAppointmentToProfessionals } from "./appointment-routing";

const TEST_SUFFIX = "+routing-test@test.local";

const CLIENT_EMAIL = `client-anxiete${TEST_SUFFIX}`;
const PRO_A_EMAIL = `pro-anxiete-adulte${TEST_SUFFIX}`;
const PRO_B_EMAIL = `pro-deuil-enfant${TEST_SUFFIX}`;
const PRO_C_EMAIL = `pro-couple-inperson${TEST_SUFFIX}`;

const FULL_WEEK_AVAILABILITY = {
  days: [
    { day: "Monday",    isWorkDay: true,  startTime: "09:00", endTime: "17:00" },
    { day: "Tuesday",   isWorkDay: true,  startTime: "09:00", endTime: "17:00" },
    { day: "Wednesday", isWorkDay: true,  startTime: "09:00", endTime: "17:00" },
    { day: "Thursday",  isWorkDay: true,  startTime: "09:00", endTime: "17:00" },
    { day: "Friday",    isWorkDay: true,  startTime: "09:00", endTime: "17:00" },
    { day: "Saturday",  isWorkDay: false, startTime: "09:00", endTime: "17:00" },
    { day: "Sunday",    isWorkDay: false, startTime: "09:00", endTime: "17:00" },
  ],
  sessionDurationMinutes: 60,
  breakDurationMinutes: 15,
  firstDayOfWeek: "Monday",
};

async function cleanup() {
  const emails = [CLIENT_EMAIL, PRO_A_EMAIL, PRO_B_EMAIL, PRO_C_EMAIL];
  const users = await User.find({ email: { $in: emails } }).select("_id");
  const userIds = users.map((u) => u._id);

  if (userIds.length === 0) {
    console.log("→ Aucune entité de test précédente à supprimer.");
    return;
  }

  const apptDel = await Appointment.deleteMany({ clientId: { $in: userIds } });
  const profDel = await Profile.deleteMany({ userId: { $in: userIds } });
  const medDel  = await MedicalProfile.deleteMany({ userId: { $in: userIds } });
  const usrDel  = await User.deleteMany({ _id: { $in: userIds } });

  console.log(
    `→ Nettoyage : ${usrDel.deletedCount} users, ${profDel.deletedCount} profiles, ${medDel.deletedCount} medical profiles, ${apptDel.deletedCount} appointments supprimés.`,
  );
}

async function createPro(opts: {
  email: string;
  firstName: string;
  lastName: string;
  problematics: string[];
  specialty: string;
  ageCategories: string[];
  modalities: string[];     // "online" | "inPerson" | "phone" | "both"
  sessionTypes: string[];   // "individual" | "couple" | "group"
  approaches: string[];
  languages: string[];
}) {
  const hashedPassword = await bcrypt.hash("Test1234!", 10);

  const user = await User.create({
    email: opts.email,
    password: hashedPassword,
    firstName: opts.firstName,
    lastName: opts.lastName,
    role: "professional",
    status: "active",
    adminApproved: true,
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    language: "fr",
  });

  const profile = await Profile.create({
    userId: user._id,
    problematics: opts.problematics,
    specialty: opts.specialty,
    ageCategories: opts.ageCategories,
    modalities: opts.modalities,
    sessionTypes: opts.sessionTypes,
    approaches: opts.approaches,
    languages: opts.languages,
    availability: FULL_WEEK_AVAILABILITY,
    profileCompleted: true,
  });

  await User.findByIdAndUpdate(user._id, { profile: profile._id });

  return user;
}

async function main() {
  console.log("\n🔌 Connexion à MongoDB...");
  await connectToDatabase();
  console.log("✓ Connecté\n");

  console.log("🧹 Nettoyage des entités de test précédentes...");
  await cleanup();

  console.log("\n👥 Création des 3 professionnels test...");

  // Pro A — match exact attendu (adulte + Anxiété + TCC + Français + vidéo + solo)
  const proA = await createPro({
    email: PRO_A_EMAIL,
    firstName: "Alice",
    lastName: "Anxiété",
    problematics: ["Anxiété", "Stress"],
    specialty: "Psychologue clinicien",
    ageCategories: ["Adultes (18-64)"],
    modalities: ["online", "inPerson"],
    sessionTypes: ["individual"],
    approaches: ["TCC", "ACT"],
    languages: ["Français", "Anglais"],
  });
  console.log(`  ✓ Pro A — ${PRO_A_EMAIL}   (devrait être PROPOSÉ)`);

  // Pro B — bonne problématique mais SEULEMENT enfant/ado → doit être filtré par âge
  const proB = await createPro({
    email: PRO_B_EMAIL,
    firstName: "Benoit",
    lastName: "Bambin",
    problematics: ["Anxiété", "Deuil"],
    specialty: "Psychologue jeunesse",
    ageCategories: ["Enfants (0-12)", "Adolescents (13-17)"],
    modalities: ["online", "inPerson"],
    sessionTypes: ["individual"],
    approaches: ["TCC"],
    languages: ["Français"],
  });
  console.log(`  ✓ Pro B — ${PRO_B_EMAIL}   (devrait être EXCLU — filtre âge)`);

  // Pro C — adulte ok mais problématique différente + modalité ne match pas → score sous le seuil
  const proC = await createPro({
    email: PRO_C_EMAIL,
    firstName: "Clara",
    lastName: "Couple",
    problematics: ["Thérapie de couple", "Conflit familial"],
    specialty: "Thérapeute conjugal",
    ageCategories: ["Adultes (18-64)"],
    modalities: ["inPerson"],
    sessionTypes: ["couple"],
    approaches: ["Systémique"],
    languages: ["Français"],
  });
  console.log(`  ✓ Pro C — ${PRO_C_EMAIL}   (devrait être EXCLU — score < 20)`);

  console.log("\n👤 Création du client test (adulte, 30 ans)...");
  const hashedPassword = await bcrypt.hash("Test1234!", 10);
  const thirtyYearsAgo = new Date();
  thirtyYearsAgo.setFullYear(thirtyYearsAgo.getFullYear() - 30);

  const client = await User.create({
    email: CLIENT_EMAIL,
    password: hashedPassword,
    firstName: "Camille",
    lastName: "Client-Test",
    role: "client",
    status: "active",
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    dateOfBirth: thirtyYearsAgo,
    language: "fr",
  });

  await MedicalProfile.create({
    userId: client._id,
    primaryIssue: "Anxiété",
    secondaryIssues: ["Stress"],
    therapyApproach: ["TCC"],
    languagePreference: "Français",
    modality: "online",
    profileCompleted: true,
  });
  console.log(`  ✓ Client — ${CLIENT_EMAIL}`);

  console.log("\n📅 Création du rendez-vous test (Anxiété, vidéo, solo)...");
  const appointment = await Appointment.create({
    clientId: client._id,
    type: "video",
    therapyType: "solo",
    duration: 60,
    issueType: "Anxiété",
    needs: ["Anxiété"],
    bookingFor: "self",
    routingStatus: "pending",
    status: "pending",
  });
  console.log(`  ✓ Appointment ID: ${appointment._id}`);

  console.log("\n🤖 Déclenchement du routage automatique...");
  const result = await routeAppointmentToProfessionals(
    (appointment._id as mongoose.Types.ObjectId).toString(),
  );

  console.log("\n📊 Résultat du routage :");
  console.log(`   routingStatus  : ${result.routingStatus}`);
  console.log(`   matches count  : ${result.matches.length}`);

  const fresh = await Appointment.findById(appointment._id).lean();
  const proposedIds = (fresh?.proposedTo ?? []).map((id) => id.toString());

  const proAId = (proA._id as mongoose.Types.ObjectId).toString();
  const proBId = (proB._id as mongoose.Types.ObjectId).toString();
  const proCId = (proC._id as mongoose.Types.ObjectId).toString();

  const proAProposed = proposedIds.includes(proAId);
  const proBProposed = proposedIds.includes(proBId);
  const proCProposed = proposedIds.includes(proCId);

  console.log("\n🧪 Vérification des 5 scénarios :\n");

  const tests: Array<{ label: string; pass: boolean; detail: string }> = [
    {
      label: "1. Match exact Anxiété → Pro A est dans proposedTo",
      pass: proAProposed,
      detail: `Pro A dans proposedTo = ${proAProposed}`,
    },
    {
      label: "2. Filtre âge → Pro B (enfant/ado seulement) est EXCLU du client adulte",
      pass: !proBProposed,
      detail: `Pro B dans proposedTo = ${proBProposed} (attendu: false)`,
    },
    {
      label: "3. Score < 20 → Pro C (couple/inPerson) est EXCLU",
      pass: !proCProposed,
      detail: `Pro C dans proposedTo = ${proCProposed} (attendu: false)`,
    },
    {
      label: "4. routingStatus = 'proposed' (au moins 1 match trouvé)",
      pass: fresh?.routingStatus === "proposed",
      detail: `routingStatus actuel = ${fresh?.routingStatus}`,
    },
    {
      label: "5. Détails des scores (top matches retournés)",
      pass: result.matches.length > 0,
      detail: result.matches
        .map(
          (m) =>
            `      • ${m.professionalId === proAId ? "Pro A" : m.professionalId === proBId ? "Pro B" : m.professionalId === proCId ? "Pro C" : "Autre"} → ${m.score} pts (${m.reasons.length} raisons)`,
        )
        .join("\n"),
    },
  ];

  for (const t of tests) {
    console.log(`${t.pass ? "✅" : "❌"}  ${t.label}`);
    console.log(`    ${t.detail}\n`);
  }

  const allPassed = tests.every((t) => t.pass);

  console.log("─".repeat(60));
  console.log(
    allPassed
      ? "✅ TOUS LES TESTS SONT PASSÉS — le routage fonctionne comme prévu."
      : "❌ AU MOINS UN TEST A ÉCHOUÉ — voir détails ci-dessus.",
  );
  console.log("─".repeat(60));

  console.log("\n💡 Vérifications manuelles supplémentaires :");
  console.log(
    `   • Connecte-toi en tant que Pro A (${PRO_A_EMAIL} / Test1234!) → /professional/dashboard/proposals → onglet "Proposés" doit contenir 1 demande de Camille.`,
  );
  console.log(
    `   • Connecte-toi en tant que Pro C (${PRO_C_EMAIL} / Test1234!) → onglet "Liste générale" doit être VIDE (le RDV est passé en 'proposed', pas en 'general').`,
  );
  console.log(
    `   • Pour tester la liste générale : refuse la demande sur les comptes Pro A (et les autres proposés), elle basculera en 'refused' → visible chez tous les pros sauf ceux ayant refusé.`,
  );

  console.log("\n🔄 Pour relancer ce test : pnpm seed-routing-test");
  console.log("🧹 Pour tout nettoyer : relance le script (cleanup automatique en début).\n");

  await mongoose.disconnect();
  process.exit(allPassed ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n❌ Erreur fatale :", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
