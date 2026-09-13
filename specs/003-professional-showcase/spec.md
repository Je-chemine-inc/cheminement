# Spec 003 — Professional showcase pages and local SEO funnel (« Pages vitrines praticiens »)

**Status:** APPROVED 2026-09-12 — owner decisions in §3. Phased plan in [plan.md](plan.md); routing
decision in [ADR-0003](../../docs/architecture/decisions/0003-per-city-showcase-hosts.md).
**Progress:** phase 0 (city hosts), phase 1 (pages, invitations, admin review), phase 2 (city,
expertise and region pages, visit counts), phase 3 (free times on the pages, requests held until the
professional answers, quick consultation pricing), phase 4 (a professional's waitlist: offers held
15 minutes by email and, with consent, text message) and phase 5 (trainings and digital products
professionals publish, the team reviews and the platform sells, their share credited to the ledger)
built, not merged; everything showcase-related is dark behind `showcaseEnabled`. Products are not
behind that switch: none exists until a professional creates one and the team approves it.
**Created:** 2026-09-12.
**Origin:** the clinic's cahier des charges « Pages Vitrines Praticiens & Entonnoir SEO » (v1.0,
2026-09-12): one page per professional that introduces them to the public and feeds a local search
funnel — « obligatoire de mettre psy+ville, ex. PsyMascouche.jechemine.ca/Sassi ».

---

## 1. Problem

Visitors never see a professional before a match. The client describes a need, the matcher proposes
the request, and the professional's name first appears once they accept. Nothing public presents a
professional — no page, photo, title, fees or availability — so the platform earns no search traffic
for « psychologue à Mascouche », and professionals have no reason to send their own audience to Je
chemine rather than to an independent website.

## 2. Goal

The admin chooses which professionals are presented. Each one gets a page on its city's host
(`psymascouche.jechemine.ca/<nom>`), built from what the professional supplies after an invitation
and what the platform already knows (title, permit number, languages, modalities, fees). City, region
and expertise pages generated from those pages form a local search funnel. From a page, a visitor can
request a real slot within the next 14 days, join the professional's waitlist, or ask Je chemine's
matching for someone else — and, later, buy the professional's trainings and digital products.

## 3. Decisions (owner, 2026-09-12)

| Topic | Decision |
|---|---|
| URLs | Real subdomains from day one, one per Quebec city (`psymascouche.jechemine.ca`, `psymontreal.jechemine.ca`); the professional's page at `/<slug>` on its city's host |
| Who is shown | The admin invites and publishes; no professional is public without an admin's approval and the professional's consent |
| Content | The professional writes the presentation, values and expertise tags and adds a photo; identity facts (title, permit, languages, modalities, fees) come from the profile |
| Booking from a page | The visitor picks a service — « Consultation standard » or « Consultation ponctuelle rapide » — and a slot; the slot is held and the professional confirms or declines. No instant booking |
| Waitlists | Exclusive to the professional: a freed slot is offered to the first in line through a link valid 15 minutes (email, and SMS with its own consent). General: Je chemine's matching |
| First public release | Pages, admin curation and invitations; city, region and expertise pages; slots and booking requests; both waitlists |
| Trainings & products | Professionals publish and sell their own (video, audio, PDF, webinar, or a link to a course sold elsewhere) after an admin's approval; the platform sells them and credits the professional's share, net of a commission, to their ledger |
| Switch | `PlatformSettings.showcaseEnabled`, off by default: nothing is public until the owner turns it on |
| Not in v1 | Instant booking, ratings or testimonials, a monthly subscription for professionals, inbound calendar sync |

## 4. Acceptance criteria

1. With `showcaseEnabled` off, every city host sends visitors to www, no showcase API answers, a city
   host's robots.txt disallows everything, and the booking funnel behaves exactly as before.
2. The host alone decides routing, never the scheme; no redirect leads to another redirect.
3. Each page has one indexable URL: the internal `/showcase/<city>/…` path always redirects to its
   city host, and every showcase page declares an absolute canonical on its own host.
4. A city host's sitemap lists only that host's URLs; a city page is indexable only once a
   professional is presented there.
5. No page, API or HTML exposes a professional's email, phone, home location, payout details,
   calendar token, professional rate or the platform's margin — asserted with a poison fixture on the
   public data object.
6. A professional is public only while the switch is on, an admin approved the page, the professional
   consented to the current consent text, and their account is active.
7. A slot shown on a page is free when requested: two visitors cannot hold the same slot, and no other
   booking path can take a held slot.
8. A waitlist offer holds its slot for 15 minutes and can be claimed once; SMS goes out only with the
   SMS consent.
9. A product that is not approved is never sold; the professional is credited once per sale and
   debited once per refund.
10. No rating, testimonial or clinical information appears on any public page.

## 5. Compliance

- **Professional orders' advertising rules** (e.g. the OPQ code of ethics): the exact title and permit
  number, clear fees, no testimonials. To validate with the orders before launch.
- **Loi 25:** the professional's consent to publication is versioned and withdrawable (unpublish at any
  time). Waitlist contacts consent for that purpose only, SMS separately; their phone is encrypted at
  rest like `User.phone`; entries are purged after 90 days.
- **CASL:** waitlist offers are messages the person asked for; every email carries a link to leave the
  list.
- **Taxes on products:** courses, PDFs and webinars are taxable supplies and the platform is the
  merchant — an owner decision before the first live sale.
