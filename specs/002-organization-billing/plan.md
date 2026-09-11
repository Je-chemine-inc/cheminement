# Plan 002 — Organization-paid patients

Approved by the owner 2026-09-11. Spec: [spec.md](spec.md).

## Architecture

### Principle: `Appointment.payment` stays the *client's* account

`payment.price/platformFee/professionalPayout/status` keep meaning "what the client owes", with
today's invariant `price = fee + payout`. The organization's side lives in a separate
server-owned snapshot, `Appointment.thirdPartyBilling` (integer **cents**), and in a new
`OrganizationInvoice` collection. Session totals = client share + org share.

Why: ~30 files read `payment.price`. Reminders, off-session charging, `/pay`, receipts and the
Connect payout keep working untouched; only reports and the pro ledger learn the totals.

### New models

- **`src/models/Organization.ts`** — name, kind (employer/eap/school/person/other),
  billingEmails[] (≤5), contact, address, language, `paymentTermsDays` (30), `billingCycle`
  (per_session|monthly), `negotiatedRateCents?`, `gapPolicy`, `autoSendPerSession` (false),
  `requiresOwnForm` + notes, `active`/`archivedAt`, `stripeCustomerId?`. Copy the
  `ProCatalogItem` pattern (`src/models/ProCatalogItem.ts`, `src/lib/pro-catalog.ts`).
- **`src/models/OrganizationCoverage.ts`** — one authorization per client↔org: `clientId`,
  `beneficiaryKey` ("self" or `loved-one:<name>` so a guardian's own sessions aren't billed to
  a child's coverage), `organizationId`, `caseNumber`, `mode` (full|split|per_session|external),
  `split {fixed|percent, value}`, `maxSessions?`, **`consumedAppointmentIds[]`**,
  `rateCentsOverride?`, `validFrom/Until`, `status` (active|exhausted|ended), versioned
  `consent {...}`, notification stamps. Partial unique index: one **active** coverage per
  `{clientId, beneficiaryKey}`.
- **`src/models/OrganizationInvoice.ts`** — kind (session|statement), `draftKey` (unique:
  `session:<aptId>` / `statement:<orgId>:<YYYY-MM>`), `number?` (allocated **at send**),
  period, status (draft|issuing|sent|partially_paid|paid|overdue|void|refunded), `lines[]`
  **frozen at send** (patient name, case #, pro name/title/licence, date, duration, amount —
  nothing else), totals/paid/balance cents, billTo snapshot, `dueAt`, `payToken`,
  `stripePaymentIntentId`, `interacReferenceCode`, `payments[]`, reminder stamps,
  **`sendLog[]`** (the Loi 25 record of every disclosure), notes, admin-only attachment.

### Appointment additions (`src/models/Appointment.ts`)

- `payerDeclaration?` — client-supplied at booking, unverified: org name ≤120, case # ≤60,
  consent, `status` pending|confirmed|rejected, `coverageId`.
- `billingOverride?` — admin-only per-session choice: organization|client|external.
- `thirdPartyBilling?` — **server-only**, written at closure: kind, state
  (confirmed|awaiting_decision), reason, org/coverage/case, list/org/client/clinic-delta cents,
  pro basis + totals, `consumedCapSlot`, `orgInvoiceId`, `orgStatus`, decision stamps.
- New payment status **`"covered"`** (client owes nothing). Not `"cancelled"`: that already
  means two other things and is counted as paid on the pro billing page.

Coverage is **looked up at closure** from (clientId, beneficiary) — it is not pinned on
appointments, so none of the ~6 creation paths and the follow-up copy need to change.

### The single decision point — `src/lib/third-party-billing.ts` (pure)

`resolveSessionPayers({ outcome, listPriceCents, proShareRatio, coverage, org, override,
declarationPending, capSlot }) → PayerPlan`, plus `wouldConsumeCapSlot()`. Cents helpers go in
a new pure `src/lib/money-cents.ts` (`src/lib/stripe.ts` throws on import without a key).

Rules, in order:
1. Free cancellation (fraction 0) → all zero, no slot.
2. **Late cancel / no-show → client, full price, card charged, no slot** — whatever the coverage.
3. Override "client" → today's behaviour.
4. External → client price = list, `paid`, method manual, payer label = org; consumes a cap slot.
5. Organization pays → if cap slot denied: client (`cap_exhausted`). If consent missing or a
   declaration is unconfirmed: **awaiting_decision**. Split: org pays fixed/percent of list,
   client pays rest, pro on list. Otherwise with rate = override ?? org rate ?? list:

| Case (list 120, pro 90%, rate 90) | Client `payment` | status | Org | Pro total | Client docs |
|---|---|---|---|---|---|
| Full, no rate | 0 | covered | 120 | 108 | none |
| Rate < list, **client pays gap** | 30 (card charged) | paid/pending | 90 | 108 | receipt for 30 |
| Rate < list, **clinic absorbs, pro full** | 0 | covered | 90 | 108 (clinic −18 margin) | none |
| Rate < list, **clinic absorbs, pro on rate** | 0 | covered | 90 | 81 | none |
| Rate **>** list (e.g. 140) | 0 | covered | 140 | 108 (clinic keeps +20) | none |
| Cap reached | 120 | as today | 0 | 108 | as today |
| Split, org 80 % | 24 | paid/pending | 96 | 108 | receipt for 24 |
| Undecided | 0 | covered (awaiting) | provisional | 108 | none; admin alert |
| External | 120, manual | paid | 0 (label = org) | 108 | receipt « Réglé hors plateforme — payeur : X » |
| No-show / late cancel | 120 | card charged | 0 | 108 | as today |

Invariants (tested): each side `price = fee + payout` in cents · pro total = client payout + org
payout · org + client + clinic delta = list · no-show always client.

**Cap counting** is an atomic, retry-safe set on the coverage — not a derived count (races) and
not `$inc` (not idempotent across closure rollback):
`findOneAndUpdate({_id, $or:[{consumedAppointmentIds: apt}, {status:"active", $expr: size < maxSessions}]}, {$addToSet: {consumedAppointmentIds: apt}})`,
then mark `exhausted` at the cap. Released on closure rollback or reassign-to-client.

---

## Phases — each ships alone, green on `pnpm test` + `pnpm build`

A flag `PlatformSettings.organizationBillingEnabled` (default **off**) keeps phases 1–5 dark in
production until you turn it on. With the flag off, closure is byte-for-byte today's code.

### Phase 0 — Security fixes (ship first, independent of the feature)

Re-verified in the code; these are live holes today:

1. **`DELETE /api/appointments/[id]` has no role or ownership check** — any signed-in user can
   hard-delete any appointment, including closed, invoiced, ledgered ones. → admin only, and
   409 once `sessionCompletedAt` / `invoiceNumber` is set.
2. **Member booking saves the raw body** (`src/app/api/appointments/route.ts:692`
   `new Appointment(data)`): a client can send `payment:{status:"paid"}`, pay nothing, and be
   emailed an official receipt. **`PATCH /api/appointments/[id]`** writes an unfiltered body
   (including `$set` operators). **Guest booking** spreads the body into root fields.
   → new `src/lib/appointment-writable-fields.ts` (`rejectOperatorKeys`,
   `stripServerOwnedAppointmentFields`, `sanitizePayerDeclaration`) wired into all three.
3. `/pay` links for no-show / late-cancel fees don't work (`/pay` requires status completed) —
   they matter here because those fees always go to the client.
4. An abandoned `/pay` leaves status `processing`, silencing all reminders → only mark
   processing after Stripe confirms; one-off dry-run repair script.
5. Consolidate the three copies of `SETTLED_PAYMENT_STATUSES` into
   `src/lib/client-payment-guarantee.ts`; fix `src/types/api.ts` `PaymentStatus` drift.

Regression test first for each; confirm with you before merging (money + auth).

### Phase 1 — Dark data model + pure core
Three models; Appointment/ledger/settings fields; `"covered"` in the enum, types, settled and
reprice-locked lists; `third-party-billing.ts`, `money-cents.ts`,
`src/lib/organization-coverage.ts` (`findApplicableCoverage`, `reserveCoverageSlot`,
`releaseCoverageSlot`); redaction (`src/lib/redact-payment.ts` reduces `thirdPartyBilling` to
`{kind, proPayoutTotalCents}` for pros; client routes drop org amounts; pro ledger route moves
to an allow-list); `src/lib/account-merge.ts` learns coverages (row by row, like
`mergeResourceEntitlements`).
**Tests:** exhaustive resolver table (outcome × mode × gap policy × override × cap × rate
below/equal/above) with the invariants; coverage slot race/retry/exhaust; redaction; merge.

### Phase 2 — Closure integration (the money core)
- `src/app/api/appointments/[id]/complete-session/route.ts`: after the atomic claim and
  **before the card charge**, `planSessionPayers()` (new `src/lib/session-payer-plan.ts`:
  flag → coverage → slot → resolver). Charge **only** `plan.client`; never charge for external;
  release the slot in the existing rollback `catch`.
- `src/lib/session-post-closure.ts`: billable = client + org > 0 (today it's gated on
  `price > 0`, which would silently stop crediting pros for covered sessions); ledger credit on
  **totals**, channel `"organization"`; zero client share → no JC number, no client email;
  awaiting-decision and cap alerts claimed per appointment; external receipt carries the payer
  label.
- Admin: `POST /api/admin/appointments/[id]/payer` (reassign org↔client after closure, with
  ledger adjustment rows) and `PUT .../billing-override` (before closure).
- `src/lib/billing-totals.ts` for reports; sales journal `isCreditCleared`; "covered" labels in
  client, pro and admin billing screens.
**Tests:** complete-session specs (flag off unchanged · full coverage never charges · co-pay
charges exactly the client share · no-show charges client, no slot · cap denied → client ·
rollback releases slot · external no charge · follow-up copies no billing fields);
post-closure ledger-on-totals; reminders exclude `covered`.

### Phase 3 — Admin setup + intake
- Organizations admin (gate: `manageBilling`, via a `requireBillingAdmin` modelled on
  `src/lib/pro-catalog.ts`): `src/app/api/admin/organizations/**`,
  `src/app/(privilaged)/admin/dashboard/organizations/page.tsx`, sidebar entry.
- Coverages: `src/app/api/admin/coverages/**`, `src/components/admin/CoveragePanel.tsx` in the
  patient dossier (`src/app/(privilaged)/admin/dashboard/patients/[id]/page.tsx`) — terms, end,
  record/withdraw consent (method + mandatory note), negative-margin warning.
- Intake: surgical block in the review step of `src/app/appointment/page.tsx` (free text +
  unticked versioned consent box); badge in `src/components/admin/RequestsQueueTable.tsx`;
  `src/app/api/admin/service-requests/[id]/payer-declaration/route.ts` (confirm → coverage,
  or reject), modelled on `[id]/emergency/route.ts`.
- Pro badge « PAE — séance 4/6 »; client + admin "1 session left" notices.
- Emails: `admin_third_party_payer_declared`, `client_coverage_confirmed`,
  `client_coverage_exhausted` (+ cap-warning variant).
From here the flag can go on: covered sessions stop charging clients, external works, org
sessions accumulate as "unbilled".

### Phase 4 — Organization invoices & statements (first time data leaves) — minimum go-live
- `src/lib/organization-invoice.ts` (`draftForSession`, `draftStatement`, `refreshDraft`,
  `voidInvoice`, `issueAndSend`, `buildInvoiceLine` = strict allow-list);
  `src/lib/organization-invoice-pdf.ts` — its input type **has no act/motif/therapy fields**;
  own number series `JCO-YYYY-000001` (`nextOrganizationInvoiceNumber` in
  `src/lib/invoice-number.ts`), allocated after an atomic `draft→issuing` claim.
- **Consent gate** `assertLinesDisclosable()` at every send/resend/auto-send → 409 listing
  blocked lines; no bypass.
- `src/app/api/admin/organization-invoices/**` (list, send, void, refresh, PDF, mark-paid,
  attachment — **not** via `/api/files/[id]`, which any signed-in user can read) and page
  `src/app/(privilaged)/admin/dashboard/organization-invoices/page.tsx`.
- Cron `src/app/api/cron/organization-billing/route.ts`: monthly drafts (America/Toronto
  period), per-session drafts + auto-send where enabled, one review digest per org/period —
  **every send claimed per item** (this week's hourly-alert lesson).
- Manual invoice gains `payer: "organization" | "external"`.
- Ops: add the cron line to `/etc/cron.d/jechemine` (never leave backup copies in `cron.d`),
  update `docs/ops/HANDOFF.md` §7.
- Emails: `organization_invoice`, `organization_statement`, `admin_organization_statement_review`.
**Tests:** no-clinical-content guarantee (feed an appointment full of clinical data; assert the
line object *and the PDF text* contain none of it) · draft idempotency · number only at send ·
consent 409 · void releases lines · cron double-run safe.

### Phase 5 — Online org payment + org dunning
- `src/app/org-pay/page.tsx` + `src/app/api/organization-invoices/pay/route.ts` (shows only org,
  number, balance, due date — no patient names; amount from DB; metadata
  `type: "organization_invoice"`, **no `appointmentId`**).
- Webhook (`src/app/api/payments/webhook/route.ts`): new branch **before** the `appointmentId`
  fallback in succeeded/failed/cancelled, and an `OrganizationInvoice` lookup before the
  appointment lookup in refund/dispute handlers — same pattern as `resource_purchase`.
  `src/lib/organization-invoice-settlement.ts`: idempotent settle, partial payments, overpayment
  → admin review, never auto-refund.
- Interac: `ORG-XXXX-XXXXXX` codes; `REFERENCE_CODE_RE` in `src/lib/interac-notification.ts`
  accepts `INT|ORG`; reconciler branches on prefix, exact-cents match only.
- Reminders at due date, +14 d, +30 d → overdue + admin alert; each stamp claimed atomically.
  Org reminders carry number + amount only — no names, no PDF.
- Emails: `organization_payment_reminder`, `organization_payment_received`,
  `admin_organization_invoice_overdue`.
- **As built (2026-09-11):** the Interac reference is the invoice **number** (`JCO-…`), not a
  separate `ORG-` code — the PDF already asked for it, and two references per invoice is the
  problem `interac-reference.ts` documents fixing for clients. The pay link is **card only**
  (a PAD debit settles days later and can bounce after the invoice looks paid). Anything a
  person must look at (overpayment, money on a void invoice, refund, chargeback) also gets
  its own email, `admin_organization_payment_review`. Reminders go out weekdays 8 h – 18 h
  Montréal. Details and invariants: debt-map, 2026-09-11 phase 5 entry.

### Phase 6 — Accounting & polish
Org receivables aging report, anomalies (overdue org invoices, awaiting decisions, confirmed
sessions never invoiced after 35 d, cap mismatch, negative margins), "Payer" column in admin
billing, client dashboard « 3/10 séances utilisées ».
- **As built (2026-09-11):** aging + anomalies live at the top of "Factures aux organismes"
  (billing admins; CSV export), plus a sixth list, payments to review (phase 5's credits,
  disputes, refunds, money on void invoices). The client's « 3/10 » is on their billing page
  and is hidden while the organization-billing switch is off.

---

## Reuse, don't rebuild

| Need | Existing code |
|---|---|
| Admin CRUD collection | `ProCatalogItem` model, `src/lib/pro-catalog.ts`, `src/app/api/admin/pro-catalog/**`, its page |
| Permission checks | `getActiveAdminPermissions`, `mustMaskClientContactPII` in `src/lib/admin-rbac.ts` |
| Attach a flag to a request | `src/app/api/admin/service-requests/[id]/emergency/route.ts` |
| Third-party info at intake | `lovedOneInfo` / `referralInfo` + `src/lib/service-request-recipient.ts` |
| "Waive nudges, still collect no-show" | `interac_trust` + the two gates in `src/lib/client-payment-guarantee.ts` |
| Receipt billed-to vs seen-by | `clientName` / `recipientName` in `src/lib/receipt-pdf.ts` |
| Webhook branch before appointment fallback | `resource_purchase` branch in the webhook |
| Idempotent claim / conditional update | payout route; `grantResourceEntitlement` |
| Once-per-item alert stamps | `isPostMeetingAdminAlertDue` + `postMeetingAdminAlertSentAt` |
| New email type (5 touch points) | `EmailTemplate.ts`, `email-template-registry.ts`, `PlatformSettings.ts`, admin settings `EMAIL_TEMPLATE_INFO` **+ `TEMPLATE_CATEGORIES`**, `notifications.ts` — one type per email, never shared |

## Risks

1. **Closure ordering** — reserve → charge → persist → side effects; a mistake charges a covered
   client or leaks a cap slot. Specs on every branch; the flag is the kill switch.
2. **Negative margin** under "clinic absorbs, pro paid in full" — real money; warned in the
   coverage form and listed in anomalies.
3. **Ledger adjustment rows** break "one credit per appointment" assumptions in the sales
   journal and pro views — `adjustsAppointmentId` column + allow-list redaction.
4. **Hourly cron multiplying sends** — every org email claimed per item before sending.
5. **Legacy UTC-midnight dates** can land a session in the wrong month — mitigated by admin
   review of every statement.
6. **CI runs only `next build`** — run `pnpm test` locally every phase.

## Verification

- **Specs per phase** as listed; mutation-check the critical ones (remove the slot `$or`, move
  the webhook branch after the fallback, drop the consent gate, re-allow `payment` in the
  booking body) — each must fail.
- **End-to-end** on a scratch local MongoDB + Stripe test mode + `stripe listen` (verify the
  `acct_` id first), flag on: run every row of the payer table through a real closure and check
  `payment`, `thirdPartyBilling`, the ledger row, JC number, client email or its absence; org
  draft → send → PDF text searched for clinical words; `/org-pay` with card 4242 settling via
  webhook; an ORG Interac notification auto-settling; two concurrent closures on the last cap
  slot → exactly one covered; forced failure after reservation → slot released, retry works;
  consent withdrawal blocks a send; a client PATCH forging `covered`/`paid` refused.
- **Production:** turn the flag on for one organization with a test client; confirm
  `Email sent [organization_invoice]` to the right address and the PDF contents.

