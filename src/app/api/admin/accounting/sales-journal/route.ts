import { NextRequest, NextResponse } from "next/server";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
import ResourceEntitlement from "@/models/ResourceEntitlement";
// Also registers the Appointment model so populate() resolves refs — without
// it the export failed ("Schema hasn't been registered") until some other
// route had loaded the model since the server started.
import Appointment from "@/models/Appointment";
import { isLedgerCreditCleared, refundedAmountCad } from "@/lib/billing-totals";
import { getBiweeklyCycleKey } from "@/lib/ledger-cycle";
import { requireBillingAdmin } from "@/lib/organization-admin";

function csvEscape(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "";
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** A populated reference is a document: print its id, not "[object Object]". */
function refId(ref: unknown): string {
  if (ref && typeof ref === "object" && "_id" in ref) {
    return String((ref as { _id: unknown })._id);
  }
  return ref ? String(ref) : "";
}

const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

const nameOf = (ref: unknown) => {
  const p = ref as { firstName?: string; lastName?: string } | null;
  return p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "";
};

type JournalLine = { at: number; cells: Array<string | number | null | undefined> };

/**
 * Journal des ventes (crédits séance) — export CSV pour comptable.
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireBillingAdmin();
    if (gate.error) return gate.error;

    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get("year");
    const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }

    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    const rows = await ProfessionalLedgerEntry.find({
      createdAt: { $gte: start, $lt: end },
      $or: [{ entryKind: "credit" }, { entryKind: { $exists: false } }],
    })
      .populate("professionalId", "firstName lastName email")
      .populate(
        "appointmentId",
        // The org side is select:false; naming it includes it (spec 002).
        "date time status sessionActNature payment.status thirdPartyBilling.orgStatus thirdPartyBilling.clientAmountCents",
      )
      .sort({ createdAt: 1 })
      .lean();

    // M17: don't recognize uncleared money as revenue — an unconfirmed Interac
    // transfer, a card session nothing was charged for yet, or an organization
    // that has not paid (spec 002). Rules in isLedgerCreditCleared; it reads
    // `payment.status`, so keep it in the populate above.
    const cleared = rows.filter((r) =>
      isLedgerCreditCleared(
        r,
        r.appointmentId as unknown as Parameters<typeof isLedgerCreditCleared>[1],
      ),
    );

    const header = [
      "date_ligne",
      "cycle_key",
      "professional_id",
      "professional_name",
      "appointment_id",
      "session_date",
      "acte",
      "brut_cad",
      "frais_plateforme_cad",
      "net_pro_cad",
      "canal_paiement",
      "type_ligne",
      "tps_cad",
      "tvq_cad",
    ].join(",");

    // TPS and TVQ collected on a product sale (added at checkout), read from the
    // purchase. A reversal carries them negative; session lines have none.
    const entitlementIds = cleared.map((r) => r.entitlementId).filter(Boolean);
    const taxesByEntitlement = new Map(
      (entitlementIds.length
        ? await ResourceEntitlement.find({ _id: { $in: entitlementIds } })
            .select("tpsCents tvqCents")
            .lean<{ _id: unknown; tpsCents?: number; tvqCents?: number }[]>()
        : []
      ).map((e) => [String(e._id), e]),
    );
    const taxCells = (r: { entitlementId?: unknown; grossAmountCad?: number }) => {
      const taxes = r.entitlementId ? taxesByEntitlement.get(String(r.entitlementId)) : undefined;
      if (typeof taxes?.tpsCents !== "number" || typeof taxes?.tvqCents !== "number") return ["", ""];
      const sign = (r.grossAmountCad ?? 0) < 0 ? -1 : 1;
      return [(sign * taxes.tpsCents) / 100, (sign * taxes.tvqCents) / 100];
    };

    const sales: JournalLine[] = cleared.map((r) => {
      const apt = r.appointmentId as unknown as { date?: Date } | null;
      return {
        at: r.createdAt ? new Date(r.createdAt).getTime() : 0,
        cells: [
          day(r.createdAt),
          r.cycleKey,
          refId(r.professionalId),
          nameOf(r.professionalId),
          refId(r.appointmentId),
          day(apt?.date),
          // A product sale (spec 003 phase 5) names its product instead of an act.
          r.sessionActNature ?? r.productSlug,
          r.grossAmountCad,
          r.platformFeeCad,
          r.netToProfessionalCad,
          r.paymentChannel,
          r.source === "product_sale_reversal"
            ? "remboursement_produit"
            : r.source === "product_sale" || r.source === "product_sale_recredit"
              ? "vente_produit"
              : "vente",
          ...taxCells(r),
        ],
      };
    });

    // Refunds: a card sale refunded during the year comes back as a negative
    // line on the refund's date — Stripe's cumulative amount, at the latest
    // refund. A refund never reduces the professional's ledger credit, so the
    // clinic absorbs it: the whole amount comes off the platform's share.
    const refundedSessions = await Appointment.find({
      "payment.refundedAt": { $gte: start, $lt: end },
      "payment.status": { $in: ["refunded", "partially_refunded"] },
    })
      .select("date payment.status payment.refundedAt payment.refundedAmount payment.price")
      .lean();
    const refundedCredits = refundedSessions.length
      ? await ProfessionalLedgerEntry.find({
          appointmentId: { $in: refundedSessions.map((a) => a._id) },
          entryKind: "credit",
          paymentChannel: "stripe",
        })
          .populate("professionalId", "firstName lastName email")
          .lean()
      : [];
    const sessionOf = new Map(refundedSessions.map((a) => [String(a._id), a]));
    const refunds: JournalLine[] = [];
    for (const r of refundedCredits) {
      const apt = sessionOf.get(refId(r.appointmentId));
      const amount = apt ? refundedAmountCad(apt, r.grossAmountCad ?? 0) : 0;
      if (!apt || amount <= 0) continue;
      const at = apt.payment.refundedAt ? new Date(apt.payment.refundedAt) : new Date();
      refunds.push({
        at: at.getTime(),
        cells: [
          day(at),
          getBiweeklyCycleKey(at),
          refId(r.professionalId),
          nameOf(r.professionalId),
          refId(r.appointmentId),
          day(apt.date),
          r.sessionActNature,
          -amount,
          -amount,
          0,
          r.paymentChannel,
          "remboursement",
          "",
          "",
        ],
      });
    }

    const lines = [...sales, ...refunds]
      .sort((a, b) => a.at - b.at)
      .map((l) => l.cells.map((c) => csvEscape(c)).join(","));

    const csv = [header, ...lines].join("\n");
    const bom = "\ufeff";

    return new NextResponse(bom + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="journal-ventes-${year}.csv"`,
      },
    });
  } catch (e: unknown) {
    console.error("admin sales journal:", e);
    return NextResponse.json(
      { error: "Failed to export journal" },
      { status: 500 },
    );
  }
}
