/**
 * An admin editing a professional's profile from their file (« Modifier » → the profile form) must
 * save what the form sends. The office address and its directions were dropped — the route did not
 * list them — while the screen said « Profil professionnel mis à jour avec succès » (2026-09-18).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const PRO_ID = "b2b2b2b2b2b2b2b2b2b2b2b2";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  userFindById: vi.fn(),
  profileUpdate: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  after: (fn: () => unknown) => {
    fn();
  },
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/intake-rematch", () => ({ rematchWaitingDemandesForReenabledPro: vi.fn() }));
vi.mock("@/lib/products", () => ({ syncProfessionalProducts: vi.fn() }));
vi.mock("@/models/User", () => ({
  default: { findById: () => h.userFindById(), findByIdAndUpdate: vi.fn() },
}));
vi.mock("@/models/Profile", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
    findOneAndUpdate: (...args: unknown[]) => h.profileUpdate(...args),
  },
}));
vi.mock("@/models/Admin", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
  },
}));
vi.mock("@/models/MedicalProfile", () => ({ default: { findOneAndUpdate: vi.fn() } }));
vi.mock("@/models/Appointment", () => ({ default: {} }));
vi.mock("@/models/ClientDocument", () => ({ default: {} }));
vi.mock("@/models/ClientReceipt", () => ({ default: {} }));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({ default: {} }));
vi.mock("@/models/Review", () => ({ default: {} }));
vi.mock("@/models/Resource", () => ({ ResourcePurchase: {} }));
vi.mock("@/models/Conversation", () => ({ default: {} }));
vi.mock("@/models/Message", () => ({ default: {} }));

import { PUT } from "@/app/api/admin/users/[id]/route";

/** What the profile form sends when an admin saves it (ProfileCompletionModal's ProfileData). */
const FORM = {
  problematics: ["Anxiété"],
  approaches: ["Approche TCC"],
  ageCategories: ["Adultes (18-64 ans)"],
  diagnosedConditions: [],
  skills: [],
  bio: "Psychologue en pratique privée depuis neuf ans.",
  yearsOfExperience: "9",
  languages: ["Français"],
  sessionTypes: ["Solo"],
  modalities: ["En personne"],
  officeAddress: {
    street: "1200, boulevard Lapinière",
    suite: "Bureau 210",
    city: "Brossard",
    province: "QC",
    postalCode: "J4Z 3V9",
  },
  officeNotes: "Entrée côté stationnement, 2e étage.",
  pricing: { individualSession: 0, coupleSession: 0, groupSession: 0 },
  education: [{ degree: "", institution: "", year: "" }],
  certifications: [],
  specialty: "psychologist",
  license: "2026-42",
};

const callPut = (body: Record<string, unknown>) => {
  h.getServerSession.mockResolvedValueOnce({ user: { id: ADMIN_ID, role: "admin" } });
  return PUT({ json: async () => body } as never, {
    params: Promise.resolve({ id: PRO_ID }),
  }) as unknown as Promise<{ status: number }>;
};

/** The `$set` of the profile write. */
const profileSet = () => {
  expect(h.profileUpdate).toHaveBeenCalledTimes(1);
  const [filter, update] = h.profileUpdate.mock.calls[0] as [unknown, { $set: Record<string, unknown> }];
  expect(filter).toEqual({ userId: PRO_ID });
  return update.$set;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userFindById.mockResolvedValue({ role: "professional", status: "active" });
  h.profileUpdate.mockResolvedValue({});
});

describe("PUT /api/admin/users/[id] — the admin saves a professional's profile form", () => {
  it("saves the office address and the directions to the office", async () => {
    const res = await callPut(FORM);

    expect(res.status).toBe(200);
    const set = profileSet();
    expect(set.officeAddress).toEqual(FORM.officeAddress);
    expect(set.officeNotes).toBe(FORM.officeNotes);
  });

  it("saves every field the form sends — none is dropped behind a success message", async () => {
    await callPut(FORM);

    expect(Object.keys(profileSet()).sort()).toEqual(Object.keys(FORM).sort());
  });

  it("lets the admin clear the address", async () => {
    const cleared = { street: "", suite: "", city: "", province: "", postalCode: "" };

    await callPut({ officeAddress: cleared, officeNotes: "" });

    expect(profileSet()).toEqual({ officeAddress: cleared, officeNotes: "" });
  });
});
