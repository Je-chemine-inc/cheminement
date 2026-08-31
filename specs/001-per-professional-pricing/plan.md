# Plan — Spec 001, per-professional pricing set by admin

Implementation plan for [spec.md](./spec.md). File-level, ordered, each step independently
verifiable and green. **No code written yet.**

---

## 0. Finding that reorders the plan — read first

`PUT /api/profile` (`src/app/api/profile/route.ts:58`) builds its update as:

```ts
const { acceptProfessionalTerms, ...data } = await req.json();
const update: Record<string, unknown> = { ...data };
// ... only boolean coercion for 5 privacy keys, then:
await Profile.findOneAndUpdate({ userId: session.user.id }, update, { upsert: true });
```

The **entire request body is spread into the update** with no allowlist of writable fields. A
professional can therefore write any `Profile` field on themselves, including `pricing`.

- **Today this is low severity** — a professional is *allowed* to set their own rate, so the
  route grants a permission the product already grants.
- **Under this spec it becomes a money bypass.** Once pricing is admin-controlled and the pro's
  own edit becomes a *proposal* (AC-19), a professional could skip the entire approval flow with
  a single crafted `PUT /api/profile` carrying `{"pricing":{"individualSession":300}}`. The
  propose/approve UI would be decorative.

It is **not** in `docs/quality/debt-map.md`, has **no** allowlist, and `profile/route.spec.ts`
covers only the re-match logic — nothing tests field authorization.

**Consequence for sequencing: Step 1 is the allowlist.** It must land before pricing moves under
admin control, not after. Everything else is unchanged from the spec's §8 ordering.

---

## What we reuse (inventory — extend, never recreate)

| Need | Reuse | Notes |
| --- | --- | --- |
| Admin edits a pro | `src/components/dashboard/ProfessionalProfile.tsx` | Already dual-mode: `userId` prop = admin editing a pro, absent = pro self-view. Already renders pricing read-only (lines ~538-590). **Extend this, do not build a second editor.** |
| Admin-not-gated-by-terms | `professionalTermsGateApplies(userId, …)` | Existing helper; already correct (AGENTS.md §7). Keep using it. |
| Profile fetch by admin | `profileAPI.getById(userId)` in `src/lib/api-client.ts:248` | Existing client wrapper. |
| Admin pro detail page | `src/app/(privilaged)/admin/dashboard/professionals/[id]/page.tsx` | The pricing editor's home. |
| Settings write pattern | `src/app/api/admin/settings/route.ts` (~145) | Field-by-field guarded assignment — the pattern the new pricing writes should mirror (it is already allowlist-shaped). |
| Money rounding | `roundMoney` in `src/lib/session-closure.ts:74` | Mandatory for all money math (AC-9). |
| Pro-side redaction | `src/app/api/appointments/route.ts:107`, `[id]/route.ts:88,661` | Exists and works; extract to one helper (Step 3). |
| Emails | `src/lib/notifications.ts` + `email-template-registry.ts` | **God-files (6.7k / 3k lines) — edit surgically**, follow the neighbouring builder, thread `lang`. |
| i18n | `messages/fr.json` + `en.json` | Existing keys: `individualSession`, `pricingPayment`, `defaultPricing`, `pricingNotSet`. Extend the same namespaces. |

**Contract note:** the professional terms already bind pros to confidentiality on *"les tarifs et
honoraires convenus (qu'ils soient fixes ou préférentiels)"* (`messages/fr.json:5896`), so the
per-pro negotiated-rate model needs no new legal copy.

---

## Legacy-zone contact (debt-map cross-check)

| Step | Zone | Severity | Mitigation |
| --- | --- | --- | --- |
| 4 | `lib/pricing.ts` | untested money logic | Tests written **first**; this is the riskiest step |
| 2 | `admin/manual-invoice/route.ts` | money | Existing spec mocks the fee helpers 20/80 — rewrite the assertion, not just the mock |
| 7 | `complete-session` | **P2** — *"can double-charge or strand a closure"* | Only consumed, not modified; its 5 regression tests must stay green |
| 7 | `stripe-connect/payout` | **P2** — best-effort ledger write | `professionalPayout` semantics change; extend its route spec |
| — | `payments/webhook` | **P1 untested** | Read-only consumer; verify it reads stored values, add no new coupling |
| 8 | `notifications.ts` | god-file | Surgical edit only; no refactor |

Not touched: `parseAppointmentDate`, the matcher (`cascadeAttempts` ≠ `refusedBy`), the `User`
encryption-hook ordering, `/api/files/[id]`.

---

## Steps

### Step 1 — Allowlist writable fields on `PUT /api/profile` 🔒 *security prerequisite*

**Files**
- `src/lib/profile-writable-fields.ts` *(new)* — export `PROFILE_SELF_WRITABLE` (the fields a pro
  may set on themselves) and `pickWritable(data, allowlist)`.
- `src/app/api/profile/route.ts` — replace `{ ...data }` with `pickWritable(data, …)`.
- `src/lib/profile-writable-fields.spec.ts` *(new)*.
- `src/app/api/profile/route.spec.ts` — extend.

**Change.** Derive the allowlist from the current `Profile` schema so behaviour is *identical
today* — `pricing` stays writable in this step. This is a pure hardening step with no product
change; Step 6 is what removes `pricing` from the allowlist.

**Verify.** New spec: an unknown field (`role`, `profileCompleted`, `professionalTermsAcceptedAt`)
in the body is dropped; every currently-writable field still round-trips. The 5 existing re-match
tests stay green. `pnpm test`.

**Why first:** the only step that is a prerequisite for correctness of a later one. Independently
shippable and valuable even if the rest of this spec is dropped.

---

### Step 2 — Single fee source in `manual-invoice` (AC-5)

**Files**
- `src/app/api/admin/manual-invoice/route.ts` (~126-127)
- `src/app/api/admin/manual-invoice/route.spec.ts`
- `src/lib/stripe.ts` — remove `calculatePlatformFee` / `calculateProfessionalPayout` /
  `PLATFORM_FEE_PERCENTAGE` once this is their last caller.

**Change.** A manual invoice has an admin-supplied price and no prior split, so it derives the
split from `PlatformSettings.platformFeePercentage` (the DB value the admin actually sets) rather
than `process.env.PLATFORM_FEE_PERCENTAGE`. Finishes the defect fixed for `complete-session` in
`3dc2c24`.

**Verify.** ⚠ The existing spec **mocks** the helpers at 20/80, so it cannot catch this — the
assertion must be rewritten against the settings value, not the mock. New case: settings at 11%
produce an 11% split, and the env var is not read. `pnpm test`.

**Note.** Once `lib/stripe.ts` no longer exports the helpers, the now-inert
`vi.mock("@/lib/stripe")` in `complete-session/route.spec.ts` can stay — it also prevents the real
Stripe SDK from throwing at module load when `STRIPE_SECRET_KEY` is unset.

---

### Step 3 — Extract the professional payment redaction (AC-23, AC-24)

**Files**
- `src/lib/redact-payment.ts` *(new)* — `redactPaymentForProfessional(appointmentObj)`.
- `src/lib/redact-payment.spec.ts` *(new)*.
- `src/app/api/appointments/route.ts` (~107), `src/app/api/appointments/[id]/route.ts` (~88, ~661)
  — replace all three copies.

**Change.** One tested helper instead of three copy-pasted blocks. Strips `price`, `listPrice`,
`platformFee`; keeps `professionalPayout`.

**Verify.** Unit spec asserts exactly which keys are removed and kept, including when `payment` is
absent. Manually: as a professional, confirm the dashboard still shows the payout and never the
client gross. `pnpm test`.

**Why early:** fixes a leak risk that exists in the code **today**, independent of this feature.
Small and self-contained.

---

### Step 4 — Pricing model: schema + `calculateAppointmentPricing` 🎯 *riskiest step*

**Files**
- `src/models/Profile.ts` — `pricing.{individual,couple,group}Session` becomes
  `{ clientPrice: number; professionalRate: number }` per type (keep the old numeric field
  readable during migration).
- `src/lib/pricing.ts` — rewrite `calculateAppointmentPricing` to return
  `{ sessionPrice, professionalPayout, platformFee, currency, source }` where
  `platformFee = sessionPrice − professionalPayout`.
- `src/lib/pricing.spec.ts` — **currently covers only `formatPrice` / `getTherapyTypeLabel`.**
- Callers (signature change only, no logic): `src/app/api/admin/appointments/route.ts:148`,
  `admin/service-requests/[id]/assign/route.ts:175`, `admin/service-requests/[id]/schedule/route.ts:155`,
  `api/appointments/request-with-current-pro/route.ts:175`.

**Change.** Implements AC-1 to AC-4, AC-9, AC-18. A stored rate of `0` means **unset** → fall back
to platform defaults (AC-18): two live profiles carry `coupleSession: 0` / `groupSession: 0`, and
migrating those literally would set real payouts to zero.

**Verify — tests first, this is money logic with zero current coverage.**
- configured pro → 175 / 150 / 25 (AC-1)
- the AC-3 invariant across a table including values that round badly (175/149.99, thirds)
- unconfigured pro → platform default + percentage fallback (AC-4)
- `0` rate treated as unset, never as a zero payout (AC-18)
- validation rejects `professionalRate > clientPrice` and negatives (AC-8)

`pnpm test` + `pnpm build` (the four call sites must typecheck).

---

### Step 5 — Data migration for the three live professionals

**Files**
- `scripts/migrate-professional-pricing.ts` *(new, `tsx`, follows the existing ops-script pattern)*

**Change.** Per Q1: existing `individualSession` → `professionalRate`; `clientPrice` defaults to
`PlatformSettings.defaultPricing`. Skip `0` values (AC-18). Idempotent; dry-run by default with an
explicit `--apply` flag.

**Expected result:** essidsassi 160→175 (spread 15), third profile 145→175 (spread 30),
nbourgeau 175→175 (**spread 0** ⚠ — accepted per Q2, surfaced by AC-17).

**Verify.** Dry-run against a **local** copy first and diff the output. ⚠ Ops scripts are
destructive — **never point at the production DB** without a fresh `mongodump` (AGENTS.md §3).
Note there is currently **no MongoDB backup routine on the VPS** — take a manual dump first.

---

### Step 6 — Admin per-professional pricing editor (AC-6, AC-7, AC-8, AC-17)

**Files**
- `src/components/dashboard/ProfessionalProfile.tsx` — pricing becomes **editable when `userId` is
  set** (admin) and read-only otherwise. Extends the existing dual-mode component.
- `src/app/api/admin/professionals/[id]/pricing/route.ts` *(new, thin)* → calls a
  `src/lib/professional-pricing.ts` service holding the validation.
- `src/lib/profile-writable-fields.ts` — **remove `pricing`** from the self-writable allowlist
  (this is what Step 1 makes safe).
- `messages/fr.json` + `messages/en.json` — lockstep.

**Change.** Admin enters client price and pro rate; UI shows the spread live in $ and %; entering a
percentage back-computes the rate but **both amounts are stored explicitly** (AC-7). Zero/negative
spread warning (AC-17). Accessible empty/error/loading states per code-style §(b).

**Verify.** Route spec: admin-only; rejects `professionalRate > clientPrice`; rejects negatives;
a professional calling it gets 403. Manually: edit a pro's price as admin, confirm the $/% display
and the zero-spread warning on nbourgeau; confirm a pro can no longer PUT `pricing` (Step 1's
allowlist). Confirm FR **and** EN. `pnpm test` + `pnpm build`.

---

### Step 7 — Admin re-price: single, then bulk (AC-11, AC-12, AC-25)

**Files**
- `src/lib/appointment-reprice.ts` *(new)* — the guard logic (refuse `paid` / `refunded`, recompute
  the split, preserve AC-3).
- `src/app/api/admin/appointments/[id]/reprice/route.ts` *(new, thin)*
- `src/app/api/admin/appointments/reprice-bulk/route.ts` *(new, thin)*
- Admin appointment view + a post-save list of that pro's unpaid upcoming appointments.
- `messages/*.json` — lockstep.

**Change.** Explicit, audited re-pricing. Nothing pre-checked; paid/refunded excluded from the
bulk list entirely. This is what replaces the manual database update done on 2026-08-31.

**Verify.** Route specs: admin-only; `paid` / `refunded` rejected; bulk applies only to explicitly
passed ids; AC-3 holds after. Then **CUJ-5 end-to-end**: re-price an unpaid appointment, complete
the session, confirm the charge and the receipt use the new amounts.
⚠ `complete-session`'s 5 regression tests must stay green — it consumes these values.

---

### Step 8 — Rate-change proposals (AC-19 to AC-22) *— optional, ship last*

**Files**
- `src/models/ProfessionalRateProposal.ts` *(new)* — or a `pendingPricing` subdocument on
  `Profile`; prefer the separate model for a clean audit trail.
- `src/app/api/profile/rate-proposal/route.ts` *(new)* — pro submits.
- `src/app/api/admin/rate-proposals/route.ts` + `[id]/route.ts` *(new)* — admin queue, accept/reject.
- `src/components/dashboard/ProfessionalProfile.tsx` — the pro's edit becomes "propose".
- Admin review queue UI.
- `src/lib/notifications.ts` + `email-template-registry.ts` — ⚠ **god-files, edit surgically**;
  thread `lang` through both `buildEmailHtml` and `buildEmailText`.
- `messages/*.json` — lockstep.

**Verify.** Route specs: only the owning pro may propose; only an admin may accept/reject; a
pending proposal does **not** change the live rate; accepting does not touch existing appointments
(AC-10). Manually: submit → admin sees it → accept → rate applies to new bookings only. FR + EN.

**Scope call:** Steps 1-7 deliver everything the operator asked for. Step 8 exists only to give
professionals agency after their self-serve control is removed. If timelines compress, ship 1-7
and tell professionals that rate changes go through the admin in the interim.

---

## Decisions needed before `/implement-feature`

1. **Ship Step 1 immediately as a standalone hardening PR?** It is a real (if currently
   low-severity) mass-assignment hole, unrelated to the rest of this work. Recommendation: **yes**
   — it is small, testable, and its severity rises the moment Step 6 lands.
2. **Step 5 needs a production `mongodump` first.** There is no backup routine on the VPS today.
   Confirm before any migration touches production data.
3. **Add the Step 0 finding to `docs/quality/debt-map.md`?** Recommendation: yes, in the same PR as
   Step 1 (AGENTS.md §2 step 5 — encode the lesson).
4. **Step 8 in or out** of the first delivery.

---

## Green definition for every step

`pnpm test` **and** `pnpm build` (AGENTS.md §3). Reminder: `tsc --noEmit` needs `.next/types`, so
run a build once on a fresh clone first. CI runs no ESLint and no gate other than the deploy
workflow — run tests locally before pushing, since pushing to `main` deploys to production.
