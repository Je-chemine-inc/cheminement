import { NextRequest, NextResponse } from "next/server";
import ProfessionalLedgerEntry from "@/models/ProfessionalLedgerEntry";
// Register the Appointment model so populate() resolves refs — without it the
// export failed ("Schema hasn't been registered") until some other route had
// loaded the model since the server started.
import "@/models/Appointment";
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

/** Grand livre complet : crédits et débits (archive / impôts). */
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
    })
      .populate("professionalId", "firstName lastName email")
      .populate("appointmentId", "date time")
      .sort({ createdAt: 1 })
      .lean();

    const header = [
      "date",
      "type_ligne",
      "cycle_key",
      "professional_id",
      "professional_name",
      "appointment_id",
      "credit_net_pro_cad",
      "debit_versement_cad",
      "ref_versement",
      "notes",
      "canal",
    ].join(",");

    const lines = rows.map((r) => {
      const pro = r.professionalId as unknown as {
        firstName?: string;
        lastName?: string;
      } | null;
      const proName = pro
        ? `${pro.firstName ?? ""} ${pro.lastName ?? ""}`.trim()
        : "";
      const kind = r.entryKind === "debit" ? "debit" : "credit";
      const creditAmt =
        kind === "credit" ? r.netToProfessionalCad ?? 0 : "";
      const debitAmt =
        kind === "debit" ? r.payoutAmountCad ?? 0 : "";
      return [
        csvEscape(
          r.createdAt
            ? new Date(r.createdAt).toISOString().slice(0, 10)
            : "",
        ),
        csvEscape(kind),
        csvEscape(r.cycleKey),
        csvEscape(refId(r.professionalId)),
        csvEscape(proName),
        csvEscape(refId(r.appointmentId)),
        csvEscape(creditAmt),
        csvEscape(debitAmt),
        csvEscape(r.payoutReference),
        csvEscape(r.payoutNotes),
        csvEscape(r.paymentChannel),
      ].join(",");
    });

    const csv = [header, ...lines].join("\n");
    const bom = "\ufeff";

    return new NextResponse(bom + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="grand-livre-${year}.csv"`,
      },
    });
  } catch (e: unknown) {
    console.error("admin ledger-full:", e);
    return NextResponse.json(
      { error: "Failed to export ledger" },
      { status: 500 },
    );
  }
}
