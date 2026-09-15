/**
 * Spec 003 — a professional's showcase routes answer only a signed-in
 * professional whose account is approved and active. Built from the
 * filesystem so a new route cannot skip the gate unnoticed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  user: null as null | { status?: string; adminApproved?: boolean },
  touched: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: () => h.touched(),
}));
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("@/models/User", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => h.user }) }),
  },
}));
const trap = new Proxy(
  {},
  {
    get: () => {
      h.touched();
      throw new Error("page reached");
    },
  },
);
vi.mock("@/models/ShowcasePage", () => ({ default: trap }));
vi.mock("@/lib/showcase-photo", () => ({
  storeShowcasePhoto: () => h.touched(),
  deleteUnreferencedShowcasePhotos: () => h.touched(),
}));
vi.mock("@/lib/showcase-service", () => ({
  loadShowcaseEditor: () => h.touched(),
  saveShowcaseDraft: () => h.touched(),
  unpublishShowcase: () => h.touched(),
  republishShowcase: () => h.touched(),
  updateShowcaseServices: () => h.touched(),
  setShowcasePhoto: () => h.touched(),
  addShowcaseOfficePhoto: () => h.touched(),
  removeShowcaseOfficePhoto: () => h.touched(),
  moveShowcaseOfficePhoto: () => h.touched(),
}));

const ROOT = path.join(process.cwd(), "src/app/api/professional/showcase");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const routes = routeFiles(ROOT);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const req = {
  headers: { get: () => null },
  json: async () => ({ consent: true }),
  formData: async () => new FormData(),
};

beforeEach(() => {
  h.touched.mockReset();
  h.session = null;
  h.user = null;
});

describe("professional showcase routes", () => {
  it("finds the routes (guards against this test silently passing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of routes) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      if (!new RegExp(`export async function ${method}\\b`).test(source)) continue;

      it(`${method} ${rel} — only an active, approved professional; nothing touched otherwise`, async () => {
        const mod = (await import(file)) as Record<string, (r: unknown) => Promise<{ status: number }>>;
        expect((await mod[method](req)).status).toBe(401);

        h.session = { user: { id: "u1", role: "client" } };
        expect((await mod[method](req)).status).toBe(401);

        h.session = { user: { id: "p1", role: "professional" } };
        h.user = { status: "pending", adminApproved: true };
        expect((await mod[method](req)).status).toBe(403);
        h.user = { status: "active", adminApproved: false };
        expect((await mod[method](req)).status).toBe(403);
        h.user = null;
        expect((await mod[method](req)).status).toBe(403);

        expect(h.touched).not.toHaveBeenCalled();
      });
    }
  }
});
