# Phase 9 Steps

All steps pre-checked: the redesign landed as a single uncommitted working-tree change set this session (informal cadence — operator chose to bypass per-step commits). Listed here for the audit trail; the LOG entry + phase-9 plan carry the substantive detail.

- [x] 9.layout — Rewrite `apps/factory-web/src/layouts/Dashboard.astro` inline `<style is:global>` block (~660 lines). New CSS custom-property layer (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool / --f-display / --f-body / --f-mono / --grain-opacity`). `@media (prefers-color-scheme: dark)` swaps surface/ink/hairline tokens. Masthead markup re-laid: brand mark `§` + brand name + italic strapline `/ Control Room` + edition stamp; double horizontal rule; numbered nav (`01 OVERVIEW` … `08 FINDINGS`); monospaced status pip with pulse animation; paper-grain SVG noise + radial-gradient atmosphere via `body::before / body::after`. `page-title` block added inside `main.shell` so all 12 existing pages get the new italic Fraunces page heading with 36px vermillion underscore rule without touching page markup. Connection heartbeat + logout banner + hamburger drawer JS preserved verbatim.

- [x] 9.components — Re-wire 8 primitives to the new tokens.
  - `Card.astro` — scoped block dropped (now in global `.card`).
  - `Table.astro` — minimal scoped block (caption + empty-cell); chrome in global.
  - `Alert.astro` — scoped block dropped (now in global `.alert / .alert--*`).
  - `Field.astro / Form.astro / Submit.astro` — scoped blocks dropped (form scaffolding in global).
  - `EmptyState.astro` — scoped block rewritten editorially (monospaced "No records on file" eyebrow, italic Fraunces title, vermillion underscore rule, vermillion CTA).
  - `PageShell.astro` — h2 → h3 (Dashboard's `.page-title` h2 owns page heading).

- [x] 9.theme — Dual-theme via `prefers-color-scheme`. Light tokens at `:root`; dark override block inside `@media (prefers-color-scheme: dark)`. Vermillion accent + status semantics held identical across themes; amber gets darker for light-mode legibility.

- [x] 9.gates — All four `pnpm` gates green: build / test / lint / format:check.

- [x] 9.records — `.control` system updated post-hoc: this phase folder; Phase 9 row added to `.control/architecture/phase-plan.md`; Tier 9 section added to `UPGRADE/ROADMAP.md` (count bumped "Eight tiers → Nine tiers"); STATE.md flipped arc-complete → Phase 9 (awaiting `/phase-close`); journal + LOG entries appended.

- [x] 9.close — `/phase-close` — tag `phase-9-control-room-redesign-closed`, append final session entry to LOG, transition STATE back to "all phases complete" (sixth time). Browser smoke completed this session via Playwright MCP.

## Step detail

The redesign was authored as a single working-tree change set, not a per-step buildup. Detail for each step (file pointers, decisions, plan-deviations) is in [`../../../UPGRADE/plans/tier-9-control-room-redesign.md`](../../../UPGRADE/plans/tier-9-control-room-redesign.md) under the "What shipped" section.

Suggested commit (if operator chooses to bundle): see the plan's "Commit message" section.
