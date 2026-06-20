# PRD — Je chemine (reverse-engineered)

> Reverse-engineered from the codebase on **2026-06-20**, with goals/non-goals/metrics/scope confirmed by the product owner. Every claim is **observed** (with a source) or **`[inferred]`**. Unknowns are Open Questions, not assumptions.

## Problem & opportunity

In Quebec, access to mental-health care is slowed by long waitlists and the friction of finding a professional who fits a person's specific needs, language, age group, modality, and availability. **Je chemine** positions itself as a bilingual "Plateforme de santé mentale™ / Integrated Health Platform™" that removes that friction with an **intelligent matching (jumelage) engine** plus an end-to-end path from intake to a paid, completed session — *"Quick access to qualified professionals… without long waiting lists"* and *"an intelligent matching system to guide you to the professional that suits you best."* *(observed: messages/en.json HeroSection/ClientAdvantagesSection; README.md goal statement)*

## Goals & non-goals

**Primary goal (confirmed):** **Faster matching** — reduce the time and effort from intake to an accepted match / first scheduled appointment. The jumelage engine is the flagged P0 differentiator. *(confirmed by product owner; observed P0 in TODO.md)*

**Secondary goals (confirmed, ranked):** more paid completed sessions; grow & retain professional supply; expand the B2B (schools/EAP) funnels. *(confirmed)*

**Non-goals (confirmed — Je chemine deliberately is NOT):**
- **A crisis/emergency service.** The `/emergency` flow is a "Consultation ponctuelle rapide", not a 24/7 crisis line; it disclaims and defers to 911 / 988 / 1-866-APPELLE. *(observed: src/app/(public)/emergency/page.tsx; messages EmergencyAppointment)*
- **A clinical EHR.** It captures intake (`MedicalProfile`) and session-act notes, not full electronic health records / clinical charting. *(confirmed; observed model scope)*
- **An insurance/RAMQ biller.** Clients pay the platform (Stripe/Interac) and claim with their insurer themselves; the platform does not bill public/private insurers. *(confirmed)*
- **A full B2B portal product.** Schools (Sentiers) and enterprise/EAP are **lead-capture forms only**, not self-serve portals. *(confirmed; observed: school-manager & enterprise/contact routes are contact-only)*

## Users & jobs

- **Clients / members** — three standardized intake personas: **"For myself"** (individual adult), **"For a loved one"** (child/spouse/etc.), **"For a patient"** (physician/professional referral). Job: *"find and book the right professional for me or someone I care for, fast, in my language."* Minors are handled via a **guardian / account-manager** model gated by the **Quebec LSSSS art. 14** age-14 rule (under-14 uses the parent's email; 14+ uses their own). *(observed: messages HeroSection forSelf/forLovedOne/forPatient; src/app/appointment/page.tsx; src/models/User.ts guardianId)*
- **Professionals / therapists** (psychologists, neuropsychologists, psychotherapists, psychoeducators, OTs in mental health, psychiatrists) — *"focus on people; let the platform handle scheduling, billing, payout, and matching."* They accept targeted proposals or self-claim from the general pool. *(observed: messages Professional*; src/app/(privilaged)/professional)*
- **Employees / admins** (role hierarchy `super_admin` → `platform/content/support/billing_admin` → `employee`) — run intake triage/routing, manual invoicing, professional payouts, the CMS, and account lifecycle. *(observed: src/models/Admin.ts; admin dashboard)*
- **Schools & enterprises** (B2B leads) — submit a school-service request (Sentiers: evaluation / ADHD / intervention plan) or an enterprise/EAP enquiry. Job: *"get a quote / be contacted."* *(observed: school-manager & enterprise contact forms)*

## Current scope (shipped capabilities, ranked by centrality)

1. **Intelligent matching / jumelage** — `lib/appointment-routing.ts`: weighted relevancy score (problematique, approach, language, modality, availability, gender bonus) with **hard filters only on age and stated gender preference**, and a **3-level refusal cascade** (strict score ≥ 100 → relaxed ≥ 20 → admin queue). The differentiator. *(observed)*
2. **Intake with a search-based motif engine** — 1–3 selectable "reasons for consultation" feeding the matcher (`MotifSearch`, `useMotifSearch`, `Motif` model). *(observed; P0 in TODO.md)*
3. **Booking & scheduling** — 3-persona funnel for guests and members, including emergency and change-professional variants; `Appointment` doubles as the service-request record. *(observed: src/app/appointment, src/models/Appointment.ts)*
4. **Payments & billing** — Stripe card + ACSS/PAD (off-session charge after the session) and **Interac** (out-of-band, admin-confirmed); manual admin invoicing; **fiscal receipts gated on confirmed payment** (golden rule); **manual professional payouts** via Connect transfers to avoid Stripe fees; no-show / late-cancel "Frais de gestion de dossier" billed at 100%. *(observed: lib/payment-settlement, session-post-closure, stripe-connect/payout; RAPPORT-FEEDBACK-JUIN-2026.md §4–6)*
5. **Internal messaging** — client ↔ assigned pro ↔ support/admin, with a recipient allow-list and 10s polling. *(observed: lib/messaging-permissions, InboxView)*
6. **Editorial / educational CMS** — `ContentEntry` (problématiques, traitements, nouveautés, médias), legal documents, FAQ, motifs, resources/library; Tiptap editor; images stored in Mongo. *(observed: src/models/ContentEntry.ts; admin content pages)*
7. **Admin operations** — user/role management, account reactivation/deactivation, right-to-be-forgotten deletion requests, accounting ledger, reports, platform settings, editable email templates. *(observed: admin dashboard + RAPPORT §1–2,9)*

## Constraints

- **Regulatory (Quebec)**: Loi 25 / Bill 25 compliance, data hosted in Canada, end-to-end encryption, mandatory 2FA, LSSSS art. 14 (minors), RGPD-style right-to-be-forgotten **with mandatory retention of invoices/financial data**, consent/terms versioning. *(observed: messages trust icons; src/models/AdminAccessLog.ts, AuthAuditLog.ts; request-deletion route)*
- **Technical**: in-production on Vercel (read-only FS → binaries stored in Mongo); no multi-doc transactions (atomic single-doc claims); JWT sessions go stale until re-login; fail-soft email/SMS; **no CI test gate** (see [debt-map](../quality/debt-map.md)).
- **Commercial**: separate-charges-and-transfers Stripe model — the platform holds the float and pays pros manually. *(observed: api/stripe-connect/payout)*

## Success metrics (confirmed — the ones the PRD tracks)

1. **Time to match** — intake → accepted match / first scheduled appointment.
2. **Proposal acceptance rate** — share of proposals pros accept before the cascade falls back to the admin queue (`cascadeAttempts`, `awaiting_admin`).
3. **Booking → paid conversion** — share of intakes that become paid, completed sessions (`payment.status === "paid"`, `fiscalReceiptIssuedAt`).
4. **Professional utilization & retention** — active pros, caseload fill, `acceptingNewClients` rates, churn.

*Targets are not yet committed — marketing copy's "95% satisfaction" / "24/7 support" are claims, not measured signals. See Open Questions.* `[inferred]` that the data to compute these exists in `Appointment`/`User`/ledger but no analytics pipeline was found.

## Open questions

- What numeric **targets/SLAs** back each metric (acceptable time-to-match, target acceptance rate, conversion benchmark)? None are committed in code.
- Is the **LIVE Stripe webhook** subscribed to all required events (`setup_intent.succeeded`, `charge.dispute.created`, `charge.refund.updated`)? *(debt-map P1)*
- Will **Sentiers (schools)** and **enterprise/EAP** ever become full portals, or remain lead-capture? (Confirmed lead-capture *for now*.)
- **International expansion** is the stated long-term scope — what triggers it, and what changes (multi-currency, beyond Loi 25/LSSSS, languages beyond FR/EN)? Today everything is Quebec/CAD/FR-first.
- Are the marketing claims (satisfaction %, professional perks like the investment fund / shareholding) commercially committed, or aspirational copy? Commercial terms live in an external collaboration agreement, not the code.
- Is the **booking-time acknowledgement email** still desired, or redundant now that the jumelage email is the first real client touch? *(flagged in audit)*

## Decision log

- **2026-06-20** — PRD reverse-engineered from the codebase; goals (primary: faster matching), non-goals (all four), success metrics (all four), and market scope (Quebec now, international later) **confirmed by the product owner**. Pending broader product-owner review of targets/SLAs and the Open Questions above.
