import Motif from "@/models/Motif";
import ProCatalogItem from "@/models/ProCatalogItem";

/**
 * Returns the labels (FR + EN) accepted as valid motifs for user submissions.
 * Includes active Motifs PLUS the active admin pro-catalog "mandat"/"expertise"
 * items — the exact set surfaced into the booking picker by GET /api/motifs, so
 * a client can actually submit (and the matcher score) a catalog item. "approche"
 * is excluded, mirroring the picker. Call after `connectToDatabase()`.
 */
export async function getValidMotifLabels(): Promise<Set<string>> {
  const [motifs, catalog] = await Promise.all([
    Motif.find({ active: true }).select("labelFr labelEn").lean(),
    ProCatalogItem.find({
      active: true,
      category: { $in: ["mandat", "expertise"] },
    })
      .select("labelFr labelEn")
      .lean(),
  ]);
  const set = new Set<string>();
  for (const d of [...motifs, ...catalog]) {
    if (d.labelFr) set.add(d.labelFr);
    if (d.labelEn) set.add(d.labelEn);
  }
  return set;
}
