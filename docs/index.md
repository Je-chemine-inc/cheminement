# Docs index

The operating documentation for **Je chemine**. Start at [../AGENTS.md](../AGENTS.md) — it is the entry point for every session and links here. One fact has one home; if something is wrong, fix it where it lives (and see `/update-docs`).

## Architecture
- [architecture/overview.md](architecture/overview.md) — the system as it actually is: rendering/data-flow model, real directory layout, external services, entry points, and known deviations from a "target" architecture.
- [architecture/decisions/0001-adopt-ai-operating-model.md](architecture/decisions/0001-adopt-ai-operating-model.md) — ADR-0001: adopt the AI operating model without migrating legacy code.

## Conventions
- [conventions/code-style.md](conventions/code-style.md) — (a) detected conventions as they exist today, and (b) target conventions for new code.

## Quality
- [quality/debt-map.md](quality/debt-map.md) — the honest, append-only map of landmines, fragile areas, missing test coverage, and deploy-coupled steps.

## Product
- [product/prd.md](product/prd.md) — the reverse-engineered PRD (problem, goals/non-goals, users, scope, metrics, open questions, decision log).
- [product/overview.md](product/overview.md) — plain-language description of what the product does today, for a new teammate.
- [product/critical-user-journeys.md](product/critical-user-journeys.md) — the journeys that must never break, with code locations and test coverage.
