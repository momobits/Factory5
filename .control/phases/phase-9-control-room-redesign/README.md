# Phase 9 — control-room-redesign

**Dependencies:** none hard. Soft sequence after `phase-8-question-auto-answer-closed`. No code dependency on prior phases.
**Estimated duration:** 1 session (informal cadence — single working-tree change set, no per-step commits)
**Status:** code complete, awaiting `/phase-close` + operator live-browser verification.

## Goal

Port the "Editorial Control Room" aesthetic from the sibling conductor project (Phase 19) to factory5's `apps/factory-web` dashboard. Dual-theme via `prefers-color-scheme` — warm parchment in light, ink-black in dark, vermillion (`#ff4d1c`) accent across both.

## Outcome

- Dashboard layout rewritten with editorial masthead (Fraunces brand, edition stamp, numbered nav), monospaced status pip with pulse animation, paper-grain SVG noise backdrop, CSS-custom-property design tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`.
- All 8 components (Card, Table, Alert, Field, Form, Submit, EmptyState, PageShell) re-wired to the new tokens. Most scoped styles dropped — visual treatment lives in Dashboard's global stylesheet so pages that hand-roll `<div class="card">` / `<form class="form">` markup pick up the look without page-side changes.
- Status semantics (green / amber / red for connected / reconnecting / disconnected) held theme-independent for at-a-glance recognition (Phase 3 frontend-design rule).
- Absorbs Phase 8's deferred carry-forward "PageShell + Dashboard `<style is:global>` migration".

Full plan + outcome detail: [`../../../UPGRADE/plans/tier-9-control-room-redesign.md`](../../../UPGRADE/plans/tier-9-control-room-redesign.md).

## Where we were, end of Phase 8

Phase 8 closed at `phase-8-question-auto-answer-closed` (`d863ea0`). Upgrade arc parked. Tier 9 reopens the arc for a frontend aesthetic overhaul rather than a structural feature — the first tier in the arc to ship visual-design work without an underlying contract change.

## Why this phase exists

Operator request (this session): port the sibling conductor project's "Editorial Control Room" redesign to factory-web so the two control planes share a visual identity. The current dashboard is functional but visually generic (system-font sans, `color-mix(currentColor)` chrome, GitHub-ish neutral). The conductor port demonstrated that editorial / mission-control aesthetics work for control-plane UIs without sacrificing readability or accessibility.

Operator decisions at session start:
1. **Dual-theme** over dark-only — preserves factory5's `color-scheme: light dark` discipline + Phase 3 frontend-design "inherit-don't-invent" rule.
2. **Informal cadence** — single-session redesign, no per-step commits, no scaffolded-before-coding workflow. Documentation lands post-hoc.
3. **Fresh Tier 9 framing** (over "promote the PageShell migration carry-forward verbatim") — absorbs the queued migration as part of a larger aesthetic statement.

Issues addressed: the PageShell + Dashboard `<style is:global>` migration carry-forward from Phase 8's Deferred section (now absorbed *de facto* — global stylesheet carries the look that pages have always referenced).

## Steps

See [`steps.md`](steps.md) — all sub-steps pre-checked since the redesign landed as a single uncommitted change set, not a per-step buildup.

## Done criteria

- [x] `pnpm build` clean (factory-web built 12 pages)
- [x] `pnpm test` clean (full workspace — same counts as Phase 8 close)
- [x] `pnpm lint` clean
- [x] `pnpm format:check` clean
- [x] Dual-theme verified by CSS inspection (light defaults at `:root`, dark override at `@media (prefers-color-scheme: dark)`)
- [x] Status pip retains semantic colors on both themes
- [x] Connection heartbeat + logout banner + hamburger drawer markup logic preserved verbatim
- [ ] Live browser verification — operator-side only (assistant cannot open a browser). Run `factoryd` + open `factory ui-token` URL, click through all 8 sections, toggle OS theme.

## Rollback

`git checkout -- apps/factory-web/src/layouts/Dashboard.astro apps/factory-web/src/components/*.astro` reverts the redesign without touching anything else.
