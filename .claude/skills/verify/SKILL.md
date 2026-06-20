---
name: verify
description: Run the project's real green sequence and prove a change works before claiming done. Use when the user says "verify", "is it green", "did it work", "check the build", or before finishing any task.
argument-hint: (optional) what changed / which CUJ to exercise
---

# Verify

Produce an **evidence summary**, never a bare "done". The Vercel build is the only deploy gate and it does **not** run tests — so run them yourself.

## The green sequence (real commands)

Run from the repo root and capture the output. **"Green" = `pnpm test` and `pnpm build` both pass.**

1. `pnpm test` — Vitest (`*.spec.ts`, node env). Focused run: `pnpm test <path-or-name>`. Must pass.
2. `pnpm build` — `next build`: the deploy gate (what Vercel runs). Enforces the **strict TypeScript typecheck** + bundling. Treat a failing build as not-done. (`pnpm exec tsc --noEmit` is a faster typecheck-only check — the compiler directly, not a package.json script.)
3. `pnpm lint` — ESLint. **Advisory, not a gate**: the tree has ~84 pre-existing errors and `next build` (Next 16) does not run ESLint. Don't aim for zero — just confirm you added **no new** errors in the files you touched (compare against the baseline).

(`pnpm seed` is broken — don't use it. Never point the `tsx` ops scripts at the prod DB.)

## For UI / behaviour changes

There are **no automated UI tests**, so manual verification is required:

1. `pnpm dev` and open the app. Sign in with the relevant role (admin / professional / client) — use test accounts (e.g. `@test.local`), never real client data.
2. Exercise the **[critical user journey](../../../docs/product/critical-user-journeys.md)** the change touches, end to end. Confirm both **EN and FR** if copy changed (toggle the locale).
3. For money/state-machine changes (CUJ-5/6/7), confirm the resulting DB state and that a receipt is issued **only** when `payment.status === "paid"`.
4. Clean up any test data you created.

## Output

A short evidence summary: each command run + its result (pasted, not paraphrased), which CUJ was exercised and what you observed, and anything still unverified. If a step failed, say so with the output — do not claim done.
