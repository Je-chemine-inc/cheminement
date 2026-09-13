# Je chemine — Operations Handoff

Everything a new machine / Claude Code session needs to keep operating the **Je chemine** production platform after the migration from Vercel + MongoDB Atlas to a **Web Hosting Canada (WHC) VPS** (Loi 25 — data in Canada). Read this end-to-end before touching production.

> **No secrets are in this file (or anywhere in git).** Secret *values* live in `/root/jechemine.env` **on the VPS** and must be transferred out-of-band (see §1). `.env*` is gitignored.

---

## 1. Set up the new machine (do this first)

Git already has everything (`main` is the source of truth). What is **not** in git and must be brought over securely:

1. **SSH private key to the VPS** — file `~/.ssh/whc_jechemine` (ed25519) on the old machine.
   Copy it to the new machine's `~/.ssh/whc_jechemine`, then `chmod 600 ~/.ssh/whc_jechemine`. **Never commit it.**
2. **GitHub auth** — sign in `gh auth login` (or set up a credential helper) so you can push to `main` and read Actions. Repo canonical name: **`ProgixDev/cheminement`** (`DigitariaWebs/cheminement` redirects to it).
3. **(Optional) Claude memory** — the old machine's `.claude/projects/<project>/memory/` holds the running history (esp. `project_whc_canada_migration_jul2026.md`). Copy that folder over if you want the full memory; otherwise this handoff is the portable substitute. **That memory file contains a few secret values — do not commit it.**
4. **Clone**: `git clone https://github.com/ProgixDev/cheminement.git` → `pnpm install`.

Nothing else is needed locally — **all runtime secrets already live on the VPS** in `/root/jechemine.env`.

---

## 2. Access the production VPS

| | |
|---|---|
| Host | `cloud296751.mywhc.ca` — **IP `173.209.43.39`** |
| SSH | `ssh -i ~/.ssh/whc_jechemine -p 2243 root@173.209.43.39` (port **2243**, not 22) |
| WHM/cPanel | `https://173.209.43.39:2087` (WHM), account `jechemin` / primary domain `jechemine.ca`. A WHM API root token exists (value in the old memory file — rotate when convenient). |
| Env file | `/root/jechemine.env` — all runtime secrets, loaded by the app via `--env-file`. `chmod 600`. |

**SSH is flaky under load** — always use long timeouts + keepalives and wrap in a retry loop:
```bash
SSH_OPTS="-i ~/.ssh/whc_jechemine -p 2243 -o ConnectTimeout=40 -o ServerAliveInterval=10 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=accept-new"
ssh $SSH_OPTS root@173.209.43.39 'uptime'
```
The box is an **oversubscribed LXC container** — `uptime` load is the *host-wide* number (often 15–28); the container itself is usually mostly idle. Judge health by `free -h` (memory) and whether the app responds, not by load average.

---

## 3. Infrastructure map

- **OS/host**: AlmaLinux 9, **LXC container** (`lxdnode3`), cPanel/WHM. LXC ⇒ **no swap**, Docker/Coolify won't run. Treat as a managed bridge box.
- **Resources**: 8 GB RAM, **6 cores** (`nproc` confirmed 6 on 2026-08-31 — the paid upgrade *has* now been provisioned; this doc previously said 4 and pending). 100 GB disk (~18 GB used).
- **App runtime**: Next.js 16 **standalone** build. systemd service **`jechemine`**:
  `ExecStart=/usr/bin/node --env-file=/root/jechemine.env /root/app/server.js`, `HOSTNAME=127.0.0.1 PORT=3000`, `WorkingDirectory=/root/app`, `Restart=on-failure`.
- **Web**: **Apache (httpd)** owns 80/443, reverse-proxies the domain → `127.0.0.1:3000` (mod_proxy). AutoSSL/Let's Encrypt certs. Non-standard inbound ports (e.g. 3000) are NOT reachable externally — everything goes through Apache.
- **Apache config lives in cPanel userdata includes, NOT in httpd.conf.** cPanel owns and regenerates `/etc/apache2/conf/httpd.conf`, so edits there are lost. The two files that matter:
  - `/etc/apache2/conf.d/userdata/ssl/2_4/jechemin/jechemine.ca/proxy.conf` — **https**: the actual reverse proxy to `127.0.0.1:3000`.
  - `/etc/apache2/conf.d/userdata/std/2_4/jechemin/jechemine.ca/proxy.conf` — **http**: nothing but a 301 to `https://www.jechemine.ca`.

  After editing either: `/scripts/ensure_vhost_includes --user=jechemin && apachectl configtest && apachectl graceful`. **Always configtest before reloading.**

  ⚠ Two things that will bite whoever touches this next:
  1. **`ProxyPass` is evaluated before `RewriteRule`.** The first attempt at the http→https redirect kept the ProxyPass alongside it and the redirect never fired — the proxy claimed the URL first. Port 80 now has *no* ProxyPass at all; that is deliberate, not an omission.
  2. **`/.well-known` must stay reachable over plain http.** AutoSSL validates there. Redirect it and the certificate silently stops renewing, taking the site down ~60 days later with no warning. The `RewriteCond %{REQUEST_URI} !^/.well-known/` line is load-bearing. Verified after the change by serving a canary file over http on both hostnames.

  Also note the https vhost sets `RequestHeader set X-Forwarded-Proto "https"` — on the **port 80 vhost too**, historically. That means the app can never tell http from https, which is why the http→https redirect has to live here in Apache rather than in `src/middleware.ts`.
- **DB**: **MongoDB 8** on `127.0.0.1:27017` (auth enabled, not exposed). Connect on-box: `mongosh "$(grep -m1 '^MONGODB_URI=' /root/jechemine.env | cut -d= -f2- | tr -d '\"')"`.
- **Data**: migrated once from Atlas (Paris) → this box; the box is now the source of truth. **Vercel is fully gone** — the `cheminement-b77i` project is deleted (owner-confirmed 2026-09-09), the URL 404s, DNS points at this VPS, and the repo carries no Vercel config at all.
- `csf` firewall: required outbound ports opened (25, 443, 465, 587, 993, 27017, …). `imunify360-full` WAF active (see §6).

---

## 4. CI/CD — how deploys work

GitHub Actions workflow **`.github/workflows/deploy-whc.yml`** (repo `ProgixDev/cheminement`). **Push to `main` → auto-deploy.**

Pipeline: checkout → pnpm 10.33.2 + Node 24 → `pnpm install` → **`pnpm test` gate** → **`pnpm build`** (`STANDALONE_BUILD=1` + placeholder server env, since CI has no real `.env`) → assemble the standalone bundle (merges `public/`, bundles **sharp** via an isolated npm install) → **scp + `scripts/whc-activate.sh`** (swaps `/root/app`, restarts `jechemine`, health-checks, rolls back on failure).

- **Green = `pnpm test` passes AND `pnpm build` (strict `tsc`) passes.** No CI runs ESLint or vitest except this workflow, so run `pnpm test` locally.
- **Deploy gotcha**: the deploy step SSHes from GitHub's runner to the box; if the box is overloaded that minute it **times out** (build passes, deploy fails). Re-trigger with an empty commit once the box calms: `git commit --allow-empty -m "chore: re-trigger deploy" && git push`.
- **Git gotcha**: before committing, always confirm `git rev-parse HEAD == origin/main` — a stale local `main` once nearly reverted 59 prod commits.
- **Verify a deploy landed** (GitHub API is sometimes unreachable): check `server.js` mtime on the box — `ssh … 'ls -l /root/app/server.js'` — it updates to the deploy time.

Manual trigger: `gh workflow run deploy-whc.yml -R ProgixDev/cheminement --ref main`.

---

## 5. DNS & Email

- **DNS**: managed at **Namecheap** (nameservers `dns1/dns2.registrar-servers.com`). `@`, `www`, `staging` A-records → `173.209.43.39`. No wildcard record yet: the showcase city hosts (`psy<city>.jechemine.ca`, spec 003) need one, added only **after** the wildcard certificate and vhost exist — see §11.
- **Mail server**: WHC **Business Email** (separate box, `mailpro5.whc.ca` = `173.209.51.234`, Canada). IMAP 993 / SMTP 465. Mailboxes: **`support@jechemine.ca`** (general) and **`paiement@jechemine.ca`** (payments). The app sends outbound via `mailpro5.whc.ca:465` as `support@jechemine.ca` (`SMTP_*`/`MAIL_FROM` in env). PrivateEmail dropped.
- **Auth records** (Namecheap → Advanced DNS): MX `@`→`mailpro5.whc.ca`; SPF `v=spf1 +a +ip4:173.209.51.234 +include:spf.web-dns1.com ~all`; DKIM `default._domainkey` (2048-bit, from cPanel → Email Deliverability); DMARC `p=none rua=mailto:support@jechemine.ca`. All verified valid; IP clean on major blocklists.
- **Interac deposit email** = `paiement@jechemine.ca` (`PlatformSettings.interacDepositEmail`; env `INTERAC_DEPOSIT_EMAIL` unset ⇒ DB wins). Payment-category emails set Reply-To to it.
- **Admin-alert email** = `PlatformSettings.adminAlertEmail` = `support@jechemine.ca` (so alerts don't bounce to the placeholder `admin@admin.com`).
- **Inbound → platform**: `scripts/inbound-email-sync.mjs` (on-box, isolated `imapflow`+`mailparser` in `/root/jechemine/mail-sync/`) pulls support@ + paiement@ every 5 min into the admin **Courriels externes → Réception** panel (`POST /api/cron/inbound-email`, dedupe by Message-Id, mailbox tag, filters bounces/DMARC/cPanel noise). Mailboxes to sync are in `INBOUND_MAILBOXES` (JSON) in the env.

---

## 6. Security — Imunify360 (⚠️ read before any WAF change)

Imunify360 is **re-enabled** (was masked earlier during a load storm; re-registered via `bash /var/imunify360/i360deploy.sh -k IPL -y`). Real-time protection (WAF/webshield, wafd, realtime-av) is active; box self-caps CPU/RAM so no storm.

**🚨 CRITICAL GOTCHA — the WAF blocks PATCH/PUT/DELETE by default**, which breaks every save/update/delete in the app (they 404 before reaching Next.js). This was fixed by disabling two modsec rules:
```bash
imunify360-agent rules disable --id 77350476 --plugin modsec --name "Allow REST methods"   # Imunify webshield
imunify360-agent rules disable --id 911100  --plugin modsec --name "Allow REST methods"    # OWASP CRS 'method not allowed'
imunify360-agent rules update-shared-disabled-rules
/usr/local/cpanel/scripts/restartsrv_httpd --graceful
```
**If Imunify is ever reinstalled/re-enabled, re-check** with `curl -X PATCH https://www.jechemine.ca/api/users/me` (expect 401, NOT 404) and re-apply if needed. Do **not** re-mask Imunify (managed plan re-enables it anyway). App-level upload AV is Cloudmersive (separate, still on).

---

## 7. Cron jobs & the app watchdog

`/etc/cron.d/jechemine` (all times UTC; secret read from env via `/root/jechemine/run-cron.sh`):

| Schedule | Job |
|---|---|
| `0 * * * *` | appointment-reminders (**hourly** so 72h/48h fire within ~1h of the mark — was daily, caused the "décalage") |
| `10 * * * *` | interac-reminders |
| `20 * * * *` | proposal-timeouts |
| `30 * * * *` | payment-guarantee-reminders |
| `40 * * * *` | unscheduled-match-reminders |
| `50 * * * *` | **organization-billing** (spec 002) — drafts organization statements/invoices, the team review email, overdue marking. Does nothing while the switch in Admin → Organismes payeurs is off. Line: `50 * * * * root /root/jechemine/run-cron.sh organization-billing` |
| `*/2 * * * *` | **waitlist-offers** (spec 003 phase 4) — expires direct requests past their deadline and waitlist offers past their 15 minutes, ends places after three misses or 90 days, purges old closed entries, and offers freed times while the showcase switch is on. Must run every two minutes: an offer lasts 15. **Installed 2026-09-13** (backup `/root/jechemine/cron-backups/jechemine.20260913T142044Z`) with a guard, because the route was not deployed yet: `*/2 * * * * root [ -d /root/app/.next/server/app/api/cron/waitlist-offers ] && /root/jechemine/run-cron.sh waitlist-offers` — it skips silently until the deploy that brings `api/cron/waitlist-offers`, then runs by itself. |
| `*/10 * * * *` | **products** (spec 003 phase 5) — reminds webinar buyers the day before and an hour before (each reminder is claimed on its purchase, so a rerun never sends it twice), and takes a product off sale — or puts it back — when its stored status disagrees with its professional's account. Runs every ten minutes so the hour-before reminder leaves 50 to 60 minutes ahead. **Installed 2026-09-13** (backup `/root/jechemine/cron-backups/jechemine.20260913T141736Z`) with a guard, because the route was not deployed yet: `*/10 * * * * root [ -d /root/app/.next/server/app/api/cron/products ] && /root/jechemine/run-cron.sh products` — it skips silently until the deploy that brings `api/cron/products`, then runs by itself. Once deployed, the guard can stay or be dropped. |
| `15 13 * * *` | **wildcard certificate check** (spec 003, added 2026-09-13) — `/root/jechemine/check-wildcard-cert.sh` reads the certificate a browser gets for a city host (`psy-verification.jechemine.ca` on 173.209.43.39) and emails `support@jechemine.ca` from `noreply@jechemine.ca` (the SPF `+a` covers this box) only if it has fewer than 14 days left, is not the Let's Encrypt `*.jechemine.ca` one, or cannot be read. acme.sh renews ~30 days early, so an email means renewal failed (§11). Log: `/var/log/jechemine-cert-check.log`. `check-wildcard-cert.sh --test` sends a test email (delivered to mailpro5.whc.ca on 2026-09-13). Line: `15 13 * * * root /root/jechemine/check-wildcard-cert.sh >> /var/log/jechemine-cert-check.log 2>&1` |
| `7,22,37,52 * * * *` | interac-reconciliation (settles exact Interac matches — see debt-map 2026-09-04) |
| `*/5 * * * *` | inbound-email-sync (support@ + paiement@ → Réception) |
| `*/3 * * * *` | **app watchdog** — `/root/jechemine/healthcheck.sh` restarts `jechemine` if it stops responding |
| `15 7 * * *` | **MongoDB backup** — `/root/jechemine/backup-mongo.sh` (see below) |

⚠️ **Never leave a backup copy of a cron file inside `/etc/cron.d/`.** On 2026-09-09 that directory
held `jechemine`, `jechemine.bak.1785763065` and `jechemine.bak.1788531196`, and **cron executed all
three** — every reminder job fired **twice**, three times between 09:00–14:00 UTC where the older
backup's daily schedule overlapped, and the watchdog and inbound-mail sync ran 3× as well. The
active file's own header warns about exactly this ("so they do NOT double-run and double-email
clients") — the `.bak` copies quietly defeated it. Nothing in `/var/log/cron` flags a duplicate; you
only see it by counting executions per minute (every count must be **1**):

```bash
grep "CMD (/root/jechemine/run-cron.sh" /var/log/cron | tail -200 \
  | awk '{print $1, $2, $3, $NF}' | sort | uniq -c | sort -rn | head
```

Backups now live in `/root/jechemine/cron-backups/` — outside anything cron reads. Do **not** rely on
a dot in the filename to disable a job: cron on this box runs it regardless of the extension.

**Database backups** (added 2026-08-31 — there were none before): `/root/jechemine/backup-mongo.sh`
writes one gzipped archive per night to `/root/backups/mongo/`, validates it by parsing it back with
`mongorestore --dryRun` (an unvalidated dump is not a backup), then prunes to the newest **30**.
Logs one line per run to `/var/log/jechemine-backup.log`. Archives are ~12 MB each (~360 MB at full
retention, against 78 GB free). Directory is `0700`, archives `0600` — **they contain client PHI**.

**Off-site staging** (added 2026-09-06): after `--dryRun` validation the archive is copied to
`/home/jechemin/db-backups/` (`0700`, files `0600`, owned by the `jechemin` cPanel account) so the
WHC **external backup** (JetBackup → S3, stored in Canada) carries it off the machine. Placed
*beside* `public_html`, never inside it — Apache's DocumentRoot is `/home/jechemin/public_html`,
so the directory is not reachable over the web (verified: the URL returns the app's 404 page, not
the archive). A staging failure is logged as `OFFSITE FAILED` but does **not** fail the run — the
local archive is already valid and must not be discarded.

⚠ **The JetBackup job itself still has to be created in the WHC client area** (Sauvegardes
externes → JetBackup). As of 2026-09-06 the destination *works* (the daemon refreshes its disk
usage every cycle) but **no job has ever run** — the panel shows 0 MB used and
`Dernière sauvegarde : 1969-12-31`, i.e. never. Two empty job folders exist from 23 July. Until an
**account-level** job for `jechemin` is enabled and scheduled, the staged archives go nowhere.

⚠ **cPanel's account backups do NOT cover MongoDB.** They back up the cPanel account; the dataset
lives under `/var/lib/mongo` as root. This script is the only database backup.

⚠ **Two known gaps** — see §9:
1. **Off-site is staged but not yet shipped.** Each validated archive is copied into the cPanel
   account (above), which is where an account-level JetBackup job would pick it up — but that job
   does not exist yet, so today the only copies still sit on the box they protect.
2. **No full restore rehearsal has been done.** The app's Mongo user is scoped to the `jechemine`
   database, so restoring into a scratch copy fails with `not authorized`. `--dryRun` proves the
   archive is complete and parseable, which is not the same as proving a restore.

**Why the watchdog exists**: the Node app can **hang** (100% CPU, still "active" so systemd's `Restart=on-failure` won't fire) → site down. The watchdog curls `:3000` (3×20s) and restarts on failure; logs to `/var/log/jechemine-watchdog.log`. Cron auth uses `CRON_SECRET` (env) — if reminders/crons return `{"error":"Unauthorized"}`, the secret is empty/mismatched in `/root/jechemine.env`.

---

## 8. Operational gotchas / lessons (don't relearn these)

- **WAF blocks PATCH/PUT/DELETE** → all writes fail (§6). #1 cause of "can't save anything".
- **App hangs at 100% CPU** occasionally → the §7 watchdog self-heals in <4 min.
- **`toE164` (SMS)**: bare 10-digit Québec numbers get `+1` prefixed (`4385806289`→`+14385806289`); otherwise Twilio rejects with 21211 and 2FA fails. Twilio Geo Permissions must include the destination country (Algeria was 21408 until enabled).
- **Admin editing a pro** must NOT be gated by the pro's terms-consent modal — gated on `!userId` (self-view only) via `professionalTermsGateApplies`.
- **`FIELD_ENCRYPTION_KEY` is UNSET** → contact fields (phone/location) stored plaintext. Enabling needs a backfill + a `phoneLookupHash` coupling fix in `src/lib/contact-keys.ts` (Loi 25 gap).
- **`admin@admin.com` / `admin123`** is a live super-admin (documented in `docs/quality/debt-map.md`) — weak creds + `admin@admin.com` doesn't receive mail.
- **Email deliverability**: SPF/DKIM/DMARC all pass; welcome-type emails may land in Gmail **Promotions/Updates** (not Primary) — looks like "never arrives". Verify with a live send + check all tabs.
- **cPanel gotcha**: a domain can't be "parked" onto the account primary — had to `modifyacct` to make `jechemine.ca` primary.
- Dates: always write appointment dates via `parseAppointmentDate` (UTC-noon) and read start via `getAppointmentStartAt` (handles America/Toronto DST).

---

## 9. Pending / open items

- ~~**6-core CPU upgrade**~~ — **done**, `nproc` reports 6 (verified 2026-08-31). Close the WHC ticket if still open.
- **Backups are staged for off-site but not yet leaving the box** — `/root/backups/mongo/` lives on the VPS, and cPanel's account backups do not cover `/var/lib/mongo` or `/root`. Since 2026-09-06 each validated archive is also copied to `/home/jechemin/db-backups/` so a JetBackup **account** job can carry it to the WHC S3 destination (confirmed stored in Canada, so Loi 25 is satisfied for the PHI in the archives). **What remains is one click in the WHC client area**: create + schedule a daily account backup job for `jechemin`. The purchased 50 GB is untouched (0 MB used) and ~360 MB/month is needed, so quota is a non-issue. Note the installed edition is **JetBackup Base**, which is account-oriented — pointing a job directly at `/root/backups/mongo` would need a tier that offers directory jobs, which is why the archives are staged inside the account instead. **Highest-value open ops item until that job runs.**
- **No full restore rehearsal** — the app's Mongo user is scoped to the `jechemine` database, so restoring an archive into a scratch database fails `not authorized`. `--dryRun` validates the archive parses completely, which is weaker than a real restore. Needs a Mongo admin credential (or a throwaway mongod on another port) to rehearse properly. Do this before relying on the backup in anger.
- **Bank debit (DPA) for organizations — before its switch is turned on** (Admin → Organismes payeurs; off, and organization billing itself is off): (1) the LIVE Stripe webhook must also receive `payment_intent.processing`: copy the repo's `scripts/add-stripe-webhook-events.ts` over `/root/jechemine/scripts/` (the copy there is older and lists only 3 events), then run it on the box with the LIVE key read in place — `cd /root/jechemine && STRIPE_SECRET_KEY="$(grep -m1 '^STRIPE_SECRET_KEY=' /root/jechemine.env | cut -d= -f2- | tr -d '"')" npx tsx scripts/add-stripe-webhook-events.ts` (idempotent: it only adds events, never removes; it prints endpoint ids and event names, never the key); (2) in the Stripe dashboard, check that pre-authorized debits (ACSS) are active and PAD customer emails are on; (3) pilot on one small invoice from a business account. Why and what to watch: debt-map, 2026-09-12 bank-debit entry.
- **Showcase city hosts (spec 003)** — once the code is deployed (it is dark: `showcaseEnabled` off), no city host resolves until the owner picks a DNS API (Cloudflare DNS-only recommended, or the Namecheap API), then the wildcard certificate and vhost are installed and only then the `*` record added — in that order (§11). Before turning the switch on: a Search Console **Domain** property.
- **Email deliverability** — confirm whether welcome emails land in Gmail Promotions vs Primary (last live test sent; awaiting which-tab confirmation); improve Primary placement if needed.
- **Admin-alert PHI** — a few admin-alert emails put client name + motif in the body/subject; strip to a deep-link (Loi 25).
- **Field encryption** — enable `FIELD_ENCRYPTION_KEY` + backfill (§8).
- **Decommission**: **Vercel is done** — project deleted, repo config removed, MCP entry dropped (2026-09-09). Confirm **Atlas** is likewise torn down. ⚠️ `FIELD_ENCRYPTION_KEY` is **not** a rotatable secret: `User.phone` and `User.location` are encrypted with it, so changing it without a decrypt-then-re-encrypt migration makes every existing row unreadable. Treat it as key *material*, not a credential. The outstanding Stripe `sk_live` rotation is tracked in the debt map.

---

## 10. Quick command reference

```bash
# --- reach the box ---
SSH_OPTS="-i ~/.ssh/whc_jechemine -p 2243 -o ConnectTimeout=40 -o ServerAliveInterval=10 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=accept-new"
ssh $SSH_OPTS root@173.209.43.39

# --- health ---
systemctl status jechemine ; free -h ; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
journalctl -u jechemine --since "1 hour ago" | grep -iE "error|Email sent"

# --- restart the app (fixes a hang) ---
systemctl restart jechemine

# --- mongo shell ---
mongosh "$(grep -m1 '^MONGODB_URI=' /root/jechemine.env | cut -d= -f2- | tr -d '\"')"

# --- deploy (from the dev machine) ---
git push origin main           # auto-deploys; or re-trigger:
git commit --allow-empty -m "chore: re-trigger deploy" && git push origin main
gh run watch $(gh run list -R ProgixDev/cheminement --limit 1 --json databaseId --jq '.[0].databaseId') -R ProgixDev/cheminement

# --- local gates before pushing ---
pnpm test && pnpm exec tsc --noEmit

# --- external site check ---
curl -s -o /dev/null -w '%{http_code}\n' https://www.jechemine.ca
```

---

## 11. Showcase city hosts — wildcard DNS, certificate and vhost (spec 003)

The showcase pages live on one host per Quebec city (`psymascouche.jechemine.ca/sassi`), served by the same app: `src/middleware.ts` rewrites a city host to `src/app/showcase/[cityKey]/…` (rules in `src/lib/showcase-hosts.ts`; why: [ADR-0003](../architecture/decisions/0003-per-city-showcase-hosts.md)). The code is inert until this section is done, and the pages stay dark until an admin turns `showcaseEnabled` on. **Adding a city later is a code change only** (`src/data/canadaCities.ts`) — nothing on the server.

**State on 2026-09-12, checked from outside:** no wildcard record (`psyzz9test.jechemine.ca` → NXDOMAIN); nameservers are Namecheap BasicDNS; `jechemine.ca` is **not** on the HSTS preload list (hstspreload.org: status `unknown`, not preloadable because plain-http apex redirects to www first). But `https://jechemine.ca` already answers with `Strict-Transport-Security: …; includeSubDomains`, so every browser that once opened it refuses any subdomain without a valid certificate. **Hence the order below: certificate and vhost first, DNS record last.**

**Why a wildcard certificate:** AutoSSL issues one certificate per hostname, validated over http. ~110 city hosts would mean ~110 certificates (Let's Encrypt allows 50 new ones per registered domain per week) and a server step per city. One `*.jechemine.ca` certificate covers every city, today's and future ones. Let's Encrypt issues wildcards only through a **DNS-01** challenge, so the DNS provider needs an API — **the owner's choice:**

| Option | What it takes | Notes |
|---|---|---|
| **A. Cloudflare DNS, DNS-only (recommended)** | Free account; import the zone and **compare every record** with the snapshot (MX, SPF, DKIM, DMARC, Stripe's domain records), all grey-cloud (DNS only — no proxy, no CDN); switch the nameservers at Namecheap; an API token limited to `Zone.DNS:Edit` on this zone | acme.sh `dns_cf`. The domain stays registered at Namecheap |
| B. Namecheap API | API access requires 20+ domains in the account, **or** a $50 balance, **or** $50 spent in the last 2 years; allow-list `173.209.43.39` | acme.sh `dns_namecheap`. No nameserver change, but its API rewrites the **whole** record list on each update — diff the zone against the snapshot after the first issuance |
| C. DNS hosted on this server | Nameservers pointed at the VPS's cPanel DNS | AutoSSL then issues the wildcard itself. But the site's and mail's DNS would depend on this oversubscribed box — not recommended |
| Pilot only | One cPanel subdomain + AutoSSL per city | 50 certificates a week, a server step per city |

**Done on 2026-09-13 with option A (steps 1–6; step 7 below states whether the `*` record exists).** What differed from the plan, and is now written into the steps: cPanel reads the wildcard vhost's includes from `wildcard_safe.jechemine.ca`, not `_wildcard_.jechemine.ca`; `uapi` on the command line needs URI-encoded PEM values; cPanel first puts a self-signed `*.jechemine.ca` certificate on the new SSL vhost; and `staging` has no vhost of its own, so the wildcard vhost captured it — 403 for the few minutes between steps 3 and 6, then served as before, now with a valid certificate. Backups: `/root/jechemine/apache-backups/wildcard-20260913T174056Z/` (httpd.conf, userdata includes, cPanel userdata, `apachectl -S`); DNS snapshot `/root/jechemine/dns-snapshot-2026-09-13.txt`. Cloudflare token (DNS edit on this zone only, client IP 173.209.43.39 only): `/root/jechemine/cloudflare-dns.env` (root, 600).

**Sequence (A or B). No step touches www; staging moves onto the wildcard vhost at step 3:**

1. **Pre-flight, read-only, on the box:** `apachectl -S` (note the vhost order); `grep -n ProxyPreserveHost /etc/apache2/conf.d/userdata/ssl/2_4/jechemin/jechemine.ca/proxy.conf` — the app routes on the Host header, so it must be `On`; `uapi --user=jechemin SSL installed_hosts`; save the zone (`dig +noall +answer` for `@`/`www`/`staging` A, MX, TXT, `_dmarc`, `default._domainkey` and Stripe's records) to `/root/jechemine/dns-snapshot-<date>.txt`.
2. **DNS API.** A: create the Cloudflare zone, compare it with the snapshot, switch the nameservers, wait until `dig NS jechemine.ca` answers Cloudflare. B: enable API access and allow-list the IP. **Do not add the `*` record yet.**
3. **Wildcard vhost:** `uapi --user=jechemin SubDomain addsubdomain domain='*' rootdomain=jechemine.ca dir=public_html/_wildcard_` (or cPanel → Domains → create `*.jechemine.ca` without sharing the document root). cPanel names the vhost `_wildcard_.jechemine.ca` (ServerAlias `*.jechemine.ca`) but reads its includes from **`wildcard_safe.jechemine.ca`** — the commented `Include` lines of that vhost in `/etc/apache2/conf/httpd.conf` show the path. It also puts a self-signed `*.jechemine.ca` certificate on the new SSL vhost until step 5. Keep AutoSSL away from it: `uapi --user=jechemin SSL add_autossl_excluded_domains domains='*.jechemine.ca'`. `apachectl -S` must still list the `jechemine.ca` vhost (aliases `www`, `mail`, `webmail`…) **before** `_wildcard_.jechemine.ca` on ports 80 and 443. `staging` has no vhost, so from here it is served by the wildcard vhost (403 until step 6).
4. **Certificate, as root:** `curl https://get.acme.sh | sh -s email=support@jechemine.ca`, then `acme.sh --set-default-ca --server letsencrypt`. Issue against the **staging CA first** — Let's Encrypt allows 5 duplicate certificates a week, never loop `--force`:
   - A: `CF_Token=… CF_Zone_ID=… acme.sh --issue --dns dns_cf -d '*.jechemine.ca' --keylength 2048 --staging`
   - B: `NAMECHEAP_USERNAME=… NAMECHEAP_API_KEY=… NAMECHEAP_SOURCEIP=173.209.43.39 acme.sh --issue --dns dns_namecheap -d '*.jechemine.ca' --keylength 2048 --staging`

   Then the same command once more without `--staging`, with `--force` that one time to replace the test certificate.
5. **Install, with a renewal hook:** `acme.sh --install-cert -d '*.jechemine.ca' --key-file /root/jechemine/certs/wildcard.key --fullchain-file /root/jechemine/certs/wildcard.fullchain.pem --cert-file /root/jechemine/certs/wildcard.cert.pem --ca-file /root/jechemine/certs/wildcard.ca.pem --reloadcmd /root/jechemine/install-wildcard-cert.sh`. The script (`/root/jechemine/install-wildcard-cert.sh`, `chmod 700`) calls `uapi --user=jechemin SSL install_ssl domain='*.jechemine.ca' cert=… key=… cabundle=…` with each PEM file **URI-encoded** (`python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(open(sys.argv[1]).read(), safe=""))' <file>`): uapi decodes its command-line arguments, so raw PEM text loses its `+` characters and cPanel answers « Invalid base64 ». acme.sh re-runs it at every renewal from its own line in root's crontab (`26 2,8,14,20 * * *`, not `/etc/cron.d`, so §7's duplicate trap does not apply); the Cloudflare token and zone id are saved in `/root/.acme.sh/*.jechemine.ca/*.jechemine.ca.conf`. Issued 2026-09-13, expires 2026-12-12, renewal planned around 2026-11-12.
6. **Proxy includes** — the www ones, in **`wildcard_safe.jechemine.ca`** (a `_wildcard_.jechemine.ca` folder is never read):
   - `/etc/apache2/conf.d/userdata/ssl/2_4/jechemin/wildcard_safe.jechemine.ca/proxy.conf`: the same lines as `…/jechemine.ca/proxy.conf` (`ProxyPreserveHost On`, `RequestHeader set X-Forwarded-Proto "https"`, `ProxyPass`/`ProxyPassReverse` to `http://127.0.0.1:3000/`).
   - `/etc/apache2/conf.d/userdata/std/2_4/jechemin/wildcard_safe.jechemine.ca/proxy.conf`: **no ProxyPass** (§3) — `RewriteEngine On`, `RewriteCond %{REQUEST_URI} !^/\.well-known/`, `RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]` (to the same host, not to www).
   - `/scripts/ensure_vhost_includes --user=jechemin && apachectl configtest && apachectl graceful`, then check that the two `Include "…/wildcard_safe.jechemine.ca/*.conf"` lines of the wildcard vhost are no longer commented out in `/etc/apache2/conf/httpd.conf`.
7. **Only now the DNS record:** `*` A → `173.209.43.39` (Cloudflare: DNS only). Existing names (`www`, `staging`, mail, Stripe) keep their own records; a wildcard never overrides a name that exists. **Added 2026-09-13** through Cloudflare's API from the box (token in `/root/jechemine/cloudflare-dns.env`). Until the showcase branches are deployed, the app on `main` serves its home page on any such host, its canonical pointing at `https://www.jechemine.ca`.
8. **Verify from outside the box.** If the certificate seen from outside differs from `openssl s_client -connect 127.0.0.1:443 -servername psymascouche.jechemine.ca` on the box, look at Imunify360's WebShield (`systemctl restart imunify360-webshield`).
   ```bash
   openssl s_client -connect 173.209.43.39:443 -servername psymascouche.jechemine.ca </dev/null 2>/dev/null | openssl x509 -noout -subject -dates  # CN = *.jechemine.ca
   curl -sI https://psymascouche.jechemine.ca/             # 307 → https://www.jechemine.ca while the switch is off
   curl -sI http://psymascouche.jechemine.ca/              # 301 → https://psymascouche.jechemine.ca/
   curl -s  https://psymascouche.jechemine.ca/robots.txt   # "Disallow: /" while off
   curl -sI https://psyatlantis.jechemine.ca/              # 307 → https://www.jechemine.ca/psy
   curl -sI https://www.jechemine.ca/showcase/mascouche    # 308 → https://psymascouche.jechemine.ca/
   curl -sI https://www.jechemine.ca/ ; curl -sI https://staging.jechemine.ca/  # unchanged
   ```
   Renewal drill, once: `acme.sh --renew -d '*.jechemine.ca' --force`, then `installed_hosts` shows the new dates. (Not run yet: it would use one of Let's Encrypt's 5 duplicate certificates a week; the install hook itself was run by hand and works.) Expiry alert: done 2026-09-13 — `/root/jechemine/check-wildcard-cert.sh`, daily from `/etc/cron.d/jechemine` (§7), emails `support@jechemine.ca` if fewer than 14 days are left.
9. **Search Console:** add a **Domain property** for `jechemine.ca` (DNS TXT record); it covers every city host. Once the switch is on, each city's robots.txt names its own sitemap.

**Rollback** (www and staging untouched): remove the `*` record; delete the two include files → `ensure_vhost_includes` → `configtest` → `graceful`; `uapi --user=jechemin SubDomain delsubdomain domain=_wildcard_.jechemine.ca`; `acme.sh --remove -d '*.jechemine.ca'`.

**To expect afterwards (checked 2026-09-13):** any other name (typos, `whm.`, `psy<anything>.`) reaches the app through the wildcard vhost — on `main` it shows the home page with its canonical on www; once spec 003 is deployed, unknown names 307 to www. `mail.`, `webmail.`, `cpanel.`, `webdisk.`, `autodiscover.`, `cpcalendars.` and `cpcontacts.` now resolve too, but they are aliases of the main `jechemine.ca` vhost, whose certificate covers only the apex and `www`: a browser shows a certificate error there. Mail clients use `mailpro5.whc.ca`, so nothing depends on them; reach WHM/cPanel by the server's address as today. Cookies are per host: signing in or accepting cookies on www does not carry over to a city host.

---

*Keep this file current: when you fix or discover something durable, add it here in the same PR (mirrors the memory-file discipline). This is the primary knowledge bridge between machines.*
