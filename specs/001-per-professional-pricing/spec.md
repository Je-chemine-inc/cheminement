# Spec 001 — Per-professional pricing, set by admin

**Status:** READY FOR PLANNING — all five open questions answered 2026-08-31 (see §7).
**Created:** 2026-08-31.
**Origin:** a client reported that changing the platform tarif in *Paramètres* did not update
existing or upcoming appointments. Investigation found three separate defects behind that one
symptom; one is already fixed (§2), the other two are what this spec addresses.

---

## 1. Problem

The admin *Paramètres* page presents a "tarif de base de la plateforme" and a platform fee
percentage. Neither governs what actually happens, and the product owner wants a different
pricing model than the one the code implements.

### 1.1 The model the product owner wants

> « Le tarif doit être le tarif de plateforme qui est pour le moment 175 $ et on enlève un
> pourcentage — par ex. le tarif du professionnel est 150, donc on prend 25 pour la plateforme.
> The prices will be different for each professional based on the expertise and other things, so
> we must be able to customise each professional to put his price and our pourcentage that we
> will take. All this will be customised by the admin and it must be working perfectly also in
> the invoices. »

| | Today | Wanted |
| --- | --- | --- |
| Client is charged | the **professional's** rate | the **platform / client price** |
| Platform keeps | a **percentage** of the pro's rate | the **spread** (client price − pro rate) |
| Professional receives | rate − commission | their **negotiated rate** |
| Who configures it | the **professional**, self-serve | the **admin**, per professional |

Worked example: client price 175, professional rate 150, platform keeps 25.

### 1.2 Defect A — the professional's rate silently overrides the platform rate

`calculateAppointmentPricing` (`src/lib/pricing.ts`) reads `profile.pricing.*` first and falls
back to `PlatformSettings.defaultPricing` only `if (!sessionPrice)`. The settings value is a
**fallback**, not a base rate.

All three live professionals have self-set rates, so changing the platform tarif changes nothing
for any real booking — which is exactly what the client observed:

| Professional | `individualSession` | Notes |
| --- | --- | --- |
| `essidsassi@yahoo.fr` | 160 | couple 160, group 160 |
| `nbourgeau@gmail.com` | 175 | couple 0, group 0 |
| (third profile) | 145 | couple 0, group 0 — no upcoming appointments |

### 1.3 Defect B — no supported way to re-price an existing appointment

`appointment.payment.price` is written once at creation and never re-read from settings.
Receipts read the stored value. Freezing the price is **correct** for a paid session (a fiscal
receipt must not move), but there is currently **no path at all** — no admin UI, no API — to
re-price an unpaid, upcoming appointment after a tarif change. On 2026-08-31 four appointments
had to be re-priced by direct database update, which is not a repeatable process.

### 1.4 Relation to product goals

This does not serve *faster matching* (the PRD's primary goal). It is **billing correctness** —
a prerequisite for CUJ-5 (session closure → charge → receipt) being trustworthy, and for
switching Stripe to live mode with confidence.

---

## 2. Already fixed — context, not scope

**Defect C (resolved).** `complete-session` re-derived `platformFee` / `professionalPayout` from
`process.env.PLATFORM_FEE_PERCENTAGE` (10) at the moment the client was charged, while booking
used `PlatformSettings.platformFeePercentage` (11). The two disagreed and the env value won at
billing time, so the charge, the fiscal receipt and the ledger recorded a split the admin never
configured.

Fixed in commit `3dc2c24` (`fix(billing): preserve the agreed fee split at session closure`),
deployed 2026-08-31. Closure now prorates the stored payout and derives
`platformFee = price − professionalPayout`, so the invariant holds by construction. Covered by
five regression tests in `complete-session/route.spec.ts`.

**Still outstanding from the same defect class:** `src/app/api/admin/manual-invoice/route.ts`
(lines ~126-127) still calls `calculatePlatformFee` / `calculateProfessionalPayout` from
`lib/stripe.ts` and carries the same env-vs-db disagreement. It is in scope here (AC-5).

---

## 3. Acceptance criteria

### Pricing model

- **AC-1** Given a professional configured with client price 175 and negotiated rate 150, when an
  appointment is created for them, then `payment.price = 175`, `payment.professionalPayout = 150`
  and `payment.platformFee = 25`.
- **AC-2** `platformFee` is always **derived** as `price − professionalPayout`, never computed
  from a percentage at billing time.
- **AC-3** The invariant `price === platformFee + professionalPayout` holds at every point in an
  appointment's lifecycle. A change that breaks it must fail a test.
- **AC-4** Given a professional with **no** admin-configured pricing, the platform
  `defaultPricing` for that therapy type is used as the client price, and the spread falls back
  to `PlatformSettings.platformFeePercentage` applied to it.
- **AC-5** `process.env.PLATFORM_FEE_PERCENTAGE` is consulted nowhere in the billing path —
  including `manual-invoice`. There must be exactly **one** source of truth for the split.

### Admin control

- **AC-6** An admin can set, per professional and per therapy type (solo / couple / group), the
  **client price** and the **professional's rate**. The UI shows the resulting spread in both
  **$ and %**, updating live.
- **AC-7** The admin may enter the spread as a percentage and have the pro's rate computed from
  it (and vice versa), but **both amounts are stored explicitly**. The percentage is a UI
  affordance only — never the stored source of truth — to avoid rounding drift on money.
- **AC-8** Validation: client price > 0, and `0 <= professionalRate <= clientPrice`. A negative
  spread is rejected with a clear, bilingual error.
- **AC-9** All money is rounded through the existing `roundMoney` helper, and rounding must never
  break AC-3.
- **AC-17** The admin pricing editor shows a visible warning when a configured spread is `0` or
  negative (the platform earns nothing, or loses money, on that professional's sessions). A `0`
  spread is permitted — it must simply never be silent. See Q2.
- **AC-18** A stored professional rate of `0` for a therapy type means **unset**, not "the pro is
  paid nothing". It falls back to AC-4. (Two live profiles carry `coupleSession: 0` and
  `groupSession: 0` from the current schema.)

### Rate-change proposals (professional → admin)

- **AC-19** A professional can submit a **proposed** rate for a therapy type from their
  dashboard. Submitting does **not** change any live price: the current rate stays in force
  until an admin decides.
- **AC-20** An admin sees pending proposals in a review queue, with the professional's current
  rate, the proposed rate, and the resulting spread against that pro's client price. An admin can
  **accept** (the rate takes effect for future bookings) or **reject** (with an optional reason).
- **AC-21** Accepting a proposal follows AC-10 — it never re-prices existing appointments. It may
  offer the AC-25 bulk re-price list afterwards.
- **AC-22** Both parties are notified in their own language (FR/EN lockstep): the admin when a
  proposal is submitted, the professional when it is accepted or rejected. Route guards: only the
  owning professional may propose; only an admin may accept or reject. Both need a spec.

### Margin confidentiality

- **AC-23** No professional-facing API response, email, PDF or dashboard view exposes the client
  price, `listPrice`, or `platformFee`. The existing role-based redaction is preserved.
- **AC-24** The redaction is currently **duplicated in three places** and covered by no test. It
  must be extracted into one shared helper (e.g. `redactPaymentForProfessional`) with a unit test,
  so a fourth endpoint cannot silently leak the margin. **This is a real regression risk in the
  current code, independent of this feature.**
  *Known accepted limitation:* the **client's** own fiscal receipt legitimately shows the full
  price, so a professional shown a client's receipt could still infer the margin. Out of scope to
  change; noted so it is not mistaken for a leak.

### Existing appointments

- **AC-10** Changing a professional's pricing **never** alters an appointment whose
  `payment.status` is `paid` or `refunded`, nor one with an issued `ClientReceipt`.
- **AC-11** An admin can explicitly re-price a **single unpaid** appointment from the admin
  appointment view. This is an audited, deliberate action — never an automatic cascade from a
  settings change.
- **AC-12** Given an admin re-prices an unpaid appointment, when the session is later completed,
  the charge and the receipt use the re-priced amounts. (Already guaranteed by the §2 fix; this
  AC exists to keep it covered.)
- **AC-25** After an admin saves a price change for a professional, the UI offers that
  professional's **unpaid upcoming** appointments in a list with an "apply the new price" action.
  Selection is explicit (nothing pre-checked), `paid` / `refunded` appointments are excluded from
  the list entirely, and the bulk action is audited the same way a single re-price is. This
  directly addresses the operator need that triggered this spec — on 2026-08-31 four appointments
  had to be re-priced by hand in the database.

### Invoices and receipts

- **AC-13** `issueFiscalReceipt` records `platformFeeCad = payment.platformFee` and
  `netToProfessionalCad = payment.professionalPayout` — the **stored** values, never recomputed.
- **AC-14** For a partially-billed outcome (`getBillingFraction < 1`), both the client price and
  the professional payout are prorated by the same fraction, and AC-3 still holds after rounding.
- **AC-15** The client-facing receipt shows the amount **the client paid**, never the
  professional's rate or the platform's margin.
- **AC-16** Any user-facing copy added or changed ships in **both** `messages/en.json` and
  `messages/fr.json` (bilingual lockstep, FR-first).

---

## 4. Out of scope

- **No change to the Stripe integration.** Separate charges & transfers stays as-is; no
  `application_fee`, no `transfer_data`. (Charging 175 and transferring 150 is exactly what that
  model already supports — see `docs/architecture/overview.md` §67.)
- **No automatic re-pricing cascade.** A settings change never rewrites existing appointments.
- **No retroactive edit of issued fiscal receipts.** Correcting one is the existing
  void-and-reissue flow; it is not extended here.
- **No change to payout scheduling or Connect onboarding.**
- **No per-motif, per-duration or time-of-day pricing.** One price per therapy type per pro.
- **No currency work** (CAD only) and **no tax lines** (receipts carry none today).
- **No insurance billing, no EHR, no crisis-line behaviour** — standing product non-goals.
- The **Stripe test → live switch** is tracked separately, not here.

---

## 5. Affected files and legacy zones

### Core logic
- `src/lib/pricing.ts` — `calculateAppointmentPricing` returns an explicit
  (clientPrice, professionalPayout, platformFee) triple. **This function has no test coverage
  today** — `pricing.spec.ts` covers only `formatPrice` and `getTherapyTypeLabel`.
- `src/lib/stripe.ts` — `calculatePlatformFee` / `calculateProfessionalPayout` and
  `PLATFORM_FEE_PERCENTAGE`. Per AC-5 these should be removed once `manual-invoice` stops using
  them. Note `lib/stripe.ts` **throws at module load** if `STRIPE_SECRET_KEY` is unset, which is
  why specs mock it.
- `src/models/Profile.ts` — `pricing` gains a client-price / pro-rate pair per therapy type.
  **Schema migration required** for the three live professionals (see Q1).
- `src/models/PlatformSettings.ts` — `defaultPricing` documented as the unconfigured-pro fallback.
- `src/models/Appointment.ts` — no new fields expected; the semantics of `price`, `platformFee`
  and `professionalPayout` are what change.

### ⚠ Legacy zones — cross-checked against `docs/quality/debt-map.md`

- **[P2] `appointments/[id]/complete-session/route.ts`** — *"charges money + closes billing …
  a careless edit can double-charge or strand a closure."* Already modified by the §2 fix. Has a
  route spec with the new regression tests — **must stay green**.
- **[P2] `stripe-connect/payout/route.ts`** — sums `payment.professionalPayout` to build the
  Stripe transfer, so payout amounts change under the new semantics. *"Best-effort ledger write
  means a transfer can succeed while the ledger debit silently fails."* Has a route spec — extend.
- **[P1] `api/payments/webhook/route.ts`** — **untested** (debt-map P1); drives
  `payment-settlement.ts`. Verify it only reads stored values.
- `src/lib/session-post-closure.ts` — `issueFiscalReceipt` writes `platformFeeCad` /
  `netToProfessionalCad` (lines ~221-222).
- `src/lib/session-closure.ts` — no-show billing, another proration consumer.
- `src/app/api/admin/manual-invoice/route.ts` — the remaining half of defect C (AC-5).

**Confirmed not touched:** `parseAppointmentDate` / date handling, the matcher
(`cascadeAttempts` vs `refusedBy`), the `User` encryption ordering, `/api/files/[id]`.

### UI — no automated test harness, manual verification required
- `src/app/(privilaged)/admin/dashboard/settings/page.tsx` — platform defaults.
- **New** admin per-professional pricing editor.
- `src/components/dashboard/ProfessionalProfile.tsx` and `ProfileCompletionModal.tsx` — these let
  the **professional** set their own price today. Per Q3 the direct edit becomes a **proposal**;
  the displayed rate is the admin-approved one.
- **New** admin rate-proposal review queue (AC-20).
- **New** bulk re-price list shown after an admin saves a price change (AC-25).
- `messages/en.json` + `messages/fr.json` — lockstep, including the proposal notification copy.

### Confidentiality — existing mechanism to preserve
- `src/app/api/appointments/route.ts` (~107) and `src/app/api/appointments/[id]/route.ts`
  (~88, ~661) already redact `price` / `platformFee` / `listPrice` for professionals. Extract to
  one helper and test it (AC-24) — three copies, zero tests, is how a margin leak ships.
- `src/lib/notifications.ts` (~6.7k lines, **god-file — edit surgically**) and
  `src/lib/email-template-registry.ts` (~3k) for the proposal notifications (AC-22).

---

## 6. Test plan

### New / extended `*.spec.ts` (vitest, node env)

- **`src/lib/pricing.spec.ts` — the main gap.** Add coverage for `calculateAppointmentPricing`:
  - admin-configured pro → 175 / 150 / 25 (AC-1)
  - the AC-3 invariant across a table of values, including ones that round badly
    (e.g. 175/149.99, thirds) (AC-3, AC-9)
  - unconfigured pro → platform default + percentage fallback (AC-4)
  - validation rejects `professionalRate > clientPrice` and negatives (AC-8)
- **`complete-session/route.spec.ts`** — keep the five §2 regression tests green; add a
  fractional-proration case for AC-14.
- **`stripe-connect/payout/route.spec.ts`** — transfer total equals the sum of stored
  `professionalPayout` under the new semantics.
- **New admin re-price route spec** — admin-only guard; rejects `paid` / `refunded`; rejects a
  negative spread (AC-11, AC-8, AC-10). Extend for the bulk variant: excludes paid/refunded,
  applies only to explicitly selected ids (AC-25).
- **New `redactPaymentForProfessional` unit spec (AC-24)** — asserts `price`, `listPrice` and
  `platformFee` are removed and `professionalPayout` is kept. This closes a gap that exists in
  the code **today**: the redaction is duplicated three times and tested nowhere.
- **New rate-proposal route specs (AC-19 to AC-22)** — only the owning professional may propose;
  only an admin may accept/reject; a pending proposal does not change the live rate; accepting
  does not touch existing appointments.
- **`manual-invoice/route.spec.ts`** — assert the env percentage is no longer used (AC-5). Note
  its current spec *mocks* the helpers at 20/80, so it would not catch the real defect — the new
  test must assert against the single source of truth.

### Manual verification (no UI test harness)
- **CUJ-5 — session closure → charge → receipt** (the critical one): book with a configured pro,
  complete the session, confirm the client is charged the client price and the receipt's
  `platformFeeCad` / `netToProfessionalCad` match the configured split.
- **CUJ-4** — schedule → payment-method capture shows the client price.
- **CUJ-2** — guest booking + guest payment (debt-map: *entirely untested money path*).
- Admin editor: set a pro's price, confirm the live $/% spread, confirm validation blocks a
  negative spread.
- Confirm both FR and EN render the new copy.

### Gates
`pnpm test` and `pnpm build` (AGENTS.md §3). There is no CI gate beyond the deploy workflow, and
it runs no ESLint — run the tests locally before pushing.

---

## 7. Assumptions and open questions

**Assumptions** (flag if wrong):
- **A1** The split is stored as **two explicit amounts**, with the percentage as a UI convenience
  only. Storing a percentage as the source of truth invites rounding drift on money.
- **A2** `defaultPricing` in *Paramètres* becomes meaningful **only** for professionals with no
  admin-set pricing. It stops being a base rate that applies to everyone.
- **A3** Paid appointments and issued receipts are never touched.
- **A4** CAD only; no tax handling introduced.

**Open questions — need the product owner:**

- **Q1 — migration. ANSWERED 2026-08-31:** keep the numbers already configured; the admin gains
  the ability to change them. Migration is therefore mechanical:
  - each professional's existing `profile.pricing.<type>` value becomes their **professional
    rate** (what they receive), matching the product owner's example ("le tarif du professionnel
    est 150");
  - the **client price** defaults to `PlatformSettings.defaultPricing.<type>` (solo 175) until an
    admin sets a per-professional client price;
  - the admin can subsequently change **both** sides for any professional.

  Resulting day-one state:

  | Professional | Pro rate (migrated) | Client price (default) | Spread |
  | --- | --- | --- | --- |
  | `essidsassi@yahoo.fr` | 160 | 175 | 15 |
  | (third profile) | 145 | 175 | 30 |
  | `nbourgeau@gmail.com` | 175 | 175 | **0** ⚠ |

  A professional with a `0` rate for a therapy type (couple/group on two profiles) must **not**
  be migrated to a 0 payout — treat a stored `0` as "unset" and fall back to AC-4.

- **Q2 — nbourgeau's zero spread. ANSWERED 2026-08-31:** accepted as a launch-time admin task,
  not a blocker. Their rate (175) equals the default client price, so the platform earns nothing
  on their sessions until an admin raises the client price or lowers the rate.
  **AC-17:** the admin pricing editor must surface a visible warning when a configured spread is
  `0` or negative, so this cannot go unnoticed in production.
- **Q3 — professional self-serve pricing. ANSWERED 2026-08-31: pro proposes, admin approves.**
  A professional may request a rate change; it stays pending until an admin accepts or rejects.
  See AC-19 to AC-22. ⚠ **This is the largest single piece of scope in the spec** — it adds a
  proposal state, an admin review queue, bilingual notifications and new route guards. Consider
  shipping it as phase 2 behind the simpler admin-only editor (see §8).
- **Q4 — visibility. ANSWERED 2026-08-31: no — a professional sees only their own rate.**
  **Largely already implemented.** `src/app/api/appointments/route.ts` (~line 107) and
  `src/app/api/appointments/[id]/route.ts` (~lines 88 and 661) already strip `price`,
  `platformFee` and `listPrice` for `session.user.role === "professional"`, commented *"Hide
  client gross + platform fee from professionals (commercial confidentiality + accounting
  clarity)"*. This spec must **preserve** that and close the gaps around it — see AC-23/AC-24.
- **Q5 — re-pricing ergonomics. ANSWERED 2026-08-31: both.** Per-appointment editing **and** a
  bulk list offered after an admin saves a price change. See AC-11 and AC-25.

---

## 8. Handoff

**Q1–Q5 are all answered** (2026-08-31). Ready for
`/plan-feature specs/001-per-professional-pricing/spec.md`.

Suggested sequencing — each step is independently shippable and leaves the tree green:

1. **`manual-invoice` single-fee-source cleanup (AC-5)** — small, independent, finishes defect C.
2. **Extract `redactPaymentForProfessional` + unit test (AC-24)** — fixes a real
   leak-risk that exists in the code today, independent of the rest of this feature.
3. **Schema + `calculateAppointmentPricing` rewrite** (AC-1 to AC-4, AC-9, AC-18) with the test
   coverage that does not exist today. The riskiest step — money logic.
4. **Data migration** for the three live professionals (per Q1), including the `0`-means-unset
   rule.
5. **Admin per-professional pricing editor** + FR/EN copy + the zero-spread warning (AC-6 to AC-8,
   AC-17).
6. **Admin re-price**: single appointment (AC-11) then the bulk list (AC-25), each with route
   guard specs.
7. **Rate-change proposals** (AC-19 to AC-22) — the largest chunk, and the only one with no
   urgency behind it. Deliberately last: everything above is usable without it, since an admin
   can already set any rate directly.

**Scope note for the planner:** steps 1–6 deliver everything the operator asked for. Step 7 exists
only to preserve professional agency after their self-serve control is removed; if timelines
compress, ship 1–6 and tell the professionals that rate changes go through the admin in the
interim.
