# Migration runbook — Vercel + Atlas → Canadian VPS (WHC/Vexxhost + Coolify)

**Goal:** all client PHI stored in Canada, on infrastructure operated by a Canadian company.
**Current state:** app on Vercel (US), MongoDB Atlas in **AWS `eu-west-3` (Paris, France)**.
**Target state:** Next.js app + self-hosted MongoDB on one Canadian VPS, managed via Coolify.

> Status: DRAFT — not yet executed. Nothing in production has been touched.

---

## 0. STOP — read this first

### 0.1 Field encryption is OFF in production (verified 2026-07-22)

**Correction to an earlier assumption:** `FIELD_ENCRYPTION_KEY` is **not set anywhere** — not in
`.env`, not in `.env.local`, and **not in Vercel** (its production env lists 24 variables; this is not
one of them). Per `src/lib/field-encryption.ts`, when the key is absent the code **stores values in
plaintext** (`encryptAtRestString` returns the input unchanged; `isFieldEncryptionEnabled()` is false).

**Implications:**

1. **No blocker for the DB copy.** Nothing is encrypted, so there is no key to lose. A plain
   `mongodump` → `mongorestore` copies cleanly. This was previously the highest-risk item; it is not.
2. **But this is a live Loi 25 gap.** Phone numbers, addresses, and Stripe payment-method references
   are stored **unencrypted** in the database today, even though the app was built to encrypt them.
   See §5.4 — enabling encryption during this migration is recommended, but it is a careful, separate
   step (backfill + a lookup-hash coupling), NOT part of the lift-and-shift cutover.

Retrieve the rest of the production secrets (all present) for the new host:

```bash
vercel link --yes --project cheminement-b77i --scope houssems-projects-c39dae14
vercel env pull <scratchpad>/jechemine.env.production --environment=production
```

### 0.2 Confirm the Atlas cluster region and take a verified dump

```bash
mongodump --uri="$MONGODB_URI" --out=./dump-preflight
```

Restore that dump into a local MongoDB and confirm the app boots and decrypts contact fields.
**An untested dump is not a backup.**

---

## 1. What silently breaks when leaving Vercel

These are Vercel-specific and have **no equivalent** on a plain VPS. Each needs replacing.

| # | Breaks | Why | Replacement |
|---|---|---|---|
| 1 | **The 5 cron jobs** | Defined in `vercel.json` `crons[]` — a Vercel-only feature. They will simply stop firing. | Coolify scheduled tasks (or system `cron`) calling each route with the `CRON_SECRET` bearer header |
| 2 | **File uploads** | `public/uploads/{content,problematiques}` is written at runtime. Vercel's filesystem is **ephemeral** — see §1.1 | Persistent volume mounted at `public/uploads` (VPS *fixes* this) |
| 3 | **TLS termination** | `next.config.ts` notes *"TLS 1.2+ is terminated by the host (e.g. Vercel)"* | Coolify's reverse proxy (Traefik/Caddy) + Let's Encrypt |
| 4 | **Build output** | No `output: "standalone"` in `next.config.ts` | Add it — see §5.1 |
| 5 | **Image optimization** | Vercel provides it natively | `sharp` (already installed, v0.34.5) ✅ |

### 1.1 Pre-existing bug this migration fixes

`public/uploads/` is **empty on disk (0 bytes)** despite `content/` and `problematiques/` subdirectories
existing. Runtime writes to `public/` on Vercel do not persist across deployments.

**Action:** before cutover, audit production for `ContentEntry` records whose image URLs point at
`/uploads/...` and return 404. Those images are likely already lost and will need re-uploading after
the migration — do not assume there are files to migrate. The VPS removes this failure mode permanently.

---

## 2. VPS sizing and provider

**Provider:** WHC (Web Hosting Canada) or Vexxhost — both Québec-based, Canadian-owned, operating
their own datacentres (not AWS resellers). This is what satisfies the "Canadian company" requirement.

**Recommended starting spec:**

| Resource | Spec | Rationale |
|---|---|---|
| vCPU | 4 | Next.js SSR builds + runtime + MongoDB on one host |
| RAM | 8 GB | Node ~2 GB, MongoDB working set, build headroom |
| Disk | 100 GB SSD | DB + uploads + Docker images + logs |
| OS | Ubuntu 24.04 LTS | LTS support window; Coolify's primary target |
| Backups | Provider snapshots **+** independent `mongodump` (§4.2) | Snapshots alone are not enough |

**Node version:** local is **v25.8.2** (not LTS). Pin the server to **Node 22 LTS** — Next 16 requires
≥20.9. Do not run production on an odd-numbered Node release.

**Sizing note:** the DB holds mental-health records and cannot be lost. If budget allows, put MongoDB on a
**second VPS** with a replica, rather than sharing one box with the app. Single-node MongoDB is a
single point of data loss.

---

## 3. Coolify setup

Coolify handles: git-push auto-deploy, Let's Encrypt SSL + auto-renewal, container auto-restart,
scheduled tasks, and DB backups. It does **not** handle OS patching, backup *verification*, or on-call.

1. Install Coolify on the VPS (Docker-based).
2. Connect the GitHub repo; set the production branch.
3. Configure build: `pnpm install --frozen-lockfile && pnpm build`, start `node .next/standalone/server.js`.
4. Add the domain; let Coolify issue the Let's Encrypt certificate.
5. **Mount a persistent volume** at `public/uploads` — without this, §1.1 recurs.
6. Recreate the 5 cron jobs as Coolify scheduled tasks (§3.1).

### 3.1 Cron jobs to recreate (currently in `vercel.json`)

| Schedule (UTC) | Endpoint |
|---|---|
| `0 9 * * *` | `/api/cron/appointment-reminders` |
| `0 10 * * *` | `/api/cron/interac-reminders` |
| `0 11 * * *` | `/api/cron/proposal-timeouts` |
| `0 13 * * *` | `/api/cron/payment-guarantee-reminders` |
| `0 14 * * *` | `/api/cron/unscheduled-match-reminders` |

Each must send the `CRON_SECRET` bearer header, or the route returns 401 silently.

```bash
curl -fsS -X GET https://www.jechemine.ca/api/cron/<name> \
  -H "Authorization: Bearer $CRON_SECRET"
```

> Note: `proposal-timeouts` drives the 24h/12h auto-advance of the matching cascade. If it stops
> firing, service requests stall silently with no error. Verify this one explicitly after cutover.

---

## 4. MongoDB on the VPS

### 4.1 Security (non-negotiable — this holds PHI)

- **Never expose port 27017 to the internet.** Bind to `127.0.0.1` or a private Docker network.
- Authentication enabled; a dedicated app user with least privilege (not root).
- TLS for connections if the DB is on a separate host from the app.
- Full-disk encryption on the VPS volume.
- Host firewall: allow only 22 (key-only SSH), 80, 443.

### 4.2 Backups

Coolify can schedule DB backups, but **an untested backup is not a backup.**

- Nightly `mongodump`, encrypted at rest, retained ≥30 days.
- Backups stored **in Canada** (a second Canadian location — not the same VPS).
- **A restore must be tested on a schedule**, not assumed. Put a recurring calendar reminder on it.

---

## 5. Code changes required

### 5.1 Add standalone output

```ts
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",   // ← add: required for a lean self-hosted deploy
  reactCompiler: true,
  // ...
};
```

### 5.2 Review the CSP comment

`next.config.ts` documents TLS as host-terminated ("e.g. Vercel"). Update that comment once the
reverse proxy owns TLS, so the next reader is not misled.

### 5.3 Delete `vercel.json` crons only *after* Coolify tasks are verified firing

Keep them until the replacement is proven, so a rollback to Vercel still has working crons.

### 5.4 (Recommended, post-cutover) Turn ON field encryption — carefully

Encryption is currently disabled (§0.1). Enabling it closes a real Loi 25 gap, but it is **not** a
simple flag flip. Do it as a distinct step **after** the lift-and-shift is stable — not during cutover.

**Steps:**

1. Generate a 32-byte key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Set `FIELD_ENCRYPTION_KEY` on the VPS. New writes now encrypt (values gain the `v1.` prefix).
3. **Backfill existing rows.** Old plaintext values are NOT retroactively encrypted — `decrypt` passes
   non-`v1.` values through untouched. A one-time script must read + re-save each encrypted field
   (phones, locations, `payment.*` method refs) so existing data gets the `v1.` envelope.
4. **Store the key forever.** Once data is encrypted, losing the key = the catastrophe that §0.1
   previously (wrongly) warned about. Team password manager + a sealed backup.

**⚠️ Gotcha — the phone dedup hash secret changes.** `src/lib/contact-keys.ts` computes
`phoneLookupHash` with `FIELD_ENCRYPTION_KEY || NEXTAUTH_SECRET || "jechemine-phone-dedup"`. Today,
with no key, it HMACs using `NEXTAUTH_SECRET`. The moment `FIELD_ENCRYPTION_KEY` is introduced, the
HMAC secret changes, so **every stored `phoneLookupHash` goes stale** and phone de-duplication silently
stops matching. Handle one of two ways:
  - **(a)** Pin the HMAC secret explicitly to `NEXTAUTH_SECRET` in `contact-keys.ts` (decouple it from
    the encryption key), **or**
  - **(b)** Recompute + backfill every `phoneLookupHash` in the same migration script as step 3.

Add a regression test either way (money/auth/routing-adjacent → per AGENTS.md §6).

---

## 6. Complete environment variable inventory

Derived from `grep process.env` across `src/` and `scripts/`.

### 6.1 ⚠️ Only in Vercel — must be retrieved before cutover

These are referenced in code but present in **neither** `.env` nor `.env.local`:

| Variable | Risk if lost |
|---|---|
| ~~`FIELD_ENCRYPTION_KEY`~~ | **Not set anywhere** — encryption is currently OFF (§0.1). Nothing to retrieve. To enable, see §5.4 |
| `CRON_SECRET` | All 5 crons return 401; reminders and cascade timeouts stop silently |
| `ADMIN_ALERT_EMAIL` | Admin alerts misrouted |
| `INTERAC_DEPOSIT_EMAIL` | Interac payment instructions break |
| `CLOUDMERSIVE_API_KEY` | Upload antivirus scanning silently degrades to "skipped" |
| `CLOUDMERSIVE_BASE_URL` | as above |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Analytics only |

### 6.2 Values that CHANGE at cutover

| Variable | New value |
|---|---|
| `MONGODB_URI` | Points at the VPS MongoDB (private network / localhost) |
| `NEXTAUTH_URL` | `https://www.jechemine.ca` — must match exactly or auth breaks |
| `NEXT_PUBLIC_APP_URL` | as above |
| `STRIPE_WEBHOOK_SECRET` | **New** — a new endpoint = a new signing secret (§7.2) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | WHC mail settings, if email moves too |
| `MAIL_FROM` | **Must equal `SMTP_USER`** or the provider rejects/rewrites the sender |

### 6.3 Carried over unchanged

`NEXTAUTH_SECRET` (changing it invalidates all active sessions), `STRIPE_SECRET_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_NUMBER`, `SUPPORT_EMAIL`, `MAIL_FROM_NAME`, `PLATFORM_FEE_PERCENTAGE`,
`DEFAULT_CURRENCY`, `SMS_DRY_RUN` (must be unset/false in prod), `NODE_ENV=production`.

### 6.4 Cleanup candidate

`STRIPE_CONNECT_CLIENT_ID` is defined in `.env` but not referenced anywhere in `src/`. Confirm it is
dead before dropping it.

---

## 7. Cutover runbook

Run staging to completion **before** scheduling the production cutover.

### Phase A — Staging (production untouched)

1. Provision VPS, install Coolify, harden the host (§4.1).
2. Deploy the app to a staging subdomain with a **restored copy** of production data.
3. Verify decryption works with the retrieved `FIELD_ENCRYPTION_KEY` — **hard gate**.
4. Run `pnpm test` and `pnpm build` on the server.
5. Walk the critical user journeys: booking funnel, jumelage, payment (Stripe test mode), messaging.
6. Confirm all 5 cron endpoints return 200 with the bearer header.
7. Confirm an upload persists across a redeploy (proves the volume mount).

### Phase B — Production cutover (low-traffic window)

App and database move **together** — never split them across the Atlantic.

1. Announce a maintenance window.
2. Put the Vercel app into maintenance/read-only mode.
3. **Final `mongodump`** from Atlas Paris.
4. Restore into the VPS MongoDB; verify document counts per collection match.
5. Copy `public/uploads` contents (see §1.1 — may be empty).
6. Set all production env vars in Coolify (§6).
7. Deploy; smoke-test on the VPS IP/staging host before touching DNS.
8. **Lower the DNS TTL 24h in advance**, then repoint `www.jechemine.ca` at the VPS.
9. Update the **Stripe webhook endpoint** to the new URL and set the new `STRIPE_WEBHOOK_SECRET`.
   Confirm subscribed events include `setup_intent.succeeded`, `charge.dispute.created`,
   `charge.refund.updated`.
10. Verify Coolify scheduled tasks are firing.

### 7.2 Stripe webhook — do not skip

A new endpoint URL means a **new signing secret**. If `STRIPE_WEBHOOK_SECRET` is not updated, every
webhook fails signature verification and **payments silently stop reconciling**. Test with the Stripe
CLI before declaring the cutover done.

---

## 8. Rollback plan

Rollback is viable **only while the Atlas Paris cluster is still running**. Do not decommission it for
at least 30 days after cutover.

**Triggers:** auth broken, decryption failing, payments not reconciling, sustained 5xx.

1. Repoint DNS back to Vercel (fast — this is why TTL is lowered in advance).
2. Restore `STRIPE_WEBHOOK_SECRET` and the webhook URL to the Vercel endpoint.
3. Vercel still holds its env vars and `vercel.json` crons — hence §5.3.

**The one-way door:** any writes made to the VPS database after cutover do not exist in Atlas. If
rollback happens after real traffic, those writes must be reconciled manually. **Keep the maintenance
window short and verify fast**, so the divergence stays small.

---

## 9. What remains American after this migration

| Service | Data involved | Handling |
|---|---|---|
| **Stripe** | Payment data — no health records | Document as a PIA-covered exception; Interac (Canadian) already supported |
| **Twilio** | Phone numbers for 2FA codes | PIA exception; replaceable later |
| **Cloudmersive** | Uploaded files scanned for malware | ⚠️ Verify the no-retention/DPA terms — uploads may contain PHI |
| **GitHub** | Source code — no client data | Low risk |

Loi 25 permits these with a completed privacy impact assessment (ÉFVP) and a written contract (DPA)
per processor. Residency is not legally required — see the analysis that prompted this migration.

---

## 10. Open items

- [ ] Retrieve and safely store `FIELD_ENCRYPTION_KEY` from Vercel — **blocks everything**
- [ ] Decide: one VPS (app + DB) vs. two (DB isolated with a replica)
- [ ] Audit production `ContentEntry` image URLs for already-lost uploads (§1.1)
- [ ] Confirm whether `public/uploads` has any real production content to migrate
- [ ] Decide whether email moves to WHC in the same window or earlier (it is independent)
- [ ] Confirm Cloudmersive's data-retention terms for PHI-bearing uploads
- [ ] Assign an owner for OS patching and backup-restore verification
