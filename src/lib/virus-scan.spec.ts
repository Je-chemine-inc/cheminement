import { describe, it, expect, beforeEach } from "vitest";
import { containsEicarSignature, scanBufferForViruses } from "./virus-scan";

// EICAR test signature, decoded from base64 so the literal isn't in source.
const EICAR = Buffer.from(
  "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=",
  "base64",
);

describe("containsEicarSignature", () => {
  it("detects the standalone EICAR signature", () => {
    expect(containsEicarSignature(EICAR)).toBe(true);
  });

  // The exact case Cloudmersive misses: EICAR inside a recognized PDF.
  it("detects EICAR embedded in a PDF wrapper", () => {
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      EICAR,
      Buffer.from("\n%%EOF\n"),
    ]);
    expect(containsEicarSignature(pdf)).toBe(true);
  });

  it("returns false for clean content", () => {
    expect(containsEicarSignature(Buffer.from("a normal clinical note"))).toBe(
      false,
    );
  });
});

describe("scanBufferForViruses — deterministic EICAR catch", () => {
  beforeEach(() => {
    delete process.env.CLOUDMERSIVE_API_KEY;
  });

  it("rejects EICAR as infected even with NO scanner key (independent of the API)", async () => {
    const res = await scanBufferForViruses(EICAR, "test.pdf");
    expect(res.status).toBe("infected");
    expect(res.detail).toContain("Eicar");
  });

  it("skips (no key) for clean content rather than blocking it", async () => {
    const res = await scanBufferForViruses(Buffer.from("clean note"), "n.txt");
    expect(res.status).toBe("skipped");
  });
});
