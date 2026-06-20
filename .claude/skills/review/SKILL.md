---
name: review
description: Review the current diff against the project's rules, conventions, and debt map before merging. Use when the user says "review this", "review my changes", "look over the diff", or "is this ready to merge".
argument-hint: (optional) base ref, e.g. main
---

# Review the current diff

Review what changed against the harness rules. Output findings ranked **P1 / P2 / P3**, with file:line and a concrete fix.

## Steps

1. **Get the diff.** `git status` and `git diff` (vs `main` or the given base). Read each changed file's surrounding context, not just the hunks.
2. **Check against the rules** ([AGENTS.md](../../../AGENTS.md) §6 + [code-style §(b)](../../../docs/conventions/code-style.md)):
   - **Layer/boundary respect** — new business logic in `src/lib/*` (with a spec) and called from a thin route, not piled into a god-file or a route handler. Components stay presentational.
   - **Type honesty** — **no new `any`**, no new `@ts-ignore` (only `@ts-expect-error <reason>`). 
   - **Tests present** — new logic has a `*.spec.ts`; a bug fix has a regression test. Money/auth/routing changes are not OK without a test.
   - **No weakened gates** — no `ignoreBuildErrors`/`ignoreDuringBuilds`, no relaxed `strict`, no deleted/skipped tests, no loosened lint.
   - **Bilingual lockstep** — any user-facing copy touched in **both** `messages/en.json` and `messages/fr.json`; email changes thread `lang`.
   - **Validation at trust boundaries** — server-side role/ownership checks (don't rely on UI gating); input validated.
3. **Check against the [debt-map](../../../docs/quality/debt-map.md) and legacy zones.** Flag any casual edit to: the matcher (`cascadeAttempts` vs `refusedBy`), the Stripe webhook / payout / `complete-session` money paths, `parseAppointmentDate`, the `User` encryption-hook order, `/api/files/[id]` auth, or any god-file rewrite. Flag any **new** duplicate of an already-duplicated system (CMS, email config, file storage).
4. **Check CUJ impact.** If the diff touches a [critical user journey](../../../docs/product/critical-user-journeys.md), confirm it was verified (tests run and/or app exercised). The untested CUJs (webhook, guest payment, booking/signup routes) need extra scrutiny.
5. **Output** findings as `P1/P2/P3 — file:line — problem — suggested fix`. P1 = correctness/security/money/data-loss; P2 = rule violation or real risk; P3 = style/cleanup. If clean, say so plainly. Do **not** edit code in this skill — report only.
