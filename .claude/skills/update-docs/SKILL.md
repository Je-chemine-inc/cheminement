---
name: update-docs
description: After a merged or completed change, update any stale docs so they keep matching the code. Use when the user says "update the docs", "keep the docs in sync", or after finishing a feature that changed behaviour, structure, or product scope.
argument-hint: (optional) what changed
---

# Update the docs

Keep the operating docs true to the code. One fact, one home — update where it lives, don't duplicate.

## Steps

1. **Identify what changed** (read the diff / the completed work) and which docs it affects.
2. **Update the right doc(s):**
   - New/changed flow, structure, or integration → [docs/architecture/overview.md](../../../docs/architecture/overview.md). A material architectural decision → add a new ADR in [docs/architecture/decisions/](../../../docs/architecture/decisions/) (next `NNNN`).
   - New convention for new code → [docs/conventions/code-style.md](../../../docs/conventions/code-style.md) §(b).
   - New landmine / fixed-or-discovered debt → [docs/quality/debt-map.md](../../../docs/quality/debt-map.md) (append-only, dated, `[P#]`). If a debt item was actually resolved, note it as resolved with the date — don't silently delete the history.
   - New/changed user-visible capability → [docs/product/overview.md](../../../docs/product/overview.md), and register/extend a [CUJ](../../../docs/product/critical-user-journeys.md). Requirement change → [/write-prd](../write-prd/SKILL.md) (append to the PRD decision log).
3. **Check internal links resolve.** Every relative link in the touched docs must point at a real file, and [docs/index.md](../../../docs/index.md) must list every file under `docs/`. If you added a doc, add its index line.
4. **Reconcile, don't accrete.** If a doc claim is now wrong, fix it in place; if a fact moved, move the single home and re-point links. Flag (don't fix) anything outside the scope of this change.
5. Commit with a `docs:` Conventional Commit.
