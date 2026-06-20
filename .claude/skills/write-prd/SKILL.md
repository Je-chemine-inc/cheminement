---
name: write-prd
description: Re-derive or update the product requirements doc (docs/product/prd.md) when requirements, goals, or scope change. Use when the user says "update the PRD", "write a PRD", "the requirements changed", or wants product intent captured.
argument-hint: (optional) what changed about the requirements
---

# Write / update the PRD

Maintain [docs/product/prd.md](../../../docs/product/prd.md) with the same discipline used to reverse-engineer it. The PRD is the product's source of intent; keep it honest.

## Steps

1. **Read the current PRD** and the [product overview](../../../docs/product/overview.md) + [CUJs](../../../docs/product/critical-user-journeys.md) so you build on what's there.
2. **Observed vs inferred discipline.** Every claim is either **observed** (cite the file/route/model/copy it comes from) or **`[inferred]`**. What the code can show — routes, models, copy, integrations — must be grounded in the code. Don't restate marketing claims as facts.
3. **Interview only for gaps.** Business goals, non-goals, success metrics, targets/SLAs, and scope are **not** in the code — ask the user (focused questions, AskUserQuestion-style). Anything still unknown becomes an **Open Question**, never an assumption. (Current baseline: primary goal = *faster matching*; non-goals = not-a-crisis-line / not-an-EHR / no-insurance-billing / B2B-lead-capture-only; metrics = time-to-match, acceptance rate, booking→paid, pro utilization; scope = Quebec now, international later.)
4. **Update the sections**: problem & opportunity · goals & non-goals · users & jobs · current scope (ranked by centrality) · constraints · success metrics · open questions · decision log. Re-rank scope by what the code/usage shows is central.
5. **Append to the decision log** — a dated entry describing what changed and who confirmed it. Never rewrite history; add to it.
6. Keep it consistent with the [PRD](../../../docs/product/prd.md)'s sibling docs; if scope changed, also run [/update-docs](../update-docs/SKILL.md) for the overview and CUJs.
