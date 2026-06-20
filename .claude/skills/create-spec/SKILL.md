---
name: create-spec
description: Turn a feature request or change idea into a written spec under specs/NNN-slug/spec.md before any planning or coding. Use when the user says "write a spec", "spec this out", "let's scope this feature", or describes something new to build.
argument-hint: <short feature description>
---

# Create a spec

Turn a feature request into a reviewable spec. Do **not** plan implementation steps or write code here — that's `/plan-feature` and `/implement-feature`.

## Steps

1. **Ground first.** Read [AGENTS.md](../../../AGENTS.md), the relevant parts of [docs/architecture/overview.md](../../../docs/architecture/overview.md), and the [debt-map](../../../docs/quality/debt-map.md). Skim neighbouring code so the spec reflects how this project actually works.
2. **Locate the specs folder.** If `specs/` does not exist at the repo root, create it. Find the highest existing `NNN` and use the next zero-padded number (start at `001`). Create `specs/NNN-slug/spec.md` with a short kebab-case slug.
3. **Write the spec** with these sections:
   - **Problem** — what user/operator need this serves (tie to a [CUJ](../../../docs/product/critical-user-journeys.md) or the [PRD](../../../docs/product/prd.md) goal where relevant; the primary goal is *faster matching*).
   - **Acceptance criteria** — testable bullets ("given/when/then" where useful). Include the bilingual requirement if any user-facing copy changes (EN + FR lockstep).
   - **Out of scope** — what this explicitly does not do (respect the product non-goals: not a crisis line, not an EHR, no insurance billing, B2B lead-capture only).
   - **Affected files / legacy zones** — list the likely files/modules. **Cross-check the [debt-map](../../../docs/quality/debt-map.md)**: if the work touches a god-file, money/state-machine code, the matcher (`cascadeAttempts` vs `refusedBy`), `parseAppointmentDate`, encryption ordering, or `/api/files/[id]`, call it out as a risk.
   - **Test plan** — which `*.spec.ts` to add/extend (pure logic in `src/lib`, route guards under `src/app/api`) and which CUJ to verify manually. Note that there is no UI test harness, so UI changes need manual verification.
4. **Keep it additive and honest** — note any assumptions and any open questions for the user. Don't invent product intent; ask if unsure.
5. **Hand off.** Point the user to `/plan-feature` with the spec path.
