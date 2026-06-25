import { describe, it, expect, vi } from "vitest";

// Chainable .select().lean() stub returning the given docs.
const chain = (docs: unknown[]) => ({
  select: () => ({ lean: () => Promise.resolve(docs) }),
});

const motifDocs = [{ labelFr: "Anxiété", labelEn: "Anxiety" }];
const catalogDocs = [{ labelFr: "Trauma complexe", labelEn: "Complex trauma" }];

vi.mock("@/models/Motif", () => ({
  default: { find: vi.fn(() => chain(motifDocs)) },
}));
vi.mock("@/models/ProCatalogItem", () => ({
  default: { find: vi.fn(() => chain(catalogDocs)) },
}));

import { getValidMotifLabels } from "./motifs";
import ProCatalogItem from "@/models/ProCatalogItem";

describe("getValidMotifLabels", () => {
  it("includes active Motif labels (FR + EN)", async () => {
    const set = await getValidMotifLabels();
    expect(set.has("Anxiété")).toBe(true);
    expect(set.has("Anxiety")).toBe(true);
  });

  // Regression: a client picking an admin pro-catalog mandat/expertise item must
  // pass submission validation (else the booking 400s and the feature is defeated).
  it("includes active pro-catalog mandat/expertise labels (FR + EN)", async () => {
    const set = await getValidMotifLabels();
    expect(set.has("Trauma complexe")).toBe(true);
    expect(set.has("Complex trauma")).toBe(true);
  });

  it("only pulls catalog items of category mandat/expertise that are active", async () => {
    await getValidMotifLabels();
    expect(ProCatalogItem.find).toHaveBeenCalledWith({
      active: true,
      category: { $in: ["mandat", "expertise"] },
    });
  });
});
