import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import { getBiweeklyCycleKey } from "@/lib/ledger-cycle";
import { splitProductSaleCents } from "@/lib/product-rules";

/**
 * A professional's share of a product sale in their ledger (spec 003 phase 5).
 *
 * Rather than one handler per Stripe event, the ledger is brought to what the
 * purchase is worth to the professional right now:
 *   - paid, not disputed → the net of the amount paid at the snapshotted commission
 *   - refunded in full, or disputed → nothing
 * A partial refund keeps the purchase paid, so it changes nothing: the platform
 * absorbs it. The difference with the rows already written is added as one
 * more row — the sale, a reversal, or a recredit after a refund that failed.
 *
 * So the order in which the checkout confirmation and the webhooks arrive does
 * not matter, a replay adds nothing, and each correction's `ledgerKey`
 * (`product:<entitlementId>:<n>`) is unique: two runs racing for the same row
 * cannot both write it. A database error throws, so Stripe retries the event.
 */

const MAX_ATTEMPTS = 3;

type EntitlementRow = {
  _id: unknown;
  slug: string;
  status: string;
  disputed?: boolean;
  amountCents: number;
  /** Set when TPS and TVQ were added at checkout: the professional's sale is the price before them. */
  subtotalCents?: number;
  commissionBps?: number;
  ownerProfessionalId?: unknown;
};

export type ProductLedgerOutcome =
  | { changed: false; reason: "not-a-product" | "in-balance" }
  | { changed: true; source: "product_sale" | "product_sale_reversal" | "product_sale_recredit"; netCents: number };

export async function syncProductLedger(entitlementId: string, now: Date = new Date()): Promise<ProductLedgerOutcome> {
  if (!mongoose.Types.ObjectId.isValid(entitlementId)) return { changed: false, reason: "not-a-product" };
  await connectToDatabase();

  for (let attempt = 1; ; attempt++) {
    const ent = await ResourceEntitlement.findById(entitlementId)
      .select("slug status disputed amountCents subtotalCents commissionBps ownerProfessionalId")
      .lean<EntitlementRow | null>();
    if (!ent?.ownerProfessionalId || typeof ent.commissionBps !== "number") {
      return { changed: false, reason: "not-a-product" };
    }

    // TPS and TVQ added at checkout belong to the tax authorities, not to the
    // sale: the commission and the professional's share come from the price before them.
    const saleCents = typeof ent.subtotalCents === "number" ? ent.subtotalCents : ent.amountCents;
    const owed = ent.status === "paid" && ent.disputed !== true;
    const split = splitProductSaleCents(owed ? saleCents : 0, ent.commissionBps);
    const target = { gross: owed ? saleCents : 0, fee: split.platformFeeCents, net: split.netToProfessionalCents };

    const rows = await ProfessionalLedgerEntry.find({ entitlementId: ent._id })
      .select("grossAmountCad platformFeeCad netToProfessionalCad")
      .lean<{ grossAmountCad?: number; platformFeeCad?: number; netToProfessionalCad?: number }[]>();
    const cents = (value: number | undefined) => Math.round((value ?? 0) * 100);
    const written = rows.reduce(
      (sum, row) => ({
        gross: sum.gross + cents(row.grossAmountCad),
        fee: sum.fee + cents(row.platformFeeCad),
        net: sum.net + cents(row.netToProfessionalCad),
      }),
      { gross: 0, fee: 0, net: 0 },
    );

    const delta = { gross: target.gross - written.gross, fee: target.fee - written.fee, net: target.net - written.net };
    if (delta.gross === 0 && delta.fee === 0 && delta.net === 0) return { changed: false, reason: "in-balance" };

    const source = rows.length === 0 ? "product_sale" : delta.net < 0 ? "product_sale_reversal" : "product_sale_recredit";
    try {
      await ProfessionalLedgerEntry.create({
        professionalId: ent.ownerProfessionalId,
        entryKind: "credit",
        cycleKey: getBiweeklyCycleKey(now),
        grossAmountCad: delta.gross / 100,
        platformFeeCad: delta.fee / 100,
        netToProfessionalCad: delta.net / 100,
        paymentChannel: "stripe",
        source,
        ledgerKey: `product:${String(ent._id)}:${rows.length}`,
        entitlementId: ent._id,
        productSlug: ent.slug,
      });
      return { changed: true, source, netCents: delta.net };
    } catch (error) {
      // Another run wrote this row first: read again and settle what is left.
      if ((error as { code?: number })?.code === 11000 && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
  }
}
