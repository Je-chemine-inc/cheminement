# Plan 003 — Professional showcase pages and local SEO funnel

Approved by the owner 2026-09-12. Spec: [spec.md](spec.md).

## Context

The clinic wants public **showcase pages** for selected professionals (cahier des charges in
`docs/Cahier des Charges - Pages Vitrines Praticiens & Entonnoir SEO - Je Chemine.docx`):
identity (HD photo, official title, order number, city/region, in-person/teleconsultation
badges), bio and expertise tags, a transparent price grid, real-time slots with a booking
request per service (« Consultation standard » / « Consultation ponctuelle rapide »), a two-level
waitlist (exclusive to the professional, or Je Chemine's general matching), and a trainings /
digital-products shop. The pages feed a **programmatic local SEO funnel** (regions, cities,
expertises). The admin decides who is published; professionals are invited to supply the content.

**Owner decisions (2026-09-12):**

| Topic | Decision |
|---|---|
| URLs | Real subdomains from day one, one per Quebec city: `psymascouche.jechemine.ca`, `psymontreal.jechemine.ca`, … Professional page `psymascouche.jechemine.ca/sassi`. |
| Booking on the page | Request with the slot held; the professional confirms or declines. No instant booking. |
| First public release | Showcase pages + admin curation + invitations, city/region/expertise SEO pages, real-time slots + booking request, both waitlists. Products follow. |
| Trainings & products | Professionals self-publish and sell (editor, price, media/PDF/webinar), admin moderation, sold on the platform, share credited to the professional's ledger. External links allowed. |

**What exists today (verified):** no public professional page, no `slug`, no photo (`User.image`
is never written), no waitlist, no consultation-type concept beyond `isEmergency` +
`Profile.acceptingEmergencyConsultations`, pricing per therapy type only (`Profile.rates`),
slots computed only in `api/appointments/available-slots` (server-local time, unauthenticated with
`?professionalId=`), the client never picks a professional or a slot (`POST /api/appointments`
already accepts `professionalId`+`date`+`time` but no UI sends them), cookie-based locale with no
URL prefix, `SITE_URL` hardcoded in 4 files, a single-host middleware, cPanel AutoSSL per hostname
(no wildcard cert, no wildcard DNS), the premium-resource pipeline (`ContentEntry` kind `resource`
+ `ResourceEntitlement` + purchase-intent + webhook) as the only digital-goods system, and the
admin permissions `manageProfessionals` / `approveProfessionals` declared but enforced nowhere.

**Compliance frame (not legal advice, to validate with the orders):** the professional orders'
advertising rules (OPQ code of ethics) forbid testimonials and require the exact title, permit
number and clear fee wording; the pages show **no ratings or testimonials** (`Profile.showRating`
stays unused). Loi 25 / CASL: the professional consents to publication (versioned); waitlist
contacts give versioned consent, SMS separately; a professional can unpublish any time.

**Working rules (unchanged):** one branch per phase, green gate (`pnpm test`,
`pnpm exec tsc --noEmit`, `MONGODB_URI=… STRIPE_SECRET_KEY=… pnpm build`), mutation-check the key
specs, local end-to-end with mongodb-memory-server + dev server + headless Chrome, FR/EN lockstep,
merge (= deploy) only on the owner's yes. Everything deploys **dark**
behind `PlatformSettings.showcaseEnabled` (default off), exactly like organization billing.

---

## Architecture in one page

- **Hosts.** `www` keeps auth, dashboards, the funnel, hubs (`/psy`, `/psy/<region>`). City hosts
  `psy<city>.jechemine.ca` serve the city landing (`/`), expertise pages (`/specialite/<slug>`),
  professional pages (`/<pro-slug>`), their own `robots.txt` and `sitemap.xml`. The middleware
  rewrites a known city host to the internal segment `src/app/showcase/[cityKey]/…`; unknown
  `psy*` hosts 307 to the www home (temporary: the registry grows); www never serves `/showcase/*` (308 to the
  canonical host). Host only, never the scheme (debt-map 2026-09-07 loop trap).
- **Registry.** `src/lib/showcase-cities.ts` derives cities from the Quebec entries of
  `src/data/canadaCities.ts` (host key = `psy` + name stripped of accents/non-alphanumerics:
  `troisrivieres`, `saintjerome`, `valdor`; region path key with hyphens). Add Nord-du-Québec
  (Chibougamau) to the data file; optional `parentKey` to fold boroughs into `montreal` / `quebec`.
  *(2026-09-13, owner's go-ahead: the list now holds every official « Ville » of the MAMH
  Répertoire des municipalités — 238 hosts with the four smaller municipalities already listed;
  boroughs and former cities carry `partOf` and get no host for now.)*
- **Data.** New `ShowcasePage` (1:1 professional: slug, city, workflow status, `draft` and
  `published` content snapshots, photo, consent). Identity facts (title, licence, languages,
  modalities, office city, prices) are **read live** from `User`/`Profile`/pricing, never copied.
  New `SlotHold` (the single booking lock), `WaitlistEntry`, `Appointment.directRequest`,
  `Profile.rates.quick` + `quickConsultation.durationMinutes` (admin-set), `ContentEntry` product
  fields, `ProfessionalLedgerEntry.source/ledgerKey`, `PlatformSettings.showcaseEnabled` +
  `productCommissionPercentage`.
- **Flows.** Invite → wizard → submit → admin review → publish (snapshot) → live. Slot picked →
  hold → request proposed to that professional → confirm (= accept + schedule, payment invitation
  as today) or decline/timeout (→ admin queue + client email with two choices). Waitlist join →
  slot freed → 15-min claim link (email + SMS with consent) → claim → same request flow.
  Product create → submit → approve → sold on `www/book/<slug>` → ledger credit (commission).
- **Public DTO boundary.** `src/lib/showcase-public.ts` builds the public object key by key from
  an allowlist; a spec fails when a `User`/`Profile` field is neither classified public nor
  private (fail closed, like `profile-writable-fields.ts`).

---

## Phase 0 — Foundations and the wildcard host (branch `feat/showcase-foundations`)

**Docs first.** `specs/003-professional-showcase/spec.md` (problem, goal, the decisions table
above, acceptance criteria, compliance) and `plan.md` (this plan); ADR-0003 « per-city showcase hosts »
(slot holds get their own ADR with phase 3).

**Settings & gates.**
- `PlatformSettings.showcaseEnabled` (Boolean, default false) + `GET /api/showcase/status`
  (public `{enabled}`) + `PUT /api/admin/showcase-settings` (mirror of
  `api/admin/organization-billing/route.ts`, audit log line). Add it to the admin settings GET
  **and** PUT allow-list.
- `requireProfessionalsAdmin()` in new `src/lib/professional-admin.ts` (copy of
  `requireBillingAdmin`, on `manageProfessionals`). `AdminUiPermissions` gains
  `manageProfessionals` (`src/lib/admin-nav.ts`, `getAdminUiPermissions`), a generic
  `AdminAccessRequired` panel replaces the billing-only one for the new screen.
- `src/lib/site-url.ts` (`CANONICAL_HOST`, `SITE_URL`, `STAGING_HOST`) replaces the four
  hardcoded constants (`src/app/layout.tsx`, `sitemap.ts`, `robots.ts`, `OrganizationJsonLd.tsx`).

**Host routing.** `src/lib/showcase-hosts.ts` (pure: `classifyHost`, `cityHostFor`,
`absoluteShowcaseUrl`, `internalShowcasePath` ↔ `parseInternalShowcasePath`, special files
`/robots.txt → /robots-txt`, `/sitemap.xml → /sitemap-xml`), `src/lib/showcase-cities.ts`, and
`src/middleware.ts` rules in order: apex → 308 www (unchanged); any host + `/showcase/*` → 308 to
the canonical city URL (unknown city → `next()` → layout 404); city host → `/_next/*`,
`/favicon*` pass; `/api/showcase/*`, `/api/files/<id>`, `/api/auth/session|csrf` pass; other
`/api/*` → 308 www; everything else → `NextResponse.rewrite` to
`/showcase/<cityKey><path>` (query kept); unknown `psy*` → 307 to the www home; other unknown
`*.jechemine.ca` → 307 to the same path on www (temporary: the registry grows); `127.0.0.1`/empty host (image optimizer, watchdog) →
`next()`. Matcher stops excluding `txt|xml` (keeps `html` for the GSC file). Keep
`middleware.ts` (a `proxy.ts` beside it is a build error in Next 16).

**Route tree.** `src/app/showcase/[cityKey]/{layout.tsx,page.tsx,[proSlug]/page.tsx,
specialite/[expertise]/page.tsx,robots-txt/route.ts,sitemap-xml/route.ts}` (folders starting with
`_` are private in Next 16; static segments win over `[proSlug]`; pro slugs validated against a
reserved list). The layout: unknown city → `notFound()`; switch off → `redirect(SITE_URL)` (307);
`metadataBase` = the city host (nested layouts may override it, verified); its own light
`ShowcaseHeader/Footer` with absolute www links. **No `loading.tsx`/Suspense above it**
(soft-404 trap). Every page sets an **absolute canonical** and explicit `openGraph.images` +
`twitter` (root `"./"` would resolve to `/showcase/…`). `export const dynamic = "force-dynamic"`
like the other public pages.

**Ops runbook (owner does, with the exact sequence written into `docs/ops/HANDOFF.md`):**
1. Pre-flight on the box: `apachectl -S`; confirm `ProxyPreserveHost On` and
   `X-Forwarded-Proto` in the existing includes; snapshot the whole DNS zone to a file;
   check hstspreload.org status (HSTS already ships `includeSubDomains; preload`, so every
   subdomain must be valid-https from first contact).
2. **Wildcard certificate via DNS-01 (acme.sh, Let's Encrypt, RSA 2048).** DNS API needed:
   Namecheap API (eligibility: 20+ domains, or $50 balance, or $50 spent in 2 years; IP
   allow-list; its `setHosts` rewrites the whole record list → diff against the snapshot) **or**
   move the zone to Cloudflare, DNS-only. Fallback for a pilot only: one cPanel subdomain per
   city + AutoSSL (50 certs/week limit, ops per city). Never parked aliases on the www cert.
3. cPanel wildcard subdomain `*.jechemine.ca` (`uapi SubDomain addsubdomain domain='*' …`;
   filesystem name `_wildcard_.jechemine.ca`), excluded from AutoSSL; `acme.sh --issue --dns …
   -d '*.jechemine.ca'` (staging CA dry run first, no repeated `--force`); `--install-cert` with
   a reload hook running `uapi SSL install_ssl` on the wildcard vhost; includes
   `userdata/ssl/2_4/jechemin/_wildcard_.jechemine.ca/proxy.conf` (same as www) and
   `userdata/std/…/redirect.conf` (301 to https same host, `/.well-known` carve-out, **no
   ProxyPass on :80**); `ensure_vhost_includes && apachectl configtest && apachectl graceful`.
4. Only then the DNS `*` A record → 173.209.43.39. Verify from outside: `openssl s_client
   -servername psymascouche.jechemine.ca` → `CN=*.jechemine.ca`; https city host → 307 to www
   while off; http → 301; `psyfoo.` → 307 to www; `staging`/`www` unchanged; www
   `/.well-known` still reachable; renewal drill; a cron warning at <14 days; Imunify WebShield
   restart if it serves a stale cert. Rollback: remove includes + vhost + `*` record.
5. Search Console **Domain property** `jechemine.ca` (DNS TXT); per-city sitemaps referenced by
   each host's robots.txt.

**Tests.** First `src/middleware.spec.ts` (real `NextRequest`; asserts `x-middleware-rewrite`,
308 targets, the scheme header ignored, host normalisation, `127.0.0.1` untouched),
`showcase-hosts.spec.ts`, `showcase-cities.spec.ts` (unique keys, `^[a-z0-9]+$`, QC only, all
17 regions present, reserved labels), `showcase-metadata.spec.ts` (absolute canonical, never
`/showcase/`, images always set), `sitemap-xml/route.spec.ts` (own host only, 307 when off).

---

## Phase 1 — Showcase content, invitations, admin curation, the professional page (branch `feat/showcase-pages`)

**Model `src/models/ShowcasePage.ts`** (1:1 `userId`, unique): `slug` (lowercase,
`^[a-z0-9]+(-[a-z0-9]+)*$`, unique, reserved words: `specialite`, `api`, `showcase`, `robots.txt`,
`sitemap.xml`, `favicon.ico`, `opengraph-image`, `appointment`, `login`, …), `previousSlugs[]`
(301 from an old slug), `cityKey` (registry), `status`:
`invited | draft | submitted | changes_requested | published | unpublished` (no document = not
invited), `invitedAt/By`, `remindedAt`, `submittedAt`, `reviewedAt/By`, `reviewNotes`,
`publishedAt`, `unpublishedAt/By`, `consent {acceptedAt, version, ip}`, `photo {fileId,
updatedAt}`, `draft: ShowcaseContent`, `published?: ShowcaseContent` (snapshot served publicly),
`expertiseSlugs[]` (denormalised from `published` for the city/expertise queries),
`seo {title?, description?}`. Indexes `{slug}` unique, `{cityKey, status}`, `{status,
expertiseSlugs}`.
`ShowcaseContent` (`_id:false`): `displayName` ≤80, `headline {fr, en?}` ≤120, `intro {fr,en?}`
≤600, `bio {fr,en?}` ≤3000 **plain text** (paragraphs rendered as `<p>`, no HTML from pros),
`values[]` ≤5×60, `approachSummary {fr,en?}` ≤600, `expertiseSlugs[]` ≤12,
`order {code: OPQ|OPPQ|OTSTCFQ|OCCOQ|CMQ|OIIQ|other, label?}`, `insuranceNote {fr,en?}` ≤300,
`services {standard {enabled, note?}, quick {enabled}}`, `showProducts`. Pure
`transitionShowcase(state, action, actor)` table + `showcaseCompleteness(draft, profile, photo)`
(missing: photo, headline, bio ≥ 200 chars, ≥ 3 tags, order + licence, city in registry,
consent) in `src/lib/showcase-workflow.ts`.

**Expertise taxonomy.** `ProCatalogItem` (category `expertise`) gains `slug` (unique among
`showcase: true`), `showcase: boolean`, `seoLabelFr/En?`; admin curates the SEO list on the
existing pro-catalog screen; the wizard offers only `showcase: true` items and suggests from
`Profile.problematics`. `Profile.problematics` stays the matcher's input (logged in the
debt-map as two lists on purpose).

**Photo.** `StoredFile.kind += "showcase-photo"`; `PUBLIC_STORED_FILE_KINDS = ["content-image",
"showcase-photo"]` used by `/api/files/[id]` (change only the `isPublic` condition; keep the BSON
normalize branch). `POST /api/professional/showcase/photo` (jpeg/png/webp, ≤ 5 MB, min 800 px,
`prepareAndScanUpload`, `infected` → 422, `error` → 503, old file deleted on replace),
`DELETE`. Rendered with `next/image` (`localPatterns` not required — verified in
`match-local-pattern.js`; the optimizer's internal fetch carries no cookies, hence the public
kind). `next.config.ts` unchanged except a later `frame-src` fix (phase 5).

**Professional side.** `/professional/dashboard/showcase` (wizard: 1 identité — mirrored fields
title/licence/city/languages/modalities saved through the existing `PUT /api/profile` allowlist
with links to the profile; 2 présentation; 3 expertises; 4 services & tarifs — prices read-only
from pricing, the two toggles reuse `AcceptingNewClientsCard` / `AcceptingEmergencyConsultationsCard`;
5 photo; 6 aperçu; 7 consentement & soumission) and `/showcase/preview` (renders the public
components with the draft). APIs `src/app/api/professional/showcase/**`: `GET`, `PUT` draft
(`SHOWCASE_SELF_WRITABLE` allowlist, fails closed), `POST submit` (completeness + consent
version), `POST unpublish`, photo routes. Editorial edits after publication go to `draft` and
need re-approval; the two service toggles apply immediately. Sidebar entry « Ma page vitrine ».

**Admin side.** `/admin/dashboard/showcases` (gate `manageProfessionals`): every approved
professional with showcase status, city, slug, filters, and actions **Inviter** (creates the doc
`invited` + email), **Relancer**, **Aperçu** (draft/published, server-rendered with the public
components), **Approuver et publier** (copies `draft` → `published`, sets `expertiseSlugs`,
201s nothing else), **Demander des modifications** (notes, email), **Dépublier**, **Modifier**
(admin edits the draft with the same form), slug and city edits, plus the global switch and the
list of live city hosts (count of published professionals per city). APIs
`src/app/api/admin/showcases/**` with a filesystem-driven guard spec.

**Emails (6 types × 5 touch points, category « Pages vitrines & liste d'attente »):**
`showcase_invitation` (benefits, what to prepare, CTA to the wizard), `showcase_reminder`,
`showcase_submitted` (admin alert, category « Alertes administratives »), `showcase_published`
(public URL), `showcase_changes_requested` (notes), `showcase_unpublished`.

**Public page** `psy<city>.jechemine.ca/<slug>` (served from the `published` snapshot only,
professional `User.status === "active"`, switch on): header (photo, display name, exact title
from `PROFESSIONAL_TITLES`, order + permit number, city/region, badges from `Profile.modalities`,
languages), présentation (headline, intro, bio, values, approach), expertises (tags → expertise
× city pages), grille tarifaire (standard: solo/couple/group from `calculateAppointmentPricing`,
duration from `availability.sessionDurationMinutes`; quick: price/duration when enabled;
insurance note; **cancellation policy from one source**: move the route's constants
`48 h / 15 %` into a pure `src/lib/cancellation-policy.ts` used by both the cancel route and
the page; log the `PlatformSettings.cancellationPolicy` drift), disponibilités (phase 3 —
phase 1 shows the CTA « Demander un rendez-vous » → `https://www.jechemine.ca/appointment?from=showcase&pro=<slug>&city=<cityKey>`
stored as `Appointment.origin` attribution only), liste d'attente (phase 4), formations (phase 5).
JSON-LD `Person` + `BreadcrumbList`; `generateMetadata` with the city-host canonical and the
photo as OG image. `src/lib/showcase-queries.ts` (server-only, `.lean()` + explicit `.select()`)
is the only place documents exist; pages receive `ShowcasePublicProfile` only.

**Tests.** `showcase-workflow.spec.ts` (transition table, completeness), `showcase-public.spec.ts`
(allowlist equality, poison fixture with `email/phone/location/payoutInteracEmail/
calendarFeedToken/rates.*.professionalRate`, schema-drift guard), professional and admin route
specs (self-writable allowlist drops `status/slug/published/consent`; admin guard sweep; approve
copies the snapshot; unpublish 404s the page), photo route spec (kind, size, scan outcomes),
`files/[id]/route.spec.ts` extended (`showcase-photo` public, cached), `pro-catalog` slug
uniqueness, email-template-categories spec green, a `messages-lockstep.spec.ts` for the new
namespaces (`Showcase`, `ShowcasePro`, `ShowcaseAdmin`).

---

## Phase 2 — The SEO funnel (branch `feat/showcase-seo`)

- **City landing** `psy<city>.jechemine.ca/`: H1 built from the listed professionals' real
  titles (« Psychologues et psychothérapeutes à Mascouche », generic fallback « Professionnels en
  santé mentale à Mascouche »), templated intro (FR/EN), professional cards, « À proximité dans
  {région} », expertise links, FAQ (`FAQPage` JSON-LD from a small FR/EN template set), CTA to
  the funnel with city attribution. **Thin-content rules:** indexable and in the sitemap only
  with ≥ 1 published professional **in the city**; 0 in city but ≥ 1 in the region → served with
  `robots: noindex, follow`, not in the sitemap; 0 in the region → 307 to the region hub.
- **Expertise × city** `/specialite/<slug>`: only when ≥ 1 published professional in the city
  carries the tag (else 404, not in the sitemap). Same H1/intro/FAQ template logic.
- **www hubs** `src/app/(public)/psy/page.tsx` (all regions → cities with counts) and
  `psy/[region]/page.tsx` (cities of the region, professionals) — the internal-linking backbone
  that lets Google discover the subdomains; added to the www sitemap; region JSON-LD `ItemList`.
- **Per-host robots/sitemap** route handlers (`buildCityRobotsTxt`, `buildSitemapXml` in pure
  `src/lib/showcase-seo.ts`; own host only; `Disallow: /api/`, `/showcase/`; www `robots.ts`
  adds `Disallow: /showcase/`).
- **Stats (light):** `ShowcaseDailyStat {scope: pro|city, key, day, views, ctaClicks}` with
  `$inc` from the pages and the CTA link (via a tiny beacon route, rate-limited); shown in the
  admin list and the professional's showcase screen (« vue 124 fois ce mois »).
- Tests: template helpers (H1 by titles, thin-content decision table), sitemap/robots handlers,
  hub pages' data loaders, JSON-LD builders (valid shapes, no private fields).

---

## Phase 3 — Real-time slots and the booking request (branch `feat/showcase-booking`)

**Slots.** New pure `src/lib/available-slots.ts`: `generateTimeSlots` (moved verbatim),
`torontoDayKey`, `weekdayName`, `slotStartsAt` (via `getAppointmentStartAt` + a round-trip guard
that drops non-existent DST wall times), `computeFreeSlots({availability, bookedKeys, heldKeys,
from, days = 14, now, minLeadMinutes = 120, durationOverride})`. Quick consultations use the
**same grid** with a shorter recorded duration. Loaders in `src/lib/slot-holds.ts`
(`loadBookedKeys` = `status: "scheduled"`, `loadHeldKeys` = active holds).
- Public `GET /api/showcase/[slug]/slots?service=&from=` (60/min/IP; 404 when unpublished or
  switch off; `available: false, waitlistSuggested: true` when the service is disabled or the
  professional is not accepting; body = days/slots/duration/price only — never
  `professionalId`, `professionalRate`, `platformFee`, working hours) and
  `GET /api/showcase/[slug]/summary` (name, photo, title, city, per-service price/duration).
- Harden the legacy `GET /api/appointments/available-slots`: session required,
  `?professionalId=` only for admins or self, rate-limited, computed with `computeFreeSlots` +
  held keys, response shape unchanged for the proposals page (regression spec).

**Quick-consultation pricing (admin-controlled, spec 001 model).** `Profile.rates.quick` +
`Profile.quickConsultation.durationMinutes` (15–90), `PlatformSettings.defaultPricing.quick?`;
`professional-pricing.ts` gets `RATE_KEYS = [...THERAPY_TYPES, "quick"]` (do **not** widen
`TherapyType`); the admin pricing editor gains the row; `calculateAppointmentPricing(proId,
therapyType, { quick })` uses `rates.quick` → `rates.solo` → platform default. A quick
consultation carries `therapyType: "solo"`, `isEmergency: true`, the shorter `duration`;
closure pre-selects `sessionActNature = "punctual_consultation"`. `PROFILE_SELF_WRITABLE`
unchanged (fails closed).

**Hold = the single booking lock.** `src/models/SlotHold.ts` `{professionalId, dayKey, time,
startsAt, kind: direct_request|waitlist_offer, appointmentId?, waitlistEntryId?, expiresAt}`,
unique `{professionalId, dayKey, time}`, TTL on `expiresAt` **as garbage collection only**.
`acquireSlotHold` (insert wins; takes over an expired-but-not-GC'd hold once; duplicate key →
`SLOT_TAKEN`), `releaseSlotHold`, `assertSlotFree` — the latter replaces the bare
`status: "scheduled"` conflict checks in `schedule-first`, `professional/appointments/[id]`,
`admin/appointments/[id]` and the `[id]` PATCH reschedule path (409 `SLOT_HELD`).

**Direct request.** `Appointment.directRequest {showcaseSlug, cityKey, service, source:
showcase|waitlist, slot {dayKey, time, startsAt}, holdId?, respondBy, state: pending|accepted|
declined|expired|withdrawn|rerouted|reassigned, professionalDisplayName, declineReason?,
declineNote?, waitlistEntryId?, actionTokenHash?, actionTokenExpiry?}` (no `select:false`;
indexes on `holdId`, `{routingStatus, "directRequest.respondBy"}`, `actionTokenHash`). The row
is created like `request-with-current-pro` does today: `status: "pending"`, `routingStatus:
"proposed"`, `proposedTo: [pro]`, `professionalId` **unset** (so the accept claim filter still
holds), `date/time/duration` set, priced with the quick option, `respondBy = min(now + 24 h
| 12 h quick, startsAt − 60 min)`.
- Intake: `parseDirectIntent` in `appointment-writable-fields.ts` (`direct {slug, service,
  date, time}`; any client-sent `professionalId/date/time/duration/changeProfessional` dropped and
  logged). Shared `src/lib/direct-request.ts`: `prepareDirectRequest` (published showcase →
  service gate → slot recomputed for that day → hold acquired **before** the insert → fields),
  `finalizeDirectRequest` (emails), `abandonDirectRequest` (hold rollback on insert failure),
  `releaseDirectRequest` (atomic claim on `state: "pending"` → `routingStatus: "awaiting_admin"`,
  `date/time/proposedTo` unset, hold released → waitlist, client + admin emails). Both
  `POST /api/appointments` and `/guest` get the same ~25-line insertion and never call the
  matcher for a direct request.
- Funnel (`src/app/appointment/page.tsx`, five surgical insertions): read `pro/service/date/time`,
  `DirectRequestBanner` (fetches the summary; 404 → falls back to the normal funnel with a
  notice), availability grid skipped when a slot is chosen, `therapyType` locked to solo for
  quick, payload gains `direct`, review and success copy name the professional and the deadline;
  `SLOT_TAKEN` → « choisir un autre créneau » link back to the page.
- Professional: proposals page shows a « Demande directe » card (service, slot, deadline from
  `respondBy`); `POST /api/appointments/[id]/accept-direct` = **one atomic claim** (accept +
  schedule-first: `professionalId`, `routingStatus accepted`, `status scheduled`,
  `firstScheduledAt`, `awaitingPaymentGuarantee`, re-priced; in-person address rule;
  `assertSlotFree` first → 409 `SLOT_CONFLICT`), hold deleted, guest provisioned, first-appointment
  confirmation + payment invitation exactly as `schedule-first` (extract
  `src/lib/first-appointment-confirmation.ts` and `src/lib/match-confirmation.ts` first, with
  regression specs pinning `schedule-first` and `accept`). No jumelage email for a direct request.
  `POST …/decline-direct {reason, note?}` (`refusedBy` only for `not_a_fit`/`not_accepting`).
  `/accept`, `/refuse` and the PATCH refusal branch refuse direct rows (409 `USE_DIRECT_ROUTES`).
  Schedule page renders held slots as « Demande en attente » chips.
- Timeout: `runDirectRequestTimeouts` (rows past `respondBy` → `releaseDirectRequest(expired)`),
  called from `runProposalTimeouts` (whose cascade query now excludes `directRequest`) and from the
  waitlist runner. Client email `direct_request_unavailable` with two CTAs: join this
  professional's waitlist (page prefilled via a hashed 14-day action token) or « laisser Je
  Chemine me jumeler » (`POST /api/appointments/direct/reroute {token}` → `routingStatus pending`
  → matcher). Admin queue shows the « Demande directe déclinée/expirée » badge; existing assign /
  auto-match actions work because `date/time` were unset.
- Client: withdrawal of a pending direct request allowed (the 48 h rule now applies to
  `scheduled` rows only — regression test); dashboard row shows who was asked.
- Emails: `direct_request_received` (pro, priority), `direct_request_confirmation` (client),
  `direct_request_unavailable` (client), `admin_direct_request_returned`.

**Tests.** `available-slots.spec.ts` (Toronto day key at 03:30 UTC, lead time, DST drops,
held/booked exclusion), `slot-holds.spec.ts`, `direct-request.spec.ts` (hold before fields, no
`professionalId`, quick → solo + emergency + duration, pricing option, waitlist transfer),
`direct-request-timeouts.spec.ts` + `proposal-timeout.spec.ts` (direct rows never cascade, no
`cascadeAttempts` increment), `accept-direct` / `decline-direct` route specs (claim filter,
`SLOT_CONFLICT`, address rule, hold deleted, helpers called, jumelage not called), `accept` /
`refuse` / `schedule-first` regression specs, both booking routes' intake specs, `pricing.spec.ts`
(quick precedence, `price = fee + payout`), the public slots/summary specs (leak assertions,
429), `/api/appointments/proposed` redaction (existing gap fixed: `redactPaymentForProfessionalAll`).
Mutation checks: hold not created; `professionalId` set at creation; timeout cascades; quick
priced as solo when `rates.quick` exists; slot outside availability accepted.

---

## Phase 4 — Waitlists (branch `feat/showcase-waitlist`)

- **General list = the existing matcher.** The join form's second option sends the visitor to
  `www/appointment?from=showcase&pro=<slug>&city=<cityKey>&service=…` without a slot: no new
  rows, no second matcher (debt-map rule against parallel systems).
- **`src/models/WaitlistEntry.ts`**: `professionalId`, `showcaseSlug`, `cityKey`, `kind:
  "exclusive"`, `userId?`, `firstName`, `lastName`, `email` (lowercase, plaintext like
  `User.email`), `phone?` (top-level, `attachContactStringEncryption`), `locale`, `service`,
  `therapyType`, `modality`, `motifs[1..3]` (validated), `preferredAvailability[]`, `notes?`,
  `consent {given, at, version, ip}`, `smsConsent {given, at?, version?}`, `status: active |
  offered | converted | expired | left | removed`, `offers[] {slotDayKey, slotTime, slotStartsAt,
  holdId, tokenHash (select:false), expiresAt, sentAt, channels[], outcome, appointmentId?}`,
  `missedOffers` (3 → expired), `leaveTokenHash`, `expiresAt` (90 days, no TTL — consent record;
  purged by `data-lifecycle.ts`). Partial unique `{professionalId, email}` on active/offered;
  position derived from `createdAt`, never stored. Tokens: 16 random bytes base64url, sha256 at
  rest.
- **Join** `POST /api/showcase/[slug]/waitlist` (5/15 min/IP + 3/day/email; consent version
  required; SMS consent needs a phone; cap 50 active per professional → 409; duplicate → 200
  idempotent without a second email; `waitlist_joined` with the leave link). Leave page
  `www/liste-attente/quitter?t=` + `POST /api/waitlist/leave`.
- **Offer engine** `src/lib/waitlist-offers.ts`: `entryFitsSlot`, `pickOffers` (pure);
  `offerSlotToEntry` (hold `waitlist_offer` 15 min → atomic entry claim → email + SMS only with
  consent; SMS ≤ 160 chars GSM-7, short link `/la/r?t=` redirected to
  `/liste-attente/reclamer`); `onSlotFreed(professionalId, dayKey, time)` called with `after()`
  from every path that frees a future scheduled slot (client/pro/admin cancel, reschedule of the
  old slot, admin delete, `changeProfessional` auto-cancel, `releaseDirectRequest`);
  `runWaitlistOffers` (expire offers → back to `active` with `missedOffers+1`, third miss →
  `expired`; expire 90-day entries; for each professional with active entries, offer the free
  slots within 14 days in queue order; runs `runDirectRequestTimeouts` first). Cron:
  `src/app/api/cron/waitlist-offers/route.ts` + crontab `*/2 * * * *` + `lazy-cron` trigger from
  the proposals poll, the admin queue and the public slots route.
- **Claim** `www/liste-attente/reclamer?t=` (standalone page like `/pay`; countdown) →
  `GET /api/waitlist/offers/[token]` (410 `OFFER_EXPIRED|CLAIMED|INVALID`) → `POST
  /api/waitlist/claim` (transient `converting` claim → account by email or prospect →
  `prepareDirectRequest(source: "waitlist", existingHoldId)` → appointment → entry `converted`
  → pro `direct_request_received`). v1 claims are `bookingFor: "self"` only. A later decline
  follows phase 3 (new waitlist entry at the back).
- **Professional** `/professional/dashboard/waitlist` (own entries: first name + last initial,
  service, since, position, current offer; remove; « proposer ce créneau » manually) and
  **admin** `/admin/dashboard/waitlist` (full fields, `managePatients`).
- Emails/SMS: `waitlist_joined`, `waitlist_offer` (+ SMS), `waitlist_left`, `waitlist_removed`
  (reason missed/expired/professional/admin). Twilio STOP is not reflected (no inbound webhook):
  the leave link is the source of truth (debt-map).
- Tests: `waitlist-offers.spec.ts` (order/fit, hold before entry claim, SMS only with consent,
  expiry counting, runner idempotent under overlap, switch off → no new offers but expiries run),
  join/leave/claim/offer route specs (consent, dedupe, cap, 410 codes, slot taken on claim → entry
  back to active), `sms.spec.ts` length/GSM-7, lockstep spec with `WAITLIST_CONSENT_VERSION` in
  both message files. Mutation checks: SMS without consent; offer to an already-offered entry; two
  holds per slot; expired token claims.

---

## Phase 5 — Trainings and digital products, self-published (branch `feat/professional-products`)

- **Extend `ContentEntry` (kind `resource`), no third model:** `ownerProfessionalId?`,
  `productType: video|audio|pdf|webinar|external`, `externalUrl?`, `fileId?` (per locale),
  `webinar {startsAt, durationMinutes}` (public) + `webinarAccess {joinUrl, replayUrl?}` (paid,
  stripped like `contentHtml`), `listInLibrary` (default false), `moderation {status: draft|
  submitted|approved|rejected|unpublished, revision, submittedAt, reviewedAt/By, notes,
  reviewRequestedAt, attestedAt, history[]}`, `salesCount`. Stored `status` stays the single
  public switch, written for owner rows only by `syncProductLiveStatus` (`approved` ∧ owner
  active → `published`). Slug server-generated (`slugify(titleFr)`, reserved words, `-2…`
  suffixes, immutable). Price bounds 5 $–1 000 $; external products free/unsellable.
- **Sanitisation:** add `sanitize-html` (pure JS; not jsdom/DOMPurify) — allowlist `p br h2 h3
  ul ol li strong em s u blockquote a img hr`, `a[href https|mailto]` with forced
  `rel/target`, `img[src]` only `/api/files/<24 hex>` of a public kind, 200 KB cap; runs on
  **every pro write** and again on admin approve, never at render. `ContentEntryEditor` gets
  `uploadEndpoint/accept/restricted` props; `ProProductEditor` wraps it. Pro image upload
  `POST /api/professional/products/uploads` (kind `product-image`, public, 2 MB, no SVG/GIF,
  scan `error` → 503).
- **Delivery:** video/audio through `media-embed.ts` iframe providers only (`product-media.ts`
  makes the resolver the allowlist; direct files refused); **`next.config.ts` `frame-src` must
  add the embed hosts — production CSP blocks every embed today** (own debt-map entry: affects
  `/medias` and existing premium videos); PDF as `StoredFile` kind `product-file` (private, 10 MB,
  content-length pre-check, magic bytes, scan) served by `GET /api/products/[slug]/file?token=`
  gated by `resolveResourceAccess` (attachment, `no-store`, `nosniff`, sandbox CSP, fixed name);
  webinar join URL post-purchase + `product-webinar-reminders` cron (H-24, claim stamp);
  external cards link out.
- **Money:** `PlatformSettings.productCommissionPercentage` (default 20, absorbs Stripe fees —
  stated in the pro terms), `splitProductPriceCents` in integer cents (49,00 $ → fee 980, net
  3920), snapshot on `ResourceEntitlement` (`ownerProfessionalId, commissionBps, platformFeeCents,
  netToProfessionalCents, productType, taxTreatment: "inclusive_untracked"`) and in PI metadata at
  purchase-intent time; `ProfessionalLedgerEntry.source` (`product_sale | product_sale_reversal |
  product_sale_recredit`) + sparse-unique `ledgerKey` (`product_sale:<pi>`); webhook insertions
  inside the existing resource branches: credit on `granted` **or** `already-paid` (order
  independent of `/confirm`), reversal on full refund and dispute, recredit on a failed refund;
  DB errors throw so Stripe retries. Refund after payout → negative balance carried forward
  (payout route already refuses ≤ 0). Sales journal `type_ligne` `vente_produit` /
  `remboursement_produit`. `receipt_email` on resource intents + Stripe dashboard receipts.
- **Workflow/UI:** pro `/professional/dashboard/products` (list, form per type, submit with
  rights attestation, withdraw, unpublish, delete without paid sales); admin
  `/admin/dashboard/products` queue (`manageContent`; approve/reject with notes/unpublish;
  preview via `/book/<slug>`); admins never edit pro HTML (`PUT/DELETE /api/admin/content/resource/<slug>`
  → 409 `PRO_OWNED`, CMS list excludes owner rows). Edits after approval: stay live + flagged for
  re-review (owner may pick the strict variant). Reader `/book/[slug]`: buyers keep access to
  unpublished products (fixes the latent admin-resource gap), owner/admin preview banner,
  per-type delivery, byline « par {Pro} », taxes-included note. Showcase section = cards linking
  to `https://www.jechemine.ca/book/<slug>` (checkout stays on www: auth cookie, one canonical
  reader, zero new checkout code); optional listing in `/book`.
- Emails: `product_sold` (pro, no buyer identity), `product_moderation_decision`,
  `admin_product_submitted`, `product_webinar_reminder`.
- Tests: sanitizer XSS fixtures, commission math (rounding, property `fee + net = gross`),
  ledger idempotency (one row per PI, replay, reversal once), media allowlist, slug, moderation
  table, writable allowlist + IDOR (404, filter contains the owner id), file route (403 without
  entitlement, headers, token bound to slug, entitled-but-unpublished 200), purchase-intent
  extensions (owner gate, snapshot, admin rows byte-identical), webhook extensions, admin guard
  sweep, sales-journal lines.

---

## Cross-cutting

- **Feature switch behaviour when off:** city hosts 307 to www; `/api/showcase/*`, `/api/waitlist/*`
  404; `prepareDirectRequest` refuses; the funnel ignores `?pro=`; the runner creates no offers
  but expiries/timeouts keep running; sitemaps exclude everything. Second gate: the per-page
  `published` status. Products go live independently once the owner's professional is active.
- **Security:** allowlisted DTOs with poison specs; every public route rate-limited (in-memory,
  single process — logged); hashed tokens with expiry; ownership filters in every professional
  query (404 on miss); admin routes swept by filesystem-driven guard specs; `manageProfessionals`
  enforced on the new admin routes (first enforcement — logged).
- **i18n:** FR canonical on every host (cookie is host-only, first visit FR); new namespaces
  `Showcase`, `ShowcasePro`, `ShowcaseAdmin`, `Waitlist`, `Products`, `Seo.psy*`; a lockstep
  spec; professional-authored text is FR with optional EN.
- **Docs in each branch:** debt-map dated entries (private `_` folders, canonical `"./"`,
  matcher change, cancellation drift, `available-slots` hardening, slot-hold TTL = GC, Twilio
  STOP gap, CSP `frame-src`, buyers keep access, two expertise lists, funnel touch points);
  `docs/ops/HANDOFF.md` (wildcard TLS runbook, the two crontab lines, adding a city);
  `docs/architecture/overview.md` stale line 9 (sitemap/robots exist) + new models;
  `docs/product/prd.md` scope + `critical-user-journeys.md`: CUJ-13 invite → publish, CUJ-14 slot
  → request → confirm → payment, CUJ-15 waitlist join → offer → claim, CUJ-16 declined request →
  client choice, CUJ-17 product publish → sale → ledger.
- **Sizes (relative):** phase 0 M (+ owner ops), phase 1 XL, phase 2 L, phase 3 XL (legacy money
  and routing zones), phase 4 L, phase 5 XL. Phases 1–2 can start while the wildcard cert is being
  set up; nothing goes live before the switch is turned on.

## Design hand-off

Screens the design must cover, with their states:
1. **Professional page** (city host, desktop + mobile): header, présentation, expertises, price
   grid (standard / quick / trainings), slots widget (available / none within 14 days → waitlist
   module / service disabled), waitlist join form (two options, consents), products cards, CTA.
2. **City landing**, **expertise × city page**, **www hubs** (`/psy`, `/psy/<region>`): cards,
   FAQ, « à proximité » fallback, empty states.
3. **Funnel additions** on www: direct-request banner, review/success copy, « slot taken »
   error; **claim page** with countdown (valid / expired / already claimed); **leave page**.
4. **Professional dashboard**: « Ma page vitrine » wizard (7 steps, completeness checklist,
   preview, statuses invited/draft/submitted/changes requested/published), proposals card
   « Demande directe », schedule chips « demande en attente », « Liste d'attente » tab,
   « Mes formations et produits » list + form per type + states.
5. **Admin**: « Pages vitrines » table + review dialog + city hosts + switch, requests-queue
   badge, waitlist view, products moderation queue, pricing editor row « Consultation ponctuelle
   rapide », settings inputs (commission).
6. **Emails**: invitation, offer (email + SMS text), direct request received / unavailable,
   product sold.
Tokens: Tailwind 4 + shadcn (new-york); hubs reuse the www Header/Footer, city hosts a lighter
chrome with absolute www links.

## Reused, not rebuilt

| Need | Existing code |
|---|---|
| Switch + admin toggle | `api/admin/organization-billing/route.ts`, `PlatformSettings` |
| Admin gate pattern | `requireBillingAdmin` (`src/lib/organization-admin.ts`), guard specs |
| Slugify | `src/lib/content-kind.ts` |
| Upload + antivirus, public image serving | `prepareAndScanUpload`, `StoredFile`, `/api/files/[id]` |
| Direct request shape | `api/appointments/request-with-current-pro/route.ts` |
| Accept / schedule / payment invitation | `[id]/accept`, `[id]/schedule-first`, `resolveBillingUrl` |
| Timeouts, cron, lazy backstop | `proposal-timeout.ts`, `api/cron/*`, `lazy-cron.ts`, `CronRun` |
| Toronto time | `appointment-start.ts`, `appointment-date.ts` |
| Tokens | `client-portal-urls.ts` (random bytes), `account-init.ts` (sha256) |
| Encryption of a phone | `attachContactStringEncryption` |
| SMS | `src/lib/sms.ts` |
| Email types | `EmailTemplate.ts`, `email-template-registry.ts`, `PlatformSettings.ts`, settings `EMAIL_TEMPLATE_INFO`, `notifications.ts` |
| Digital goods | `ContentEntry` resource + `ResourceEntitlement` + purchase-intent + `resource-access.ts` + webhook branch |
| Ledger credits/negatives | `ProfessionalLedgerEntry`, `session-payer-reassign.ts` |
| City/region data | `src/data/canadaCities.ts`, `location-match.ts` |

## Verification

1. **Gate per branch:** `pnpm test` (focused, then full), `pnpm exec tsc --noEmit`,
   `MONGODB_URI="mongodb://127.0.0.1:27017/x" STRIPE_SECRET_KEY="sk_test_x" pnpm build`, no new
   lint errors in touched files.
2. **Mutation checks** listed per phase, with scratchpad scripts that edit, run the spec, restore.
3. **Local end-to-end:** mongodb-memory-server (port 27999), `pnpm exec next dev -p 3100`,
   headless Chrome over CDP with `--host-resolver-rules="MAP *.jechemine.ca 127.0.0.1"` so
   `http://psymascouche.jechemine.ca:3100/sassi` exercises the real host routing (curl with a
   `Host:` header for the handlers). Scenarios: switch off → 307; invite → wizard → submit →
   approve → page live, 404 for an unknown slug (real 404, not soft), robots/sitemap per host,
   private-field grep on the HTML; slots → request → confirm → payment invitation; decline and
   timeout → client email links; two concurrent requests on one slot; waitlist join → cancel a
   session → offer (SMS dry run) → claim → request; product create → approve → guest purchase in
   the Stripe sandbox → PDF download → refund → ledger reversal.
4. **Production, after each deploy:** `gh run watch`, `server.js` mtime, `systemctl is-active`,
   clean `journalctl`; for phase 0 the external curl/openssl series from the runbook and
   `staging`/`www` untouched; Search Console domain property once city pages are indexable.

## Defaults taken without asking (say so if any is wrong)

- Region hubs live on www (`/psy/<region>`), not on subdomains; boroughs may fold into their
  city host.
- A city page is indexable only with a professional in that city; with none in the region it
  redirects to the hub.
- Identity facts are read live from the profile; only editorial content is snapshotted and
  re-reviewed after publication; the two service toggles apply immediately.
- Professional bios are plain text (no HTML from professionals); FR required, EN optional.
- No ratings, testimonials or reviews anywhere on the pages.
- Quick-consultation price and duration are admin-set in the pricing editor; a quick consultation
  is `solo` + `isEmergency` with a shorter duration; same slot grid.
- The professional confirms within 24 h (12 h quick), never later than one hour before the slot;
  declined/expired requests go to the admin queue and the client gets the two-choice email.
- The general waitlist is the existing matching funnel; the exclusive waitlist keeps queue
  position after a missed offer and expires after three misses or 90 days; offers hold the slot
  15 minutes; SMS only with its own consent.
- Products: commission 20 % absorbing Stripe fees, bounds 5 $–1 000 $, edits after approval stay
  live and are flagged, partial refunds absorbed by the platform, buyers keep access to
  unpublished products, checkout stays on www.

## Owner decisions still needed (none block the code)

1. DNS API for the wildcard certificate: Namecheap API (top-up if not eligible) or move the zone
   to Cloudflare DNS-only. Pilot fallback: per-city cPanel subdomains.
2. ~~Taxes on products~~ — decided 2026-09-14: Je chemine collects TPS and TVQ, **added at
   checkout** on top of the displayed price, on professionals' products and the team's premium
   resources alike; rates and registration numbers set by an admin (« Taxes sur les ventes en
   ligne », off until both numbers are entered); the commission is on the price before taxes;
   each purchase keeps its amounts and rates (`taxTreatment: "added"`). Still for the accountant:
   TPS/TVQ on the commission charged to professionals, and buyers outside Quebec.
3. Wording to validate with the orders: fee grid, title/permit display, the professional consent
   text; the rights attestation and product terms for professionals.
4. ~~Which cities get a host at launch~~ — every official « Ville » (2026-09-13). Still open:
   whether boroughs and former cities (Plateau-Mont-Royal, Verdun, Sainte-Foy, Chicoutimi, Hull…)
   get their own host, and whether smaller municipalities are added up front or one by one.

## Phase 3b — Availability back on the page, on real hours only (2026-09-18)

The owner's model: « Demander un rendez-vous » stays centralised (the general list) on every page,
and says so. A section « Disponibilités » appears **only** when the professional publishes real
hours; picking a time there is a direct request to them, as phase 3 built it. On 2026-09-16 the
section had been removed outright because a page with no real hours was advertising booking.

**Owner's decisions (2026-09-18):** the section sits after « À propos »; the fallback checkbox is
unchecked by default; only hours the professional saved themselves count; both the standard session
and the quick consultation are offered.

**Why « saved by them »:** in production 5 of the 6 active professionals have exactly Monday–Friday
9:00–17:00 — the signup default. Showing « the schedule » would advertise slots nobody chose.

Steps, reusing phase 3 throughout (slots, holds, `directRequest`, accept/decline, timeouts):
1. `Profile.availabilityConfirmedAt`, set only when the professional saves their own schedule.
   `loadBookableShowcase` treats unconfirmed availability as none — the one choke point for the
   page, the slots API, the direct intake and the waitlist runner.
2. The page renders « Disponibilités » (restyled `VitrineBooking`, no waitlist) after « À propos »
   only when a service is offered **and** its first window has a free time; dock entry
   « Disponibilités ». Nothing rendered otherwise.
3. `directRequest.fallbackToGeneral` (unchecked by default, set in the funnel): on a decline or an
   expiry the request goes straight to matching (`state: rerouted`, `routingStatus: pending`,
   matcher run) and the client is told; without it, phase 3's email with the choice.
4. One line under the centralised button: the request goes to the general list.
5. Walked end to end in a browser, with and without hours, with and without the checkbox.

Legacy contact: `appointment/page.tsx` (checkbox + copy), the direct-request state machine and the
matcher hand-off, email templates — each behind a spec first.

### Phase 3b addendum — the professional turns it on (2026-09-18)

The owner, after seeing it locally: « make it work so Hélène, from her account, can activate it and
set her hours — the form 100 % working with our platform ».

- **One switch, the professional's:** « Afficher mes disponibilités sur ma page » is the page's
  consultation switches (`services.standard` / `services.quick`). Both are now **off until switched
  on** (schema default and every reader: only `true` counts), so no page opens times its
  professional did not open. In production all three pages already had both off.
- **Decoupled from the profile's intake flags:** « Accepte de nouveaux clients » and « consultations
  ponctuelles rapides » now govern automatic matching only, as their own copy always said. Hélène
  takes no new clients through the general list and still wants her free hours on her page.
- **One place:** a « Disponibilités sur ma page » card opens « Ma page vitrine » — the switch, the
  consultations, her hours editor (the same one as in Profil; her save confirms the hours), and a
  state line (`showcaseAvailabilityState`: off / page not online / needs hours / no free time /
  live with the first free time). The admin's page screen shows the same card, worded about the
  professional, without the editor. The old « Services offerts sur la page » card is gone.
- **The form, end to end:** its first screen names the professional and the time chosen; the
  professional's request card and decline dialog say when a decline hands the request to the
  general list (the client's consent) instead of promising another time.
- **Verified** in two browsers against the local server: sign in as the professional, switch on,
  save hours, a client asks through the form and is accepted, another ticks the box and is declined
  to the general list, switch off and on — 50 checks on screen, in the database and in the emails.

## Phase 3c — the page is the professional's, and the team adds Je chemine resources (2026-09-18)

The owner: « make sure everything in the page is controllable by the professional so he can add and
modify things », and « sometimes we force our resources into their pages — give the admin the
possibility ». An inventory of the live page found most of it already the professional's (texts,
cards, photos, themes, colour, section order and visibility, 7 section titles, the availability
switch and hours; title, permit, years, languages and ways of consulting in Profil). The gaps and
what was done:

**Owner's decisions (2026-09-18):** remove the inputs that show nowhere (« Valeurs », office photos
2 to 6); theme descriptions stay Je chemine's only; the team's resources **always show** — the
professional sees them but cannot remove them, even by hiding « Ressources ».

- **Nothing entered that never shows.** « Valeurs » leaves the editor, the draft rules and the
  public profile (stored values kept, retired). A page has **one office photo**: an upload replaces
  it, removing clears it, ordering is gone.
- **Themes show without cards.** A page with themes and no « Ce que j'accompagne » card showed no
  themes at all; `focusSectionParts` now draws the section, its dock entry, the cards and the themes
  list, each when it has something.
- **Every heading is theirs.** `SHOWCASE_TEXT_KEYS` gains each section's name (which its dock entry
  shows too), « En bref », « Parcours », « Motifs de consultation » and the « Disponibilités » title
  and text — 18 texts, grouped by section in « Personnaliser la page », names capped at 30 characters
  for the dock. A blank one keeps the page's wording.
- **Stays the team's or the platform's:** the order name (verified), the page address, prices and
  the quick consultation length (spec 001), the theme catalogue and its descriptions, removing the
  portrait (a page needs one); the « Demander un rendez-vous » button, the line under it and the
  booking panel's wording (Je chemine's centralised booking).
- **Je chemine resources on a page.** `ShowcasePage.teamResourceSlugs`, set only by an admin
  (`PUT /api/admin/showcases/[userId]/resources`, « Ressources Je chemine sur cette page »): the
  team's own published resources only, six at most, in the admin's order, live. The page shows them
  after the professional's own, marked « Ressource Je chemine », in the visitor's language; one the
  team unpublishes drops out; when the professional hid « Ressources », the section stays with the
  team's alone. The professional sees them read-only in « Ma page vitrine ». A paid one bought from
  the page is Je chemine's sale, as on /book.
- **Verified** in four browsers against the local server (the professional, an admin, a French and
  an English visitor): 41 checks — one office photo added, replaced (old file deleted) and removed;
  her section names on the page and in the dock, in both languages; themes without cards; the admin
  placing and ordering three resources; the page's order, marks and prices; hiding « Ressources »;
  removal and unpublishing; a professional's product refused; the professional unable to change the
  team's list by either route. 15 of 15 mutants killed.

## Phase 3d — the admin creates pages like Hélène's, from the screens (2026-09-18)

The owner: « give the admin the possibility to create exactly pages like Hélène's, with all the
options we talked about ». Hélène's and Nassima's pages had been written into production by hand
with database scripts: activation took the city only from the office address (which no admin
screen sets), and publication demanded a headline, a 200-character presentation, three themes, the
order, the title, the permit and a way of consulting — Nassima's hero-only page could never be
published or corrected from the screens.

**Owner's decisions (2026-09-18):** a page goes public with its **photo and its name** (and a city of
the list); every section appears once it has content. **The office address is not needed:** the admin
chooses the page's city when activating it, and the professional can change it.

- **Publication rule:** `SHOWCASE_REQUIREMENTS` = photo, display name, city. A professional's live
  edit is refused only when it would take the name off (the photo cannot be removed anyway).
- **The city is the page's own setting:** chosen in the activation dialog (`suggestedCityKey` from the
  office address when it names a listed city, otherwise the admin picks, from Je chemine's list grouped
  by region); publishing and putting a page back no longer move it. `setShowcaseCity` (routes
  `PUT /api/admin/showcases/[userId]/city` and `PUT /api/professional/showcase/city`) changes it live,
  records a `city` history entry, and a professional's change reaches the team like any live edit.
  Replaces the rule of 2026-09-15 (« the page's city follows the office address »).
- **Addresses like the real pages:** a new page's slug opens with the profession for titles written
  the same for everyone (psychologue, psychothérapeute, neuropsychologue, psychiatre, ergothérapeute:
  `psychologue-helene-belzil`); « psychoéducateur » keeps the name alone. The dialog shows the proposal.
- **Everything else** Hélène's page has already worked from the admin screens: portrait, office photo,
  every text, themes, « En bref », « Parcours », the 18 headings, colour and order, the availability
  switch (hours stay the professional's own), Je chemine resources.
- **Verified:** 22 browser checks — an admin activates a page for a professional with no office address,
  choosing Mascouche; the address proposed is `psychologue-camille-roy`; the page is published with the
  photo and the name only (the hero alone); then filled (headline, presentation, three themes, office
  photo) and its corrections published; the admin moves it to Québec and the professional to
  Terrebonne, the title following each time, the team emailed for the professional's change; a city off
  the list and the admin route refused to the professional. 10 of 10 mutants killed.
