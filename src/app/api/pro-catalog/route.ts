import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import ProCatalogItem, {
  PRO_CATALOG_CATEGORIES,
  type ProCatalogCategory,
} from "@/models/ProCatalogItem";

/**
 * Public, read-only feed of the ACTIVE admin-managed catalog items, grouped by
 * category. Consumed (pre-auth) by the professional signup / profile form to add
 * extra checkboxes, and by the client booking flow so the same matchable
 * "mandat"/"expertise" vocabulary is selectable on both sides.
 */
export async function GET() {
  try {
    await connectToDatabase();
    const docs = await ProCatalogItem.find({ active: true })
      .sort({ labelFr: 1 })
      .select("category labelFr labelEn")
      .lean();

    const grouped: Record<ProCatalogCategory, { labelFr: string; labelEn: string }[]> = {
      mandat: [],
      approche: [],
      expertise: [],
    };
    for (const d of docs) {
      if (PRO_CATALOG_CATEGORIES.includes(d.category)) {
        grouped[d.category].push({
          labelFr: d.labelFr,
          labelEn: d.labelEn || d.labelFr,
        });
      }
    }
    return NextResponse.json(
      { items: grouped },
      { headers: { "Cache-Control": "public, max-age=120" } },
    );
  } catch (error) {
    console.error("Public pro-catalog error:", error);
    return NextResponse.json(
      { items: { mandat: [], approche: [], expertise: [] } },
      { status: 200 },
    );
  }
}
