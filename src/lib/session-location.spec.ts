/**
 * Regression: an in-person appointment reminder carried no location at all, so
 * the only address in the email was Je chemine's own branding footer. A client
 * booked "au bureau" either saw nothing or read the platform's address as the
 * meeting place — and professionals practise from their own offices.
 */
import { describe, it, expect } from "vitest";
import {
  formatSessionLocationLine,
  isInPersonAppointment,
  resolveSessionLocation,
} from "./session-location";

const office = {
  street: "1250 rue Sainte-Catherine Ouest",
  suite: "Bureau 300",
  city: "Montréal",
  province: "QC",
  postalCode: "H3G1P1",
};

describe("isInPersonAppointment", () => {
  it("is true only for in-person", () => {
    expect(isInPersonAppointment("in-person")).toBe(true);
    expect(isInPersonAppointment("video")).toBe(false);
    expect(isInPersonAppointment("phone")).toBe(false);
    expect(isInPersonAppointment("both")).toBe(false);
    expect(isInPersonAppointment(null)).toBe(false);
    expect(isInPersonAppointment(undefined)).toBe(false);
  });
});

describe("resolveSessionLocation", () => {
  it("renders the PROFESSIONAL's office for an in-person session", () => {
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: office,
      officeNotes: "3e étage, sonner au 301",
    });

    expect(loc.show).toBe(true);
    expect(loc.missing).toBe(false);
    expect(loc.lines.join(" | ")).toContain("1250 rue Sainte-Catherine Ouest");
    expect(loc.lines.join(" | ")).toContain("Montréal");
    expect(loc.notes).toBe("3e étage, sonner au 301");
    // Nothing about the platform's own address leaks in.
    expect(loc.lines.join(" ")).not.toMatch(/je chemine/i);
  });

  it("shows nothing at all for a video session", () => {
    expect(
      resolveSessionLocation({ appointmentType: "video", officeAddress: office }),
    ).toEqual({ show: false, lines: [], notes: null, missing: false });
  });

  it("flags a missing office rather than staying silent", () => {
    // Silence is the dangerous case: the client falls back to the footer, which
    // is Je chemine's address.
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: null,
    });
    expect(loc).toEqual({ show: true, lines: [], notes: null, missing: true });
  });

  it("treats a schema-default-only address as missing", () => {
    // The schema seeds every part as "". A profile never filled in must not
    // look 'set' and render an empty block.
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: { street: "", suite: "", city: "", province: "", postalCode: "" },
    });
    expect(loc.missing).toBe(true);
  });

  it("treats a province-only address as missing", () => {
    // province alone is never a place a client can walk to.
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: { province: "QC" },
    });
    expect(loc.missing).toBe(true);
  });

  it("accepts a partial but usable address", () => {
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: { street: "12 rue Principale", city: "Gatineau" },
    });
    expect(loc.missing).toBe(false);
    expect(loc.lines.join(" ")).toContain("12 rue Principale");
  });

  it("ignores whitespace-only notes", () => {
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: office,
      officeNotes: "   ",
    });
    expect(loc.notes).toBeNull();
  });
});

describe("formatSessionLocationLine", () => {
  it("returns null when there is nothing to show", () => {
    expect(
      formatSessionLocationLine(resolveSessionLocation({ appointmentType: "video" })),
    ).toBeNull();
  });

  it("says the address is to be confirmed when the pro has not set one", () => {
    const loc = resolveSessionLocation({ appointmentType: "in-person" });
    expect(formatSessionLocationLine(loc, "fr")).toBe(
      "Adresse à confirmer avec votre professionnel",
    );
    expect(formatSessionLocationLine(loc, "en")).toBe(
      "Address to be confirmed with your professional",
    );
  });

  it("joins the address and the access notes on one line", () => {
    const loc = resolveSessionLocation({
      appointmentType: "in-person",
      officeAddress: office,
      officeNotes: "Stationnement à l'arrière",
    });
    const line = formatSessionLocationLine(loc, "fr")!;
    expect(line).toContain("1250 rue Sainte-Catherine Ouest");
    expect(line).toContain("Stationnement à l'arrière");
  });
});
