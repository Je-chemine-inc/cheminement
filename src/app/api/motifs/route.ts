import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import Motif from "@/models/Motif";
import ProCatalogItem from "@/models/ProCatalogItem";

export interface PublicMotif {
  id: string;
  labelFr: string;
  labelEn: string;
  aliases: string[];
}

export async function GET() {
  try {
    await connectToDatabase();

    // The booking "problématique" picker = the Motif catalog PLUS the admin's
    // matchable pro-catalog items (mandat + expertise). Surfacing them here means
    // a client can pick the same vocabulary a pro declared as an expertise, so
    // the matcher scores an exact hit. "approche" is excluded (it's a pro-only
    // dimension the matcher doesn't score).
    const [docs, catalog] = await Promise.all([
      Motif.find({ active: true }).select("labelFr labelEn aliases").lean(),
      ProCatalogItem.find({
        active: true,
        category: { $in: ["mandat", "expertise"] },
      })
        .select("labelFr labelEn")
        .lean(),
    ]);

    const motifs: PublicMotif[] = docs.map((d) => ({
      id: String(d._id),
      labelFr: d.labelFr,
      labelEn: d.labelEn || "",
      aliases: d.aliases || [],
    }));

    // Append catalog items not already present as a Motif (dedup by FR label).
    const seen = new Set(motifs.map((m) => m.labelFr.trim().toLowerCase()));
    for (const c of catalog) {
      const key = c.labelFr.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      motifs.push({
        id: String(c._id),
        labelFr: c.labelFr,
        labelEn: c.labelEn || "",
        aliases: [],
      });
    }

    return NextResponse.json(
      { motifs },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    console.error("List public motifs error:", error);
    return NextResponse.json(
      { error: "Failed to load motifs" },
      { status: 500 },
    );
  }
}
