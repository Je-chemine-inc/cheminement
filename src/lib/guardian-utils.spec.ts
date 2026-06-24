import { describe, it, expect } from "vitest";
import { resolveProfessionalNotifeeParty } from "./guardian-utils";

const REQUESTER = { requesterName: "Parent Doe", requesterEmail: "parent@example.com" };

// Dates relative to "now" so the age check stays correct over time.
const yearsAgo = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
};

describe("resolveProfessionalNotifeeParty", () => {
  it("self booking → the requester unchanged", () => {
    expect(
      resolveProfessionalNotifeeParty({ bookingFor: "self", ...REQUESTER }),
    ).toEqual({ name: "Parent Doe", email: "parent@example.com" });
  });

  it("loved-one with no lovedOneInfo → the requester", () => {
    expect(
      resolveProfessionalNotifeeParty({
        bookingFor: "loved-one",
        lovedOneInfo: null,
        ...REQUESTER,
      }),
    ).toEqual({ name: "Parent Doe", email: "parent@example.com" });
  });

  it("loved-one 14+ with own email → the loved one's name AND email", () => {
    expect(
      resolveProfessionalNotifeeParty({
        bookingFor: "loved-one",
        lovedOneInfo: {
          firstName: "Ado",
          lastName: "Lescent",
          email: "ado@example.com",
          dateOfBirth: yearsAgo(16),
        },
        ...REQUESTER,
      }),
    ).toEqual({ name: "Ado Lescent", email: "ado@example.com" });
  });

  it("loved-one under 14 → the loved one's NAME but the guardian's email (LSSSS)", () => {
    expect(
      resolveProfessionalNotifeeParty({
        bookingFor: "loved-one",
        lovedOneInfo: {
          firstName: "Petit",
          lastName: "Enfant",
          email: "child@example.com", // present but legally routed to the guardian
          dateOfBirth: yearsAgo(9),
        },
        ...REQUESTER,
      }),
    ).toEqual({ name: "Petit Enfant", email: "parent@example.com" });
  });

  it("loved-one with no email → the loved one's name + the requester's email", () => {
    expect(
      resolveProfessionalNotifeeParty({
        bookingFor: "loved-one",
        lovedOneInfo: { firstName: "Sans", lastName: "Courriel" },
        ...REQUESTER,
      }),
    ).toEqual({ name: "Sans Courriel", email: "parent@example.com" });
  });
});
