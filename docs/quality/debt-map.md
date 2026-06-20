# Debt map

The honest map of landmines, fragile areas, missing coverage, and deploy-coupled steps in **Je chemine**. **This file is append-only**: future sessions *add* findings here (with a date) instead of fixing-by-the-way. Before a non-trivial change, check whether you're about to touch something on this list.

Severity: **P1** = can lose money / data / security now · **P2** = real risk, handle with care · **P3** = cruft / hygiene.

## Security & production landmines

- **[P1] Weak super-admin in the real DB.** `admin@admin.com` / `admin123` (full super-admin) is reported to exist in the production database (`RAPPORT-FEEDBACK-JUIN-2026.md` → "Points d'attention" #1). Must be changed/removed before/at production. *(observed: RAPPORT-FEEDBACK-JUIN-2026.md)*
- **[P2] `/api/files/[id]` coarse authorization.** Any signed-in user can fetch any non-`content-image` `StoredFile` by ObjectId (incl. patient referral PDFs, employee CVs, payout cheques). `content-image` is fully public. Security relies on consumer endpoints never leaking ids + ObjectId unguessability. The same route has a **BSON-Binary empty-body trap** (`.length` is a method on lean Binary) — keep the manual `Buffer.from(binary.buffer)` normalize branch. *(src/app/api/files/[id]/route.ts)*
- **[P2] In-memory rate limiting.** `lib/rate-limit.ts` is a per-process map (signup, forgot-password); it does not span serverless instances and resets on cold start — weak brute-force protection. No Redis/Upstash. *(src/lib/rate-limit.ts)*
- **[P2] Field encryption is key-coupled.** AES-256-GCM via `FIELD_ENCRYPTION_KEY` with a `v1.` envelope. Misconfiguring/rotating the key makes existing ciphertext undecryptable and breaks off-session charging (`MISSING_PAYMENT_METHOD`). *(src/lib/mongoose-contact-encryption.ts)*
- **[P2] Encryption-hook ordering.** The `User` pre-save lookup-hash hook (`phoneLookupHash`) **must** run before the contact-encryption plugin (phone must still be plaintext). Reordering silently corrupts dedup. *(src/models/User.ts)*

## Money & state-machine fragility (test before touching)

- **[P1] Stripe webhook is untested.** `src/app/api/payments/webhook/route.ts` (~510 lines: payment success/fail/cancel, full/partial refund with receipt void/restore, dispute, `setup_intent.succeeded`) has **no spec** — the single most consequential payment integration point. Add tests before editing. *(observed: no matching spec)*
- **[P1] LIVE Stripe webhook event subscriptions.** Receipt issuance, dispute flagging, refund reversal, and ACSS guarantee-green depend on the **LIVE** endpoint subscribing to `payment_intent.succeeded`, `setup_intent.succeeded`, `charge.dispute.created`, `charge.refund.updated`. Memory notes TEST is configured; **LIVE may be missing** the latter three. `scripts/add-stripe-webhook-events.ts` exists to help. *(deploy-coupled)*
- **[P2] `complete-session` charges money + closes billing.** `appointments/[id]/complete-session/route.ts` runs the off-session Stripe charge and finalizes billing, guarded only by an atomic `sessionCompletedAt: null` claim + Stripe idempotency key; the catch rolls back only if `!closureFinalized`. Subtle ordering — a careless edit can double-charge or strand a closure. *(has a route spec — keep it green)*
- **[P2] `cascadeAttempts` vs `refusedBy`.** The cascade counter is deliberately distinct from the never-re-propose set (release/reassign also write `refusedBy`). **Never derive cascade progress from `refusedBy.length`** — it breaks the cascade. *(src/models/Appointment.ts, src/lib/appointment-routing.ts)*
- **[P2] Matcher can overwrite an in-flight admin assignment.** Re-routing on refusal/timeout is defended only by `commitRouting`'s filter (`routingStatus: pending` + `professionalId` absent). Any new write path that ignores this filter resurrects the silent-overwrite bug. *(src/lib/appointment-routing.ts)*
- **[P2] Payout route holds real-money logic inline.** `stripe-connect/payout/route.ts`: SHA256 idempotency, atomic row-claim via `updateMany`, Connect onboarding verification, Interac-exclusion. Best-effort ledger write means a transfer can succeed while the ledger debit silently fails. *(has a route spec)*
- **[P2] No multi-document transactions.** `account-merge.ts` re-points ~15 collections then deletes the loser last (designed re-runnable, but a crash mid-merge leaves partially re-pointed data). All consistency is single-doc atomic claims. *(src/lib/account-merge.ts)*
- **[P2] Legacy UTC-midnight appointment rows.** `parseAppointmentDate` now anchors at UTC-noon, but rows written before the fix were **never backfilled** — date math on old rows can still render a day early. *(memory; no backfill run)*
- **[P3] `renderTemplate` silently drops unknown tokens.** Admin email-template typos substitute to empty (not literal); conditionals are regex with a 6-pass cap (deeply nested sections can under-render). *(src/lib/notifications.ts)*

## Testing & CI gaps

- **[P1] No CI quality gate.** There are **no GitHub Actions workflows** at all. **Nothing runs `vitest`, `lint`, `tsc`, or `knip` in CI.** The Vercel `next build` enforces the strict **TypeScript** typecheck but **not** ESLint (Next 16 doesn't run lint at build) and **not** failing tests — so a logically-broken-but-compiling change ships. Run `pnpm test` yourself. *(.github/workflows/, package.json; verified 2026-06-20: `pnpm build` exits 0 with 84 open lint errors)*
- **[P2] `pnpm lint` does not pass.** The tree has **~84 pre-existing ESLint errors** (+49 warnings), mostly `@typescript-eslint/no-explicit-any` (e.g. `admin/admins/*` routes, `lib/api-client.ts`, `lib/auth.ts`, `lib/mongodb.ts`), plus React-Compiler rules (`react-hooks/purity` on `Date.now()` in `client/dashboard/page.tsx` + `useInactivityLogout.ts`, `react-hooks/set-state-in-effect`, `react-hooks/rules-of-hooks` in `professional/dashboard/page.tsx`) and `react/no-unescaped-entities`. Because `next build` doesn't run ESLint, these don't block deploys — but it means **lint is advisory**: don't add new errors; a clean lint run is a separate, deliberate cleanup effort. *(observed: `pnpm lint` → 84 errors / 49 warnings on 2026-06-20)*
- **[P2] Large untested critical paths.** No spec for: the Stripe webhook, `payments/create-intent` / `setup-intent` / `payment-methods` / all **guest payment** routes, the 815-line `appointments/route.ts` (main booking), the 618-line `auth/signup/route.ts`, `stripe-connect/create-account`, and any cron route end-to-end. **Zero UI/component tests** (vitest runs in node env; TODO.md asked for form/integration tests that were never written). ~118 of ~154 routes have no spec. *(observed)*

## Cruft & hygiene

- **[P3] Three committed lockfiles.** `bun.lock` + `package-lock.json` + `pnpm-lock.yaml` all tracked; **pnpm is canonical**. The stale two invite wrong-installer drift. Confirm the Vercel build installs via pnpm. *(repo root)*
- **[P3] Stray committed artifact.** A file literally named `c:tmpnext-dev.log` (a Windows path used as a redirect target, containing a Turbopack FATAL panic) is committed at repo root. Pure cruft — safe to delete. *(repo root, .gitignore doesn't cover it)*
- **[P3] Broken `seed` script.** `package.json` declares `"seed": "tsx src/lib/seed.ts"` but `src/lib/seed.ts` does not exist — `pnpm seed` fails. (`seed-motifs`, `reset-motifs`, `create-admin`, `seed-routing-test` are real.) *(package.json)*
- **[P3] God-files.** `lib/notifications.ts` (~6.7k lines), `email-template-registry.ts` (~3k), `app/appointment/page.tsx` (~3.1k), `MedicalProfile.tsx` (~2.2k), `signup/member` (~2.1k), `proposals` page (~1.5k). Edit surgically; don't rewrite without a plan + tests.
- **[P3] ~91 `any` + 82 `console.log`** in `src` (hotspots: `admin/admins/*` routes, `lib/api-client.ts`, `seed-routing-test.ts`, `notifications.ts`, `webhook`). 23 inline `eslint-disable` (mostly `no-img-element`).
- **[P3] Duplicate/parallel systems** (don't add a third): `Problematique` vs `ContentEntry` CMS; `PlatformSettings.emailSettings.templates` vs `EmailTemplate`; `StoredFile` vs `ClientDocument`; `guardianId` vs `accountManagerId`; `issueType` vs `needs[]`. *(src/models)*
- **[P3] Orphaned design tokens / fonts.** `src/theme.ts` (indigo/purple) and `src/config/colors.ts` don't match the live OKLCH palette in `globals.css`; `globals.css` references undefined `--font-*` vars (no `next/font` loaded → system-font fallback). Editing the wrong source does nothing visible.
- **[P3] Dead dependency.** `react-select` (+ `@types/react-select`) is installed but never imported. `pnpm prune` (knip) will flag it.
- **[P3] `Resource`/`ResourcePurchase` default to `usd`** while the platform is CAD — the marketplace appears unused/abandoned. *(src/models/Resource.ts)*

## Deploy-coupled manual steps (no automation — easy to forget)

- Stripe **LIVE** webhook must subscribe to the 4 events above.
- `scripts/backfill-post-meeting-reminder-flag.ts` must be run once, or the post-meeting collection cron can mass-mail historical clients (mitigated only by a 14-day lookback).
- Stale `jumelageSuccess` `EmailTemplate` rows (fr+en) must be deleted so they re-seed corrected (per memory).
- `MAIL_FROM` must equal `SMTP_USER` (or a verified Gmail "Send mail as" alias) or Gmail rewrites/rejects mail; `CRON_SECRET` must be set or all 5 crons 401.
- A squash-merge to `main` sometimes does not trigger the Vercel build — push an empty commit to re-trigger.

---

## Findings log (append below, dated)

- **2026-06-20** — Debt map created from the initial codebase audit. Items above are the baseline. Add new findings here with a date and a `[P#]` severity instead of fixing legacy code in passing.
