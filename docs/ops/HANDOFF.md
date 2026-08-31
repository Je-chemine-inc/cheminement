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
- **Resources**: 8 GB RAM (upgrade applied), **4 cores** (the 6-core half of the paid upgrade is still NOT provisioned — WHC ticket pending). 100 GB disk.
- **App runtime**: Next.js 16 **standalone** build. systemd service **`jechemine`**:
  `ExecStart=/usr/bin/node --env-file=/root/jechemine.env /root/app/server.js`, `HOSTNAME=127.0.0.1 PORT=3000`, `WorkingDirectory=/root/app`, `Restart=on-failure`.
- **Web**: **Apache (httpd)** owns 80/443, reverse-proxies the domain → `127.0.0.1:3000` (mod_proxy). AutoSSL/Let's Encrypt certs. Non-standard inbound ports (e.g. 3000) are NOT reachable externally — everything goes through Apache.
- **DB**: **MongoDB 8** on `127.0.0.1:27017` (auth enabled, not exposed). Connect on-box: `mongosh "$(grep -m1 '^MONGODB_URI=' /root/jechemine.env | cut -d= -f2- | tr -d '\"')"`.
- **Data**: migrated once from Atlas (Paris) → this box; the box is now the source of truth. Vercel + Atlas can be decommissioned after a rollback window.
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

- **DNS**: managed at **Namecheap** (nameservers `dns1/dns2.registrar-servers.com`). `@`, `www`, `staging` A-records → `173.209.43.39`.
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
| `*/5 * * * *` | inbound-email-sync (support@ + paiement@ → Réception) |
| `*/3 * * * *` | **app watchdog** — `/root/jechemine/healthcheck.sh` restarts `jechemine` if it stops responding |

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

- **6-core CPU upgrade** — paid but not provisioned (still 4 cores). WHC support ticket.
- **Email deliverability** — confirm whether welcome emails land in Gmail Promotions vs Primary (last live test sent; awaiting which-tab confirmation); improve Primary placement if needed.
- **Admin-alert PHI** — a few admin-alert emails put client name + motif in the body/subject; strip to a deep-link (Loi 25).
- **Field encryption** — enable `FIELD_ENCRYPTION_KEY` + backfill (§8).
- **Decommission** Vercel + Atlas after the rollback window.

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

*Keep this file current: when you fix or discover something durable, add it here in the same PR (mirrors the memory-file discipline). This is the primary knowledge bridge between machines.*
