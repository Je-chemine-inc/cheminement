import { describe, it, expect } from "vitest";
import {
  calculateAge,
  isChild,
  professionalTreatsAgeCategory,
  normalizeString,
  calculateRelevancyScore,
  professionalCoversAvailabilitySlot,
  scoreAvailabilityMatch,
} from "./appointment-routing";

describe("appointment-routing", () => {
  describe("calculateAge", () => {
    it("should calculate correct age", () => {
      const today = new Date();
      const thirtyYearsAgo = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate());
      expect(calculateAge(thirtyYearsAgo)).toBe(30);
    });

    it("should handle string dates", () => {
      const today = new Date();
      const birthStr = `${today.getFullYear() - 25}-${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      expect(calculateAge(birthStr)).toBe(25);
    });
  });

  describe("isChild", () => {
    it("should return true for age < 18", () => {
      expect(isChild(17)).toBe(true);
      expect(isChild(5)).toBe(true);
    });

    it("should return false for age >= 18", () => {
      expect(isChild(18)).toBe(false);
      expect(isChild(30)).toBe(false);
    });
  });

  describe("professionalTreatsAgeCategory", () => {
    it("should return true if no categories specified", () => {
      expect(professionalTreatsAgeCategory(undefined, true)).toBe(true);
      expect(professionalTreatsAgeCategory([], false)).toBe(true);
    });

    it("should match child categories for children", () => {
      const categories = ["Children (0-12)", "Adolescents (13-17)"];
      expect(professionalTreatsAgeCategory(categories, true)).toBe(true);
      expect(professionalTreatsAgeCategory(categories, false)).toBe(false);
    });

    it("should match adult categories for adults", () => {
      const categories = ["Adults (18-64)", "Seniors (65+)"];
      expect(professionalTreatsAgeCategory(categories, false)).toBe(true);
      expect(professionalTreatsAgeCategory(categories, true)).toBe(false);
    });
  });

  describe("normalizeString", () => {
    it("should lowercase and remove accents", () => {
      expect(normalizeString("Anxiété")).toBe("anxiete");
      expect(normalizeString("  Dépression  ")).toBe("depression");
    });
  });

  describe("calculateRelevancyScore", () => {
    const mockProfile = {
      problematics: ["Anxiété", "Dépression", "Stress"],
      specialty: "Psychologue",
      ageCategories: ["Adultes (18-64)"],
      modalities: ["online", "inPerson"],
      sessionTypes: ["individual"],
    };

    const mockAppointment = {
      type: "video",
      therapyType: "solo",
      issueType: "Anxiété",
    };

    it("should give high score for exact problematics match", () => {
      const { score } = calculateRelevancyScore(mockProfile, mockAppointment);
      expect(score).toBeGreaterThanOrEqual(100);
    });

    it("should give bonus for matching language if provided", () => {
      const profileWithLang = { ...mockProfile, languages: ["Français", "Anglais"] };
      const medicalProfile = { languagePreference: "Français", primaryIssue: "Anxiété" };

      const { score } = calculateRelevancyScore(profileWithLang, mockAppointment, medicalProfile);
      // Base score for Anxiété + language bonus
      expect(score).toBeGreaterThan(100);
    });
  });

  describe("professionalCoversAvailabilitySlot", () => {
    const weekdayDaytime = [
      { day: "Monday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
      { day: "Saturday", isWorkDay: false, startTime: "", endTime: "" },
    ];
    const weekdayEvening = [
      { day: "Tuesday", isWorkDay: true, startTime: "17:00", endTime: "21:00" },
    ];
    const weekendMorning = [
      { day: "Saturday", isWorkDay: true, startTime: "09:00", endTime: "12:00" },
    ];

    it("matches a daytime weekday pro to morning/afternoon, not evening", () => {
      expect(professionalCoversAvailabilitySlot("week_morning", weekdayDaytime)).toBe(true);
      expect(professionalCoversAvailabilitySlot("week_afternoon", weekdayDaytime)).toBe(true);
      expect(professionalCoversAvailabilitySlot("week_evening", weekdayDaytime)).toBe(false);
    });

    it("matches an evening weekday pro only to the evening slot", () => {
      expect(professionalCoversAvailabilitySlot("week_evening", weekdayEvening)).toBe(true);
      expect(professionalCoversAvailabilitySlot("week_morning", weekdayEvening)).toBe(false);
    });

    it("respects the weekday vs weekend bucket", () => {
      expect(professionalCoversAvailabilitySlot("weekend_morning", weekdayDaytime)).toBe(false);
      expect(professionalCoversAvailabilitySlot("weekend_morning", weekendMorning)).toBe(true);
      expect(professionalCoversAvailabilitySlot("week_morning", weekendMorning)).toBe(false);
    });

    it("ignores non-work days and unparseable / unknown slots", () => {
      expect(professionalCoversAvailabilitySlot("week_morning", [
        { day: "Monday", isWorkDay: false, startTime: "09:00", endTime: "17:00" },
      ])).toBe(false);
      expect(professionalCoversAvailabilitySlot("week_noon", weekdayDaytime)).toBe(false);
      expect(professionalCoversAvailabilitySlot("week_morning", undefined)).toBe(false);
    });
  });

  describe("scoreAvailabilityMatch", () => {
    const monDaytime = [
      { day: "Monday", isWorkDay: true, startTime: "09:00", endTime: "17:00" },
    ];

    it("counts matched vs total preferred slots", () => {
      // morning matches (9-17 overlaps 9-12); evening does not (ends at 17)
      expect(
        scoreAvailabilityMatch(["week_morning", "week_evening"], monDaytime),
      ).toEqual({ matched: 1, total: 2 });
    });

    it("returns zeros when the client gave no preference", () => {
      expect(scoreAvailabilityMatch([], monDaytime)).toEqual({ matched: 0, total: 0 });
      expect(scoreAvailabilityMatch(undefined, monDaytime)).toEqual({ matched: 0, total: 0 });
    });

    it("counts a recognized slot as unmatched when the pro has no availability", () => {
      expect(scoreAvailabilityMatch(["week_morning"], undefined)).toEqual({
        matched: 0,
        total: 1,
      });
    });

    it("maps a specific-date token to its weekday/weekend bucket", () => {
      // 2099-01-05 is a Monday → weekday morning, pro works Mon 9-17 → matched
      expect(
        scoreAvailabilityMatch(["2099-01-05-morning"], monDaytime),
      ).toEqual({ matched: 1, total: 1 });
    });
  });
});
