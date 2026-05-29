import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";

function csvEscape(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "";
  const t = String(s);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/**
 * Journal des ventes (crédits séance) — export CSV pour comptable.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

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
        "date time status sessionActNature payment.status",
      )
      .sort({ createdAt: 1 })
      .lean();

    // M17: don't recognize uncleared Interac as revenue. Stripe credits
    // (paymentChannel "stripe" = card/direct_debit) clear at closure, but a
    // "transfer" (Interac) credit is only real revenue once an admin confirms
    // the e-transfer (appointment payment.status === "paid"). Exclude
    // transfer-channel credits that are not yet paid from the sales journal.
    const cleared = rows.filter((r) => {
      if (r.paymentChannel !== "transfer") return true;
      const apt = r.appointmentId as unknown as {
        payment?: { status?: string };
      } | null;
      return apt?.payment?.status === "paid";
    });

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
    ].join(",");

    const lines = cleared.map((r) => {
      const pro = r.professionalId as unknown as {
        firstName?: string;
        lastName?: string;
      } | null;
      const apt = r.appointmentId as unknown as {
        date?: Date;
        sessionActNature?: string;
      } | null;
      const proName = pro
        ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
        : "";
      const sessionDate = apt?.date
        ? new Date(apt.date).toISOString().slice(0, 10)
        : "";
      return [
        csvEscape(
          r.createdAt
            ? new Date(r.createdAt).toISOString().slice(0, 10)
            : "",
        ),
        csvEscape(r.cycleKey),
        csvEscape(String(r.professionalId)),
        csvEscape(proName),
        csvEscape(r.appointmentId ? String(r.appointmentId) : ""),
        csvEscape(sessionDate),
        csvEscape(r.sessionActNature),
        csvEscape(r.grossAmountCad),
        csvEscape(r.platformFeeCad),
        csvEscape(r.netToProfessionalCad),
        csvEscape(r.paymentChannel),
      ].join(",");
    });

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
