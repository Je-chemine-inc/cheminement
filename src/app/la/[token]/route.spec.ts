import { describe, it, expect } from "vitest";

import { GET } from "@/app/la/[token]/route";

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";

const call = async (token: string) => {
  const res = await GET(new Request(`http://www.jechemine.ca/la/${encodeURIComponent(token)}`), {
    params: Promise.resolve({ token }),
  });
  return { status: res.status, location: res.headers.get("location"), cache: res.headers.get("cache-control") };
};

describe("GET /la/[token]", () => {
  it("sends a valid offer link to the claim page with a relative Location, never cached", async () => {
    expect(await call(TOKEN)).toEqual({
      status: 307,
      location: `/liste-attente/reclamer?t=${TOKEN}`,
      cache: "no-store",
    });
  });

  it("sends anything else home", async () => {
    for (const token of ["short", `${TOKEN}x`, "AbCdEfGhIjKlMnOpQrSt=+", "ab".repeat(32), "https://evil.example"]) {
      expect(await call(token)).toEqual({ status: 307, location: "/", cache: "no-store" });
    }
  });
});
