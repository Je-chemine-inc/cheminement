# Architecture overview — the system as it is

This describes **Je chemine** as it actually runs today, not as it was originally planned. (The root `README.md` is a stale April planning artifact that describes a Supabase / Zustand / React-Hook-Form+Zod build that was **never** the shipped stack — see [Known deviations](#known-deviations).)

## Rendering & data-flow model

- **Next.js 16 App Router**, React 19.2 with the **React Compiler** enabled (`next.config.ts: reactCompiler: true`). TypeScript strict.
- The UI is **heavily client-side**: ~192 files carry `"use client"`. Server components are essentially the route-group `layout.tsx` files, which call `getServerSession`/`auth()` to gate by role. Dashboards self-fetch their data in `useEffect` (raw `fetch()` or a thin `apiClient` singleton) — there is **no RSC data-loading layer, no SWR/React Query, and no global store**. "Real-time" is 30–60s polling.
- **Locale** is cookie-driven (`NEXT_LOCALE`), **not** a URL segment. `src/i18n/request.ts` defaults to **French** unless the cookie is exactly `en` (French-first by design). Copy lives in `messages/en.json` + `messages/fr.json` (lockstep). `src/app/sitemap.ts` and `robots.ts` serve www; each showcase city host serves its own (spec 003). There is no `hreflang`: one URL per page, French canonical.
- **Auth**: NextAuth v4 Credentials (bcrypt) + `@auth/mongodb-adapter`, **JWT sessions, 30-min maxAge**. Role/status/license are copied onto the token at login — so admin changes to a logged-in user are invisible until re-login (the pro dashboard works around this by re-fetching `/api/users/me`).
- **No edge auth**: `src/middleware.ts` routes by host — the bare domain to www, a showcase city host (`psy<city>.jechemine.ca`, spec 003) rewritten to `src/app/showcase/[cityKey]/…` (rules and tests in `src/lib/showcase-hosts.ts`) — and injects an `x-pathname` header. All access control lives inside route handlers and server layouts.
- **Persistence**: MongoDB via a cached Mongoose singleton (`src/lib/mongodb.ts`, retrying transient errors) + a separate `clientPromise` for the NextAuth adapter. **No multi-document transactions** anywhere — consistency relies on single-document atomic `findOneAndUpdate` "claims".

## Directory layout (role of each top-level folder)

```
src/
  app/
    (public)/        Marketing + CMS pages (home, services, approaches, explore, medias, nouveautes, legal, emergency, school-manager, contact)
    (auth)/          login, signup (member|professional), forgot/reset-password
    (verify)/        verify-account (email link → inline SMS)
    (privilaged)/    admin/, client/, professional/ portals (note the spelling — it's the real folder name)
    appointment/     The ~3,100-line multi-step booking funnel (self/loved-one/patient · guest/member · emergency/changeProfessional)
    pay/             Token-based guest payment + payment-method setup (Stripe Elements)
    api/             ~154 route.ts handlers (see below)
    actions/         server actions (locale.ts)
    showcase/        city hosts psy<city>.jechemine.ca, rewritten here by the middleware (spec 003)
    layout.tsx · not-found.tsx · error.tsx (no root loading.tsx: it turned every notFound() into an HTTP 200 — debt-map 2026-09-07)
  components/        ~141 .tsx, by domain: admin, appointments, auth, billing, dashboard, inbox, layout, legal, media, payments, sections, ui (shadcn)
  lib/              ~71 business-logic/service modules (the "brain") — see below
  models/           34 Mongoose models
  hooks/            use-mobile, useInactivityLogout, useMotifs, useMotifSearch
  config/           clinical-availability-grid, motifSearch, colors
  data/             static FR-first taxonomies (problematics, diagnostics, approaches, motifs, professionalTitles)
  i18n/             next-intl request config
  test/             vitest setup (mocks next-intl, stubs MONGODB_URI + FIELD_ENCRYPTION_KEY)
  middleware.ts · theme.ts
messages/           en.json + fr.json (the i18n catalogs)
scripts/            one-shot tsx ops scripts (backfill, add-stripe-webhook-events)
(no vercel.json)    crons live in /etc/cron.d/jechemine on the VPS (+ in-app "lazy cron" — lib/lazy-cron.ts)
```

### Where business logic lives

The core lives in `src/lib/**` and is consumed by route handlers:

- **Matching / jumelage** — `lib/appointment-routing.ts`: `calculateRelevancyScore` (pure, scored), `selectCascadeCandidate` (pure, 3-level cascade), `routeAppointmentToProfessionals` (commits routing atomically). Hard filters: **age** and **stated gender preference** only; everything else is soft scoring so the pool never empties.
- **Appointment routing state** — encoded on the `Appointment` doc (see [state machine](#the-appointment--service-request-state-machine)). Proposal timeouts in `lib/proposal-timeout.ts`.
- **Payments** — `lib/pricing.ts`, `lib/stripe.ts`, `lib/payment-settlement.ts`, `lib/session-post-closure.ts` (`issueFiscalReceipt`), `lib/session-closure.ts` (no-show billing), `lib/stripe-off-session-charge.ts`, `lib/payment-guarantee.ts`.
- **Notifications** — `lib/notifications.ts` (~6.7k lines): one `buildEmailHtml` builder behind ~46 `send*` functions, backed by the admin-editable `EmailTemplate` registry (`lib/email-template-registry.ts`, 45 keys, mustache `{{#}}/{{^}}` conditionals) with bilingual fallbacks. `getAdminAlertRecipients` centralizes alert routing.
- **Accounts** — `lib/service-request.ts` (intake → single pending Appointment), `lib/account-dedup.ts` + `lib/account-merge.ts` (phone/name dedup, client-only merge), `lib/messaging-permissions.ts`.
- **Cross-cutting** — `lib/mongoose-contact-encryption.ts` (AES-256-GCM), `lib/appointment-date.ts` (`parseAppointmentDate` UTC-noon), `lib/admin-rbac.ts` (13-permission RBAC + PII masking), `lib/platform-contact.ts`, `lib/rate-limit.ts` (in-memory, per-instance).

⚠ A meaningful amount of orchestration is **also inline in route handlers and pages** (the booking funnel, the Stripe webhook, the payout route, no-show billing math) rather than fully extracted to `lib/`.

## The Appointment / service-request state machine

A service request **is** an `Appointment` document (it may have no `professionalId`/`date`/`time` while routing). Two fields drive routing:

- **`routingStatus`**: `pending` → `proposed` (targeted offer, stamps `proposedAt`) → `accepted` (a pro takes it, stamps `matchedAt`; `status` stays `pending` until scheduled) **or** `refused`. When the targeted cascade is exhausted it returns to **`awaiting_admin`** (the admin "Demande de service" queue — **not** the pro pull). **`general`** = the always-open pool any active pro can self-claim.
- **`cascadeAttempts`** (the 3-level cascade counter): `0` → Tentative 1 **strict** (score ≥ 100 + availability), `1` → Tentative 2 **relaxed** (score ≥ 20), `≥ 2` → `awaiting_admin`. It is **deliberately separate** from **`refusedBy`** (the never-re-propose exclusion set, which release/reassign also write). Incremented only by a genuine refusal or a proposal timeout; reset to 0 when an admin re-runs auto-matching.

**Accept = match only.** A separate `schedule-first` sets the real date (via `parseAppointmentDate`), flips `status` to `scheduled`, and sends the single payment-invitation email. The client is **not** emailed on release/reassignment — they stay silent until a pro accepts.

## External services & integrations

- **MongoDB** on the WHC VPS (data + binary file storage as BSON `Buffer` in `StoredFile` — a pattern inherited from the read-only Vercel FS, kept because it still works and moving it is a migration).
- **Stripe 19** (`apiVersion 2025-10-29.clover`) — **separate charges & transfers** model: PaymentIntents carry no `application_fee`/`transfer_data`; the platform collects the full charge then pays pros later via admin-triggered `transfers.create` to Express Connect accounts (the platform holds the float). The **webhook** (`api/payments/webhook`, raw body, signature-verified, idempotent via `StripeWebhookEvent`) handles 7 event types (payment success/fail/cancel, full/partial refund with receipt void/restore, dispute, `setup_intent.succeeded`).
- **SMTP email** via Nodemailer (`lib/email-transport.ts`), **fail-soft** (skips silently if unconfigured). `MAIL_FROM` must equal `SMTP_USER` or be a verified Gmail alias.
- **Twilio** SMS via raw REST (`lib/sms.ts`), best-effort; `SMS_DRY_RUN` for local.
- **Crons**: 7 routes scheduled **hourly** from `/etc/cron.d/jechemine` on the VPS (via `run-cron.sh`, which curls `127.0.0.1:3000`), guarded by a shared `Bearer CRON_SECRET`. The time-sensitive **matching cascade** (24h/12h proposal timeouts) no longer depends on a scheduler — an **in-app "lazy cron"** (`lib/lazy-cron.ts`, throttled via a `CronRun` DB heartbeat) advances it off the admin-queue / pro-proposals polls. An external pinger (e.g. cron-job.org) hitting the same `CRON_SECRET`-guarded endpoints is the optional 24/7 backstop. All runners are idempotent.

## Entry points

- **Web**: `src/app/layout.tsx` (root) → route groups. Public booking entry is `/appointment`; guest payment is `/pay?token=`. A showcase city host enters at `src/app/showcase/[cityKey]/` through the middleware's rewrite. A professional's page there is a `ShowcasePage` with a draft and an approved copy; public pages read only the approved copy, and only through `src/lib/showcase-public.ts`, which builds what the public may see key by key. The directory of regions and cities lives on www (`/psy`, `/psy/<region>`); each city host adds its city page and expertise pages (`/specialite/<slug>`), indexed only where a professional is presented (`decideCityPage` in `src/lib/showcase-seo.ts`). A city host receives only the translation messages its client components use (`src/lib/client-messages.ts`, keyed on the `x-showcase-city` header the middleware sets).
- **API**: each `src/app/api/**/route.ts` exporting `GET/POST/PATCH/PUT/DELETE`. Stripe → `api/payments/webhook`. Crons → `api/cron/*`.
- **Background**: the 5 cron runners in `lib/*-reminders.ts` / `lib/proposal-timeout.ts`.

## Known deviations from a "target" architecture

These are recorded factually — they are **not** to be "fixed" except when a task is explicitly about them (see [ADR-0001](decisions/0001-adopt-ai-operating-model.md)).

- **`README.md` is obsolete**: it specifies Supabase, Zustand, React-Hook-Form+Zod, Framer-only, and a mock-JSON build. The real stack is Next.js 16 + MongoDB/Mongoose + NextAuth + Stripe, plain React state, no form library. The README is still useful as the *original product scaffold* (phases, Sentiers branch).
- **No shared auth/authz helper** — `getServerSession` + role/ownership checks are copy-pasted across ~141 files (~345 sites). A gate change must be made everywhere by hand.
- **Business logic inline in routes/pages** rather than thin routes over `lib/` services (booking funnel, webhook, payout, dashboard payment-flags).
- **God-files**: `lib/notifications.ts` (6.7k), `email-template-registry.ts` (3k), `app/appointment/page.tsx` (3.1k), `MedicalProfile.tsx` (2.2k), `signup/member` (2.1k).
- **Two of several things** coexist: two CMS models (`Problematique` legacy vs `ContentEntry`), two email-config layers (`PlatformSettings.emailSettings.templates` legacy vs `EmailTemplate`), two file mechanisms (`StoredFile` bytes vs `ClientDocument` URLs), two shadcn primitive generations, two animation systems (CSS keyframes + framer-motion), `guardianId` vs `accountManagerId`.
- **Orphaned design tokens**: `src/theme.ts` (indigo/purple) and `src/config/colors.ts` do **not** match the authoritative OKLCH variables in `globals.css`; `globals.css` references undefined `--font-*` variables (no `next/font` loaded).
- **No CI quality gate** — `.github/workflows/deploy-whc.yml` runs `next build` and nothing else; it does not run vitest or ESLint, and a green build deploys straight to production. See [debt-map](../quality/debt-map.md).
