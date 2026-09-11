# Spec 002 — Organization-paid patients (employer / PAE / school / other payer)

**Status:** APPROVED 2026-09-11 — every open question answered by the owner (§3). Phased plan in
[plan.md](plan.md); architecture decision in
[ADR-0002](../../docs/architecture/decisions/0002-third-party-payer-model.md).
**Created:** 2026-09-11.
**Origin:** the clinic asked (2026-09-09/10) whether sessions can be billed to someone other than
the client — « facturer à une autre personne ou à une autre organisation différente du client » —
then refined: « envoyer la facture à une autre personne, juste demander une garantie pour la carte
de crédit en cas d'annulation tardive ou non-présentation ».

---

## 1. Problem

The platform can only bill the client. Every invoice, payment request, reminder and receipt goes
to the client account, and **closing a session charges the client's saved card for every billable
outcome** — nothing checks who is paying. The clinic handles organization-paid patients outside the
platform, and their clients get dunned for fees that are not theirs.

## 2. Goal

An admin-managed list of organizations; a patient can be covered by one (declared by the client at
booking, confirmed by an admin); at closure the platform decides who owes what, charges the client
only their share, invoices the organization per session or by statement, and never shows the
organization anything clinical. The client's card guarantee stays; no-show and late-cancel fees
always go to the client.

## 3. Decisions (owner, 2026-09-11)

| Topic | Decision |
|---|---|
| Organizations | Reusable admin list; no login |
| Coverage | Every session · split/co-pay · admin chooses per session · handled externally — plus an optional session cap (N) on any |
| Handled externally | Recorded as paid externally; client receipt « Réglé hors plateforme — payeur : {org} » |
| Org rate | One negotiated rate per organization |
| Rate below price | Gap policy per org: client pays difference · clinic absorbs (pro on full price) · clinic absorbs (pro on org rate) |
| Rate above price | Org billed its rate; pro paid on normal price; clinic keeps the difference |
| Invoice cycle | Per org: per-session or monthly statement |
| Statements | Auto-drafted; admin reviews then sends |
| Per-session invoices | Auto-send switch per org, off by default |
| Org payment | Pay link (card + Interac) and admin mark-paid |
| Intake | Client declares (free text + case number + consent); admin confirms |
| Payer unclear at closure | Hold for admin decision — nothing charged, pro still credited |
| Org invoice shows | Patient full name + case number · pro name, title, licence · dates, duration, amounts |
| Org invoice never shows | Motif, nature of the act, therapy type, client email |
| Pro payout | Unchanged — credited at closure |
| Consent (Loi 25) | Hard gate on every disclosure |
| Cap alerts | Admin at 1 left · client at 1 left · pro sees « PAE — séance 4/6 » |
| Own claim form (2026-09-11) | One PDF per invoice or statement, filled in by an admin and sent with it under a fixed name (`JCO-…-formulaire.pdf`). If the organization requires it, nothing goes out — the hourly auto-send included — until it is attached, unless an admin sends without it (recorded in the send log) |
| Refunds (2026-09-11) | From the invoice screen. The admin chooses each time: « toujours dû » (the balance comes back, reminders resume — as a Stripe-dashboard refund does) or « plus dû » (a credit is recorded). Refunding an overpayment only brings the balance back to 0. Card: refunded through Stripe; Interac, cheque, EFT: recorded as refunded outside the platform |
| Not in v1 | Per-therapy-type rates · dollar cap · auto-filling orgs' own proforma forms |

## 4. Acceptance criteria

1. With `PlatformSettings.organizationBillingEnabled` off, closure behaves byte-for-byte as before.
2. A session covered in full is never charged to the client's card; its `payment.status` is `covered`
   and no client payment request or reminder is sent.
3. A co-pay session charges the client exactly the client share, and nothing more.
4. A no-show or late cancellation is always billed to the client at full price, whatever the coverage,
   and never consumes a cap slot.
5. The cap is exact under concurrency: two closures racing for the last slot give exactly one
   covered session; a closure rolled back returns its slot.
6. An undecided payer (unconfirmed declaration, per-session with no choice, missing consent) charges
   nobody, credits the professional, and alerts an admin — once.
7. For every plan: each side satisfies `price = fee + payout` in integer cents; the professional's
   total equals the two sides' payouts; client + org + absorbed − surplus = the billed price; the
   client side never carries a negative fee.
8. The professional's ledger is credited on session totals, including for a zero client share.
9. No organization invoice, statement or reminder containing patient data leaves the platform without
   recorded, unwithdrawn consent. Every disclosure is logged.
10. An organization document contains none of: motif, nature of the act, therapy type, client email —
    asserted on the data AND the rendered PDF text.
11. Clients and professionals never receive an organization's amount, negotiated rate, or the clinic's
    margin from any API.
12. A client cannot set any payer or billing field through any request.

## 5. Compliance

Billing an employer, a PAE or a school discloses that the person consulted. The consent text is
versioned (`ORG_BILLING_CONSENT_VERSION`), recorded with its source and method, withdrawable, and
checked at every send. For a minor under 14, consent comes from the guardian.
