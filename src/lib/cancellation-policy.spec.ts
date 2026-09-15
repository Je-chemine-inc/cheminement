import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { FREE_CANCELLATION_HOURS } from "@/lib/cancellation-policy";

/**
 * The showcase pages tell the public how cancellation works. The text must be
 * the rule the appointment route enforces, so both read one constant.
 */
describe("cancellation policy", () => {
  it("lets a client cancel for free until 48 hours before", () => {
    expect(FREE_CANCELLATION_HOURS).toBe(48);
  });

  it("is the constant the appointment route enforces", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/api/appointments/[id]/route.ts"),
      "utf8",
    );
    expect(source).toMatch(/import \{ FREE_CANCELLATION_HOURS \} from "@\/lib\/cancellation-policy"/);
    expect(source).toMatch(/HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION = FREE_CANCELLATION_HOURS/);
    expect(source).not.toMatch(/HOURS_BEFORE_APPOINTMENT_FOR_FREE_CANCELLATION = \d/);
  });
});
