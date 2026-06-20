# Product overview — what Je chemine does today

Written for a new teammate. For *why* and scope/metrics see the [PRD](prd.md); for the flows that must never break see the [critical user journeys](critical-user-journeys.md).

**Je chemine** (prod **www.jechemine.ca**) is a bilingual (French-first / English) Quebec online mental-health platform. It connects people who need mental-health support with vetted professionals, intelligently **matches** them, and then handles booking, payment, receipts, messaging, and professional payouts end to end. It is live and in production.

## The main user flows

**A client gets matched and seen.** A visitor lands on the marketing site, picks one of three intake personas — *for myself*, *for a loved one*, or *for a patient* (a physician/professional referral) — and fills a short funnel (`/appointment`) including 1–3 searchable "reasons for consultation" (motifs). No payment is asked for up front. Submitting creates a single **service request** (which is an `Appointment` record in a `pending` routing state). The **jumelage engine** scores active professionals and offers the request to the best fit; if they refuse or time out it cascades to a relaxed match, then to a general pool or the admin triage queue. A professional **accepts** (a match, not yet a time), then **schedules** a real date — which triggers a payment-method invitation. After the session, the professional **closes** it; the platform charges the saved card (or confirms an Interac transfer), issues a **fiscal receipt only once payment is confirmed**, and credits the professional's ledger.

**A guest pays without an account.** Guests can book and pay via a tokenized link (`/pay?token=`) using Stripe Elements, and are later provisioned into a claimable account.

**A professional runs their practice.** After signing up they wait for **admin approval** (they cannot enter the dashboard until approved). Once in, they see proposals (with accept SLAs — 24h regular / 12h emergency), can self-claim from the always-open general pool, manage their schedule and availability, complete sessions, see their billing/ledger, and message clients.

**An admin operates the platform.** Admins triage the request queues ("Demande de service" and "Pool Général"), assign/auto-match/release requests, schedule on a pro's behalf, approve professionals, issue manual invoices and professional payouts, manage users and roles, edit the CMS / legal docs / email templates, and handle account reactivation and right-to-be-forgotten deletion requests.

**Everyone communicates and learns.** Internal messaging links clients, their assigned professional, and support/admin (with a recipient allow-list). Public visitors browse a CMS-driven library of problématiques, treatments, news, and media.

## Shipped capabilities (one paragraph each)

- **Intelligent matching (jumelage).** A pure relevancy score over problematique, therapeutic approach, language, modality, availability, and a gender-preference bonus, with **hard filters only on age and stated gender preference** (so the pool rarely empties). A **3-level cascade** (strict → relaxed → admin queue) drives targeted offers; exhausted requests return to admins, never silently dropped. *(`src/lib/appointment-routing.ts`)*
- **Intake & motif search.** Three standardized personas and a fuzzy, accent-insensitive multi-select reason search (1–3 motifs) that feeds the matcher; motifs are validated against a live bilingual taxonomy. *(`src/components/ui/MotifSearch.tsx`, `src/models/Motif.ts`)*
- **Booking & scheduling.** A multi-step funnel for guests and members, plus emergency ("quick one-time consultation") and change-professional variants; admin and pro can schedule, edit, and drag-drop in their agenda. *(`src/app/appointment`, `src/app/(privilaged)/*`)*
- **Payments & billing.** Stripe card + ACSS/PAD charged off-session after the session, or **Interac** transfers confirmed by an admin; manual admin invoicing from the schedule; **receipts strictly gated on confirmed payment** with unique invoice numbers; no-show / late-cancel management fees at 100%; **manual professional payouts** via Stripe Connect transfers (to avoid per-charge fees). *(`src/lib/payment-settlement.ts`, `session-post-closure.ts`, `api/stripe-connect/payout`)*
- **Internal messaging.** Allow-listed conversations (client ↔ assigned pro ↔ support), near-real-time via polling, with peer-visibility controls for professionals. *(`src/lib/messaging-permissions.ts`)*
- **Editorial CMS.** A unified content model powering the public library (problématiques, traitements, nouveautés, médias) plus FAQ, legal documents, and editable transactional email templates — all bilingual, Tiptap-edited, with images stored in MongoDB. *(`src/models/ContentEntry.ts`, `EmailTemplate.ts`, `LegalDocument.ts`)*
- **Admin operations.** Role hierarchy with granular permissions, professional approval, request triage, accounting ledger, account reactivation/deactivation, Loi 25 right-to-be-forgotten deletion requests, and platform settings. *(`src/app/(privilaged)/admin`, `src/models/Admin.ts`)*

## Integrations that power it

- **MongoDB Atlas** — all data, plus binary uploads stored as BSON `Buffer`s (Vercel's filesystem is read-only).
- **Stripe 19 + Stripe Connect** — payments (separate charges & transfers; the platform holds the float), guest payments, ACSS/PAD mandates, refunds/disputes via a signed, idempotent webhook.
- **Nodemailer SMTP** — all ~45 transactional emails (fail-soft), built by one bilingual builder and backed by an admin-editable template registry.
- **Twilio** — SMS for phone verification and payment-request reminders (best-effort).
- **next-intl** — bilingual FR/EN, cookie-driven (no locale in the URL).
- **Vercel Cron + in-app lazy trigger** — daily reminder crons (`vercel.json`); the time-sensitive matching cascade advances via an in-app "lazy cron" off dashboard traffic (`lib/lazy-cron.ts`), with an optional external pinger as a 24/7 backstop.
