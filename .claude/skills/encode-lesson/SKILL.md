---
name: encode-lesson
description: Turn a correction, recurring mistake, or newly-learned gotcha into permanent machinery so it can't recur. Use when the user corrects you, when a bug reveals a trap, or says "make sure this doesn't happen again", "encode this", "remember this for next time".
argument-hint: <the mistake or lesson>
---

# Encode a lesson

When something went wrong (or a correction was given), make the fix permanent in the **same PR**. Prefer a blocking mechanism over prose.

## Choose the strongest mechanism that fits

1. **A test** (best for logic/regressions) — add a `*.spec.ts` that fails on the mistake and passes on the fix. Pure logic in `src/lib`, route guards under `src/app/api`. This is the default for anything money/auth/routing.
2. **A check / lint rule** — if the mistake is mechanical and detectable, add an ESLint rule (the config is in `eslint.config.mjs`) or a small check script. **Propose any gate change separately and explicitly** — never weaken an existing gate to "encode" something.
3. **A documented invariant** — if no automated guard is practical, add a dated line to the right doc:
   - A landmine / fragile area → append to [docs/quality/debt-map.md](../../../docs/quality/debt-map.md) (it is append-only) with a `[P#]` severity and the date.
   - A convention for new code → [docs/conventions/code-style.md](../../../docs/conventions/code-style.md) §(b).
   - A "handle with care" zone → [AGENTS.md](../../../AGENTS.md) §7 and/or the debt-map.
   - A flow that must be verified → register/extend a [CUJ](../../../docs/product/critical-user-journeys.md).

## Rules

- Always do the **minimum durable thing**: at least a dated doc line; ideally a test or check.
- Keep one home per fact — link rather than duplicate.
- Note in the PR/commit what was encoded and why (`docs:` or `test:` commit), so the lesson is traceable.
- If the lesson is a personal/process preference rather than a repo fact, tell the user it belongs in their Claude memory, not the repo docs.
