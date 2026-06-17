import connectToDatabase from "@/lib/mongodb";
import Counter from "@/models/Counter";

/**
 * Allocate the next unique fiscal invoice number, e.g. "JC-2026-000123".
 *
 * The sequence is a single global monotonic counter (atomic $inc), so numbers
 * are unique and gap-free across concurrent session closures. The year prefix
 * is the issue date's year; the sequence itself does NOT reset per year, which
 * keeps allocation a single atomic op while staying unique and ordered.
 */
export async function nextInvoiceNumber(issueDate: Date = new Date()): Promise<string> {
  await connectToDatabase();
  const counter = await Counter.findByIdAndUpdate(
    "invoice",
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const seq = String(counter?.seq ?? 1).padStart(6, "0");
  return `JC-${issueDate.getFullYear()}-${seq}`;
}
