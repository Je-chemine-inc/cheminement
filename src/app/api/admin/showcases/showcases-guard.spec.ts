/**
 * Spec 003 — every admin route of the showcase pages sits behind
 * manageProfessionals. A route added later without the gate fails here: the
 * list is built from the filesystem, not typed by hand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  permissions: null as Record<string, boolean> | null,
  touched: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
  after: () => h.touched(),
}));
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-rbac", () => ({
  getActiveAdminPermissions: vi.fn(async () => h.permissions),
}));
// Any database access or page change means the gate let the request through.
const trap = new Proxy(
  {},
  {
    get: () => {
      h.touched();
      throw new Error("database reached");
    },
  },
);
vi.mock("@/models/ShowcasePage", () => ({ default: trap }));
vi.mock("@/models/User", () => ({ default: trap }));
vi.mock("@/models/PlatformSettings", () => ({ default: trap }));
vi.mock("@/lib/showcase-photo", () => ({
  storeShowcasePhoto: () => h.touched(),
  deleteUnreferencedShowcasePhotos: () => h.touched(),
}));
vi.mock("@/lib/showcase-service", () => ({
  listShowcasesForAdmin: () => h.touched(),
  activateShowcase: () => h.touched(),
  loadShowcaseAdminView: () => h.touched(),
  loadShowcaseEditor: () => h.touched(),
  saveShowcaseDraft: () => h.touched(),
  publishShowcase: () => h.touched(),
  unpublishShowcase: () => h.touched(),
  republishShowcase: () => h.touched(),
  moveShowcase: () => h.touched(),
  setShowcasePhoto: () => h.touched(),
  addShowcaseOfficePhoto: () => h.touched(),
  removeShowcaseOfficePhoto: () => h.touched(),
  moveShowcaseOfficePhoto: () => h.touched(),
  updateShowcaseServices: () => h.touched(),
}));

const API = path.join(process.cwd(), "src/app/api/admin");
const ROOTS = ["showcases", "showcase-settings"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const routes = ROOTS.flatMap((root) => routeFiles(path.join(API, root)));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const req = {
  url: "http://x/api",
  headers: { get: () => null },
  json: async () => ({
    action: "publish",
    revision: 1,
    consentAttested: true,
    userId: "0123456789abcdef01234567",
    enabled: true,
  }),
  formData: async () => new FormData(),
};
const ctx = { params: Promise.resolve({ userId: "0123456789abcdef01234567" }) };

beforeEach(() => {
  h.touched.mockReset();
  h.permissions = null;
});

describe("showcase admin routes", () => {
  it("finds the routes (guards against this test silently passing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of routes) {
    const rel = path.relative(API, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      if (!new RegExp(`export async function ${method}\\b`).test(source)) continue;

      it(`${method} ${rel} — 401 for a non-admin, 403 without manageProfessionals, nothing touched`, async () => {
        const mod = (await import(file)) as Record<string, (r: unknown, c: unknown) => Promise<{ status: number }>>;
        h.getServerSession.mockResolvedValue({ user: { id: "u1", isAdmin: false, role: "professional" } });
        expect((await mod[method](req, ctx)).status).toBe(401);

        h.getServerSession.mockResolvedValue({ user: { id: "a1", isAdmin: true, role: "admin" } });
        h.permissions = { managePatients: true, manageUsers: true, manageContent: true, manageBilling: true };
        expect((await mod[method](req, ctx)).status).toBe(403);

        h.permissions = null;
        expect((await mod[method](req, ctx)).status).toBe(403);
        expect(h.touched).not.toHaveBeenCalled();
      });
    }
  }
});
