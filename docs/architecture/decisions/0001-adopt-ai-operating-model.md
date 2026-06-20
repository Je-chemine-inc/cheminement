# ADR-0001 — Adopt the AI operating model without migrating legacy code

- **Status**: Accepted
- **Date**: 2026-06-20
- **Deciders**: Product owner + maintainers (harness installed by an AI session)

## Context

Je chemine is a live, in-production Quebec mental-health platform (Next.js 16 / MongoDB / NextAuth / Stripe). It predates our skeleton standards: it carries legacy patterns (the root `README.md` describes a Supabase/Zustand/RHF+Zod build that was never shipped; auth is copy-pasted inline across ~141 files; several modules are 1,000–6,700-line god-files; there is no CI test gate). The code works and serves real users. Rewriting it to match a "target" architecture would be high-risk and is not the goal.

We want every future AI (and human) session to operate with discipline — ground in docs, plan, implement in small steps, verify with evidence, and encode lessons — **without** destabilizing the running system.

## Decision

Adopt the AI operating model **additively**, on top of the code as it is:

1. Install operating docs ([AGENTS.md](../../../AGENTS.md), [architecture](../overview.md), [conventions](../../conventions/code-style.md), [debt-map](../../quality/debt-map.md)), a reverse-engineered product layer ([PRD](../../product/prd.md), [overview](../../product/overview.md), [CUJs](../../product/critical-user-journeys.md)), and workflow-enforcing skills under `.claude/skills/`.
2. **New code** follows the target conventions in [code-style §(b)](../../conventions/code-style.md): strict TypeScript (no new `any`), validation at trust boundaries, tests for new logic, regression tests for bug fixes, Conventional Commits, bilingual lockstep.
3. **Legacy code** is documented, not rewritten. Differences from the target are recorded as legacy patterns in the architecture overview and debt-map, never silently "corrected". Boy-scout cleanup is opt-in (explicit ask only).
4. **Gates are never weakened** to make work pass. Future architectural choices are recorded as new ADRs in this folder.

## Consequences

- New code converges on the target conventions; the codebase improves at the edges without a risky big-bang migration.
- The debt-map becomes the single, append-only home for known landmines; sessions add findings there instead of fixing-by-the-way.
- There is a small, accepted inconsistency cost: new and legacy patterns coexist (e.g. RSC-less dashboards, inline auth) until a task deliberately addresses a given area.
- Every materially new decision (a new data store, a real CI gate, a refactor of a god-file, a state-machine change) gets its own ADR here so the reasoning is preserved.
