# AGENTS.md — Je chemine operating manual

The entry point for every AI (and human) session in this repo. Read it once, in full, before you touch anything.

## 1. What this repository is

**Je chemine** (`jechemine`, prod **www.jechemine.ca**) is a bilingual (FR-first / EN) Quebec mental-health **"Plateforme de santé mentale™ / Integrated Health Platform™"**. It connects clients/members with vetted professionals through an intelligent **jumelage** (matching) engine, then carries the relationship through booking, payment (Stripe + Interac), internal messaging, fiscal receipts, and an editorial CMS. Stack: **Next.js 16.0.10** (App Router, React 19.2 + React Compiler), **TypeScript 5.9 (strict)**, **MongoDB/Mongoose 8** (+ `@auth/mongodb-adapter`), **NextAuth v4** (JWT), **Stripe 19** (+ Connect), **Nodemailer SMTP** + **Twilio**, **next-intl**, **Tailwind 4 + shadcn/ui (new-york) + Radix + CVA**, **Tiptap**, **Vitest 1.6**, package manager **pnpm**. It is **in production and live** — this is an evolution, not a migration. We are adopting an AI operating model on top of the code **as it is**; we document legacy patterns, we do not silently "fix" them (see [ADR-0001](docs/architecture/decisions/0001-adopt-ai-operating-model.md)).

## 2. The loop — every task follows this

1. **Ground** — read the docs in §4 relevant to the task, and read the *neighbouring* code, before writing anything. Reuse existing patterns; never recreate what exists.
2. **Plan** — for anything beyond a trivial fix, state a short plan first (see `/plan-feature`). Flag any contact with a Legacy Zone (§7) or [debt-map](docs/quality/debt-map.md) landmine.
3. **Implement** — small steps, keep the build green. New code follows [code-style §(b)](docs/conventions/code-style.md); existing code is left alone unless the task is about it.
4. **Verify** — run the real check commands (§3) and *prove* the change works. For UI, run the app and confirm the touched [CUJ](docs/product/critical-user-journeys.md). Never claim "done" without evidence (see `/verify`).
5. **Encode** — if a mistake could recur, write the fix into a doc, test, or rule in the **same PR** (see `/encode-lesson`). Prefer a blocking mechanism over prose.

## 3. Commands (the project's real commands — pnpm)

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the dev server (Next 16 / Turbopack). |
| `pnpm build` | `next build` — **the deploy gate** (Vercel runs this): enforces the **strict TypeScript typecheck** + bundling. Note: Next 16 does **not** run ESLint during build, so lint errors do **not** block it. |
| `pnpm test` | Vitest — **34 `.spec.ts` files, node env**: pure logic + a slice of route guards. **No UI/component tests exist.** |
| `pnpm lint` | ESLint (`eslint-config-next` core-web-vitals + typescript). **Advisory only** — see below. |
| `pnpm format` | Prettier (`--write .`). |
| `pnpm prune` | knip — dead code / unused deps. |
| `pnpm create-admin` / `pnpm seed-motifs` / `pnpm reset-motifs` / `pnpm seed-routing-test` | `tsx` ops scripts. ⚠ destructive — never point at the prod DB. |

**"Green" = `pnpm test` passes AND `pnpm build` passes** (build = the strict typecheck). `pnpm lint` is **advisory**: the tree carries a large pre-existing ESLint backlog (~84 errors) and `next build` does not enforce it — so don't aim for a clean `pnpm lint`, just **don't add new lint errors** in files you touch. (`pnpm exec tsc --noEmit` is a faster standalone typecheck — the installed compiler directly, *not* a package.json script. `pnpm seed` is **broken** — points at a non-existent file; see debt-map.) There is **no CI gate at all** — only the Vercel `next build` runs, and it runs neither vitest nor ESLint. So run `pnpm test` yourself: a logically-broken-but-compiling change can ship.

## 4. Docs map — which doc for which task

| You are… | Read |
| --- | --- |
| Doing anything | this file + [docs/index.md](docs/index.md) |
| Understanding the system / where code lives | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Writing new code (style, boundaries, validation) | [docs/conventions/code-style.md](docs/conventions/code-style.md) |
| Touching fragile areas / before a big change | [docs/quality/debt-map.md](docs/quality/debt-map.md) |
| Working on a user-facing flow | [docs/product/critical-user-journeys.md](docs/product/critical-user-journeys.md) |
| Needing product intent / scope / why | [docs/product/prd.md](docs/product/prd.md) + [docs/product/overview.md](docs/product/overview.md) |
| Recording an architectural decision | [docs/architecture/decisions/](docs/architecture/decisions/) |

## 5. Architecture as it is (honest)

- **Routes/pages** live in `src/app/**` (App Router): route groups `(public)`, `(auth)`, `(verify)`, `(privilaged)`[admin/client/professional], plus the standalone `/appointment` (booking funnel) and `/pay` (guest payment) flows. ~82 pages.
- **API** is ~154 `route.ts` handlers under `src/app/api/**`. There is **no shared auth helper**: every route inlines `getServerSession(authOptions)` + a role/ownership check (~345 call sites). `src/middleware.ts` only injects `x-pathname` for `/professional/*` — it does **not** enforce auth.
- **Business logic** lives mostly in `src/lib/**` services (matcher `appointment-routing.ts`, `notifications.ts`, `payment-settlement.ts`, `session-post-closure.ts`, `account-merge.ts`, …) — but a meaningful amount is **also inline in big route handlers and pages** (booking funnel, webhook, payout, no-show billing).
- **Data**: 25 Mongoose models in `src/models`. `User` and `Appointment` are central; **`Appointment` doubles as the service-request record** (it can have no pro/date while `routingStatus` is pending). Field-level AES-256-GCM encryption on contact fields. See overview + debt-map for the `routingStatus`/`cascadeAttempts` state machine.
- **Frontend**: heavily client components (`"use client"`, ~192 files), plain React hooks (no Redux/Zustand/SWR), shadcn/Tailwind, all copy via next-intl (FR+EN **lockstep**).

## 6. Rules for new code (applied from now on — old code is grandfathered)

- New code follows [docs/conventions/code-style.md](docs/conventions/code-style.md) §(b). Inventory existing code first and **extend existing patterns** rather than inventing new ones.
- **Bilingual lockstep**: any user-facing copy change updates **both** `messages/en.json` **and** `messages/fr.json`. Thread `lang` through email builders.
- TypeScript: **no new `any`**, **no new `@ts-ignore`** (use `@ts-expect-error` with a reason). Old code has ~91 `any`s — don't add to them.
- New logic gets a test; a bug fix gets a **regression test first**. Tests are `*.spec.ts` (vitest, node env) — pure functions in `src/lib`, route guards under `src/app/api`.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`…), matching the existing history.
- **Never weaken a gate** (lint rule, test, tsconfig strict, `ignoreBuildErrors`) to make work pass. Propose gate changes separately and explicitly.
- Validate at trust boundaries (user input, network, storage). Money, auth, and routing changes need extra care and a test.
- **Boy-scout cleanup is opt-in** — only refactor adjacent legacy code when explicitly asked; otherwise log it in the debt-map.

## 7. Legacy zones — handle with care

- **Money & state machines**: `src/app/api/payments/webhook/route.ts` (untested), `src/app/api/stripe-connect/payout/route.ts` (atomic claim / idempotency / Connect verification), `src/app/api/appointments/[id]/complete-session/route.ts` (charges money + closes billing). Regressions move/lose money. Always add a test.
- **The matching cascade**: `Appointment.cascadeAttempts` is **deliberately distinct** from `refusedBy` — do not derive one from the other (release/reassign also write `refusedBy`). See debt-map.
- **God-files** (edit surgically, don't rewrite): `lib/notifications.ts` (~6.7k lines), `lib/email-template-registry.ts` (~3k), `app/appointment/page.tsx` (~3.1k), `signup/member`, `MedicalProfile.tsx`.
- **Dates**: always write appointment dates through `parseAppointmentDate` (UTC-noon anchor) — never `new Date("YYYY-MM-DD")`.
- **Encryption ordering**: the `User` lookup-hash pre-save hook must run **before** the contact-encryption plugin (phone must still be plaintext). Don't reorder.
- **`/api/files/[id]`**: coarse auth (any signed-in user can read any non-`content-image` file by id) + a BSON-Binary empty-body trap — keep the normalize branch.
- See the full list, including the **`admin@admin.com`/`admin123` production super-admin**, in [docs/quality/debt-map.md](docs/quality/debt-map.md).

## 8. When unsure

Stop after **two** failed attempts at the same fix and ask one concrete question instead of pushing a hack through. If a doc contradicts the code, the doc may be stale — flag it and propose the doc fix in the **same PR**. When a change is hard to reverse or touches money/auth/PII, confirm before proceeding.
