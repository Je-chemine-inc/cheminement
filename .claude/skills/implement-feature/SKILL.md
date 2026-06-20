---
name: implement-feature
description: Execute an agreed plan in small, verified, conventional commits. Use when the user says "implement this", "build it", "start coding", or approves a plan to carry out.
argument-hint: <plan or spec path>
---

# Implement a feature

Carry out a plan with discipline. Keep the build green at every step.

## Steps

1. **Re-ground.** Read [AGENTS.md](../../../AGENTS.md) and the plan/spec. Confirm the branch: if you're on `main`, create a feature branch first (`feat/...` or `fix/...`).
2. **Work in small steps**, one logical change at a time:
   - New code follows [docs/conventions/code-style.md](../../../docs/conventions/code-style.md) **§(b)**: strict TS, **no new `any`**, `@ts-expect-error <reason>` not `@ts-ignore`; validate at trust boundaries; new business logic goes in a `src/lib/*` module with a `*.spec.ts`, called from a thin route/handler; never trust the client for role/ownership.
   - **Bilingual lockstep**: every user-facing string in **both** `messages/en.json` and `messages/fr.json`. Thread `lang` through email builders.
   - Match the neighbouring file's patterns when editing inside an existing (legacy) module; don't rewrite god-files — edit surgically.
   - Respect the invariants: write appointment dates via `parseAppointmentDate`; never derive `cascadeAttempts` from `refusedBy`; issue receipts only when `payment.status === "paid"`.
3. **Test as you go.** For a bug fix, write the **failing regression test first**. For new logic, add its spec. Run `pnpm test` (and `pnpm exec tsc --noEmit` for a fast typecheck) after each step.
4. **Commit** each green step with a Conventional Commit message (`feat:`, `fix:`, `docs:`, `chore:` …), matching the existing history.
5. **Never weaken a gate** to make something pass (no `ignoreBuildErrors`, no deleting a test, no loosening `strict`). If a gate is genuinely wrong, propose the change separately.
6. **Stop after two failed attempts** at the same fix — don't push a hack through. Ask one concrete question.
7. When done, run `/verify`. If a mistake could recur, run `/encode-lesson` in the same PR.
