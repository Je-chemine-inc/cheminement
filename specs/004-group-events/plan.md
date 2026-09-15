# 004 — Group sessions and events: plan

Status: plan, not built. Owner's rules approved 2026-09-15 (« go ahead with ur recommendation »).
Money zone (AGENTS.md §7): every payment, refund and ledger step gets a test before it ships.

## What the owner decided

- One « Événement » with one or more dates: a group therapy series or a one-off workshop/talk.
- In person or video, chosen per event. The video link goes only to registered people.
- The professional sets a capacity. When full, people join the event's waitlist; a freed seat is offered to the next person.
- Paid online at registration, like products (same commission). Free events allowed. A series is one price, no drop-in.
- The person cancels: full refund up to 48 h before the first date, nothing after.
- The professional cancels: automatic full refund and an email to everyone registered.
- The professional sets a minimum. Not reached 48 h before the first date: the event is cancelled and refunded.
- The team reviews an event before it is public (like products).
- Reminders the day before and 1 h before each date.
- A receipt per registration; group therapy with a psychologist shows the permit number, like session receipts.
- Shown on the professional's page (an « Événements » section they can move or hide) and in a public list on www.

## Questions before the payment phase (not blocking phases 1–2)

1. **Taxes (accountant).** The owner chose « same TPS/TVQ handling as products ». Group therapy by a licensed
   professional is usually an exempt health service in Québec, while a talk or workshop may be taxable. Proposal:
   a per-event « taxable » choice set by the team at review, default *not taxable* for group therapy by a licensed
   professional. Needs the accountant's answer.
2. **Receipt wording (owner/accountant).** A receipt for a group therapy series valid for insurance: one receipt for
   the series (paid once), listing its dates. Proposal: yes, one receipt per registration.
3. **What the professional sees.** Proposal: first name, last name initial and email of each registered person
   (needed to run the group), never other health data.

## Design

### Data (new collections, nothing added to Appointment or ResourceEntitlement)

`ResourceEntitlement` does not fit: `amountCents` is min 1, one paid row per slug per user, `kind` is `resource` only.
`SlotHold` and `WaitlistEntry` are keyed on one consultation slot. So:

- **`GroupEvent`**: `ownerProfessionalId`, `slug` (unique), FR/EN `title`/`summary`/`descriptionHtml`
  (sanitized with `sanitizeProductHtml`), `iconUrl`, `kind` (`group_therapy` | `workshop`), `format`
  (`in_person` | `video`), `location` (city + address, address shown to registered people only), `joinUrl`
  (private, like `webinarAccess`), `sessions[{startsAt, durationMinutes}]` (1–20, sorted), `capacity` (2–50),
  `minimum` (1–capacity), `priceCents` (0, or 5 $–1 000 $), `seatsTaken` (confirmed + held),
  `moderation` (the products' block and moves: `productTransition`), `status` (`draft` | `published` |
  `cancelled` | `completed`), `cancellation {by, at, reason}`, `remindersSent[]`.
- **`EventRegistration`**: `eventId`, `userId?`, `name`, `email`, `locale`, `status`
  (`held` | `confirmed` | `waitlisted` | `offered` | `cancelled` | `refunded`), `holdExpiresAt`, `amountCents`,
  tax snapshot (like the entitlement), `commissionBps`, `stripePaymentIntentId` (unique sparse),
  `accessToken` (hashed), `refund {requestKey, status, stripeRefundId, amountCents}`, `receiptNumber`,
  `waitlistOffer {tokenHash, expiresAt}`, `remindersSent[]`. Unique: one open registration per email per event.

### Seats (the invariant)

`seatsTaken` only moves through one conditional update: `{_id, status: "published", seatsTaken: {$lt: capacity}}`
with `$inc: {seatsTaken: 1}`. Two people can never take the last seat. A held seat (payment in progress) expires
after 30 min and is released by the job; a cancelled or refunded registration releases its seat once (claimed on
the registration's status change).

### Payment (reuses the products' pieces)

- Registration route: take the seat, create the `held` registration, then a PaymentIntent with
  `metadata.type = "event_registration"`, idempotency key per registration. Free event: confirmed at once, no Stripe.
- Webhook: a new `event_registration` branch next to `resource_purchase` (same `StripeWebhookEvent` claim):
  `held → confirmed`, email with the access link (address or video link on the event page, never in the email).
- Ledger: generalize `syncProductLedger` to a target per purchase record; sources `event_sale`,
  `event_sale_reversal`, keys `event:<registrationId>:<n>`.
- Refunds: **the organization-invoice pattern** (`organization-invoice-refund.ts`): write the refund row first,
  then `stripe.refunds.create` with `idempotencyKey: evtref_<registrationId>`, settle on `charge.refund.updated`.
  ⚠ Do not copy the appointment cancellation refund (no idempotency key, silently continues on failure).
- Sales journal: `vente_evenement` / `remboursement_evenement` lines with the tax columns.
- Receipt: a new receipt kind keyed on the registration, `nextInvoiceNumber()` for the `JC-` number, the
  professional's `Profile.license`, the event's dates.

### Jobs (the products cron, every 10 min)

- Release expired seat holds.
- Minimum check: events whose first date is ≤ 48 h away with confirmed seats < minimum → cancel + refund all.
- Reminders day before and 1 h before each date (the webinar claim pattern with `$addToSet` + `$pull` on failure).
- Waitlist: a freed seat is offered to the next person for 15 min (quiet hours 21 h–8 h), their registration
  becoming `held` when they accept.
- Mark events `completed` after their last date.

### Screens and copy (FR/EN lockstep)

- Professional: « Mes événements » (list, editor with dates, capacity, minimum, price, format, send to the team,
  cancel with reason, registered people).
- Team: « Événements à vérifier » (approve, send back with notes, take down; taxable choice once Q1 is answered).
- Public: event page (dates, place or « en vidéo », seats left, register / join the waitlist, cancel link),
  « Événements » section on the professional's page, public list on www.
- Emails: submitted (team), decision (professional), registration confirmed, waitlist offer, cancelled by the person
  (with refund), cancelled by the professional / minimum not reached (with refund), reminders.

## Phases (each committed separately, none merged without the owner's yes)

1. **Events without money**: models, rules + tests, professional editor, team review, public page and list,
   page section, free registration, capacity and waitlist, cancellation of free events, reminders, emails.
2. **Paid registration**: seat hold, PaymentIntent, webhook branch, ledger, receipts, sales journal —
   blocked on Q1 (taxes) for the tax part only.
3. **Refunds and cancellations**: self-service cancel ≥ 48 h, professional cancel, minimum job, all through the
   idempotent refund pattern; signed-webhook browser run like the products one.

## Verification

Unit tests for every rule (seats, holds, 48 h window, minimum, refund amounts, ledger targets), route guard specs,
mutants on the seat and refund guards, and a browser run per phase on the local dev server with the SMTP sink
and signed Stripe events.
