# ADR-0002 — Third-party payer model

**Status:** Accepted — 2026-09-11
**Context:** [spec 002](../../../specs/002-organization-billing/spec.md)

## Context

Some sessions are paid by an organization, fully or in part, while the client still guarantees
no-show and late-cancel fees. Each appointment has exactly one `payment` subdocument, read by about
30 files (closure charging, dunning, `/pay`, receipts, Stripe Connect payouts, reports).

## Decision

1. **`Appointment.payment` stays the client's account.** It holds the client's share only — 0 when an
   organization pays in full — with its existing invariant `price = platformFee + professionalPayout`.
   Everything that reads it keeps working unchanged.
2. **The organization's side is a separate snapshot, `Appointment.thirdPartyBilling`, in integer
   cents,** written once at closure. Organization invoices live in their own collection,
   `OrganizationInvoice`, because a statement spans many sessions and has its own lifecycle (send,
   void, dunning, partial payment).
3. **One pure decision point:** `resolveSessionPayers()` in `src/lib/third-party-billing.ts` decides
   who pays what. The closure gathers facts; the resolver has no I/O.
4. **Coverage is looked up at closure** from (client, beneficiary), never pinned on appointments, so
   no appointment-creation path had to change.
5. **The session cap is a set of appointment ids** reserved with one atomic `findOneAndUpdate` — not a
   derived count (races) and not a counter (not idempotent across closure retries).
6. **A new payment status, `covered`,** means "the client owes nothing". It joins
   `SETTLED_PAYMENT_STATUSES`, which silences every dunning gate. `cancelled` was rejected: it already
   means two other things and is counted as paid on the professional billing page.
7. **Fail-closed confidentiality:** `thirdPartyBilling` and `billingOverride` are `select: false` on
   the schema, so no query returns them unless it asks by name. Professional and client redaction
   helpers are a second layer.
8. **A feature flag,** `PlatformSettings.organizationBillingEnabled` (off), keeps closure identical to
   today until the owner turns it on.

## Consequences

- Reports and the professional ledger must add the organization's share to see session totals.
- A fully covered session's `payment.professionalPayout` is 0; professional views must read
  `thirdPartyBilling.proPayoutTotalCents`.
- Ledger adjustments (a payer changed after closure) are separate rows with `adjustsAppointmentId`,
  because `ProfessionalLedgerEntry.appointmentId` is unique per credit.
- Aggregations ignore `select: false`; any client- or professional-facing aggregate over appointments
  must redact explicitly.
