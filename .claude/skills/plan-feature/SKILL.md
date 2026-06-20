---
name: plan-feature
description: Produce a concrete, step-by-step implementation plan from a spec (or a described feature) before writing code. Use when the user says "plan this", "how would you build this", "make a plan", or hands you a spec to implement.
argument-hint: <spec path or feature description>
---

# Plan a feature

Turn a spec into an ordered, file-level plan. No code yet.

## Steps

1. **Ground.** Read [AGENTS.md](../../../AGENTS.md) (the loop, rules for new code, legacy zones) and the spec if one exists (`specs/NNN-slug/spec.md`). Read [docs/architecture/overview.md](../../../docs/architecture/overview.md) for where things live and [docs/conventions/code-style.md](../../../docs/conventions/code-style.md) §(b) for how new code must look.
2. **Inventory existing code first — reuse, never recreate.** Search `src/lib`, `src/components`, `src/app/api`, and `src/models` for existing helpers, patterns, models, and i18n keys you can extend. Prefer extending an existing `lib/` service or component over inventing a new one. Note what you'll reuse.
3. **Check legacy-zone contact.** Cross-reference the [debt-map](../../../docs/quality/debt-map.md). If the plan touches: a god-file (`notifications.ts`, `email-template-registry.ts`, `appointment/page.tsx`, `MedicalProfile.tsx`), money/state-machine code (webhook, payout, `complete-session`, the matcher), `parseAppointmentDate`, the `User` encryption-hook ordering, or `/api/files/[id]` — flag it explicitly and plan to add a test.
4. **Write the plan** as ordered steps, each with: the **file paths** to touch, what changes, and the **verification** for that step (which `pnpm test` spec, or which [CUJ](../../../docs/product/critical-user-journeys.md) to exercise). Keep new business logic in a `src/lib/*` module called by a thin route. Put any user-facing copy in **both** `messages/en.json` and `messages/fr.json`.
5. **Sequence to keep the build green** — small steps, each independently verifiable. Identify the riskiest step and do it behind a test.
6. **Surface decisions** that need the user (anything that changes product behaviour, scope, or a non-goal). Then hand off to `/implement-feature`.
