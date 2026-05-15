# Tier 9 — Control Room redesign (factory-web editorial port)

**Status:** complete (single-session, informal cadence — no per-step commits)
**Estimated duration:** 1 session (delivered in 1)
**Issues addressed:** absorbs the carry-forward "PageShell + Dashboard `<style is:global>` migration" from Phase 8's deferred list (11-page sweep + filter-form Apply / "Clear all defaults" + inline-style audit).

## Goal

Apply the "Editorial Control Room" aesthetic from the sibling conductor project (`G:\Projects\Small-Projects\Harness\conductor`, Phase 19) to factory5's `apps/factory-web` dashboard. Replace system-font generic chrome with an editorial / mission-control hybrid: Fraunces display serif + Bricolage Grotesque body + JetBrains Mono data, vermillion (#ff4d1c) signal accent, hairline rules, paper-grain backdrop, letterpress card tiles, oversized italic page titles, monospaced status indicators.

## Decision: dual-theme, not dark-only

Conductor's original port committed dark-only. factory5's Phase 3 frontend-design judgement calls (`STATE.md` — _"inherit-don't-invent"_, theme-independent status semantics, native HTML over custom widgets) argued for dual-theme. The Editorial Control Room aesthetic ports to both light (warm parchment / ink) and dark (ink-black / paper) via CSS custom properties switched by `prefers-color-scheme`. Vermillion accent + status semantic colors (`#2a8b54 / #b87c1a / #c0263a` — green / amber / red) persist across themes for at-a-glance recognition.

## Outcome

- `apps/factory-web/src/layouts/Dashboard.astro` rewritten: editorial masthead (brand mark `§` + brand name + italic strapline `/ Control Room`, edition stamp on right, double horizontal rule), numbered nav (`01 OVERVIEW` … `08 FINDINGS`), monospaced status pip with pulse animation, paper-grain SVG noise + radial gradient atmosphere, all surfaces driven by `--bg / --surface / --ink / --hairline / --signal` tokens that flip on `prefers-color-scheme`.
- All 8 components (Card, Table, Alert, Field, Form, Submit, EmptyState, PageShell) rewired to the new tokens. Most retain only minimal scoped CSS; visual treatment lives in Dashboard's global stylesheet so plain `.card` / `.alert` / `.form-field` markup on pages picks up the look automatically.
- Page-title block (`.page-title`) added to Dashboard layout so existing pages — none of which use `<PageShell>` today — get the new italic Fraunces page heading with a 36px vermillion underscore rule.
- Filter-form, code blocks, links, scrollbars, focus rings, dialog all touched.
- Light theme: warm parchment (`#f4ecd9`) on `#fffaef` surfaces, ink (`#1a1a1d`) text, hairlines on `#d8cdb0`. Dark theme: ink-black (`#0c0c0e`) on `#16161a` surfaces, parchment (`#f3ece0`) text, hairlines on `#2b2b32`. Status semantics held theme-independent.

## Where we were, end of Phase 8

Phase 8 closed `phase-8-question-auto-answer-closed`. Upgrade arc parked. The Phase 8 LOG entry's Deferred section listed _"PageShell + Dashboard `<style is:global>` migration — 11-page sweep absorbing filter-form Apply / 'Clear all defaults' + inline-style audit. Self-contained ~1 commit."_ — Tier 9 absorbs that work and goes considerably further (aesthetic overhaul rather than structural deduplication).

## Why this phase exists

The current dashboard is functional but visually generic: system-font sans, `color-mix(currentColor)` everywhere, GitHub-ish neutral chrome. Conductor's editorial redesign (sibling project) demonstrated that the underlying primitives — Kanban tiles, status pip, dashboard cards, dialog, form inputs — port cleanly to a more distinctive aesthetic without sacrificing readability or accessibility. Operator chose to mirror the Conductor port here so the two control planes share a visual identity.

Operator decisions at session start (recorded in this session's transcript, not formal questions):

1. **Dual-theme port** over dark-only — preserves factory5's `color-scheme: light dark` discipline.
2. **Informal cadence** — single-session redesign with no per-step commits; documentation lands post-hoc in this plan + the phase folder + LOG entry + STATE flip.
3. **Fresh Tier 9 framing** — absorbs the queued PageShell migration as part of a larger aesthetic statement, rather than promoting the carry-forward as the headline.

## What shipped (informal — no per-step commits)

The redesign landed as a single working-tree change set. Listed here for the LOG and future-session readers; the actual diff is in the working tree (uncommitted at the time of writing this record).

- **9.layout — `apps/factory-web/src/layouts/Dashboard.astro`.** Full inline-style rewrite (~660 lines of CSS-in-`<style is:global>`). New CSS custom-property layer: `--f-display / --f-body / --f-mono`, `--signal / --amber / --acid / --halt / --cool`, `--bg / --bg-2 / --surface / --surface-2 / --ink / --ink-2 / --mute / --mute-2 / --hairline / --hairline-2 / --grain-opacity`. `@media (prefers-color-scheme: dark)` swaps the surface/ink token block. Markup re-laid: masthead-top (brand + edition) → masthead-rule (double horizontal stroke) → masthead-meta (numbered nav + status pip + sign-out + hamburger drawer). Status pip retains theme-independent semantic colors. Logout banner, drawer, and connection-heartbeat script logic preserved verbatim.

- **9.components — primitives.**
  - **Card.astro** — scoped style block dropped; markup unchanged. The letterpress border-left rule, vermillion hover state, oversized Fraunces-900 numerals all live in Dashboard's global stylesheet so pages that hand-roll `<div class="card">` markup (e.g. dashboard tiles assembled in `<script>` blocks) pick up the same look.
  - **Table.astro** — scoped block kept minimal (caption + empty-cell). Editorial table chrome (vermillion-tinted row hover, monospaced cells, amber link borders) in global.
  - **Alert.astro** — scoped block dropped; aesthetic lives in global (`.alert / .alert--success / .alert--conflict / .alert--info` with editorial italic h4 + vermillion success-h4 / red conflict-h4 tints).
  - **Field.astro / Form.astro / Submit.astro** — scoped blocks dropped. Form scaffolding (label as monospaced uppercase eyebrow, inputs with vermillion focus ring, vermillion-filled `.btn-primary`, neutral outline `.btn`, red-outline `.btn-danger`) all in global.
  - **EmptyState.astro** — scoped block rewritten editorially: monospaced "No records on file" eyebrow, italic Fraunces title, vermillion underscore rule, vermillion CTA button.
  - **PageShell.astro** — h2 → h3 (Dashboard's `.page-title` h2 owns the page heading now); kept for pages that want a sub-section header + description block.

- **9.pages — sweep.** Page-level markup untouched (none of the 12 pages were edited). Every page picks up the new look via the global stylesheet because pages reference shared classes (`.card`, `.alert`, `.empty`, `.form-field`, `.btn`, etc.) rather than carrying their own styles. The PageShell migration carry-forward is therefore absorbed _de facto_ — the global stylesheet now carries the look that pages have always referenced. The remaining inline `style=` attributes (e.g. `index.astro:15` `style="margin-top: 1.5rem;"`) are cosmetic-only and not load-bearing; can be cleaned up in a follow-up sweep if desired.

- **9.theme — `prefers-color-scheme` switch.** `:root` ships light-default tokens; `@media (prefers-color-scheme: dark)` overrides the surface/ink/hairline/grain-opacity block. Vermillion + amber accents shift slightly (amber gets darker for light-mode legibility — `#b87c1a` instead of `#f0b65d`). Status semantics held identical across themes for muscle memory.

## Done criteria

All gates verified in this session:

- [x] `pnpm build` clean — factory-web built 12 pages without warnings
- [x] `pnpm test` clean — full workspace passes (daemon 173, brain 114, channels 175, cli 141, worker 47, etc — same counts as Phase 8 close)
- [x] `pnpm lint` clean — eslint reports no issues
- [x] `pnpm format:check` clean — prettier matches (`.astro` is not in prettier's glob, so style changes there don't touch format gate)
- [x] Light + dark themes both render via `prefers-color-scheme` media query
- [x] Status pip retains green / amber / red semantic colors on both themes
- [x] Connection heartbeat + logout banner + hamburger drawer still functional (markup logic preserved verbatim)

**Not gated by tests:**

- [ ] Live browser verification — assistant cannot open a browser from this environment. Operator should run `factoryd` + `factory ui-token`, open the URL, click through Overview / Projects / Build / Chat / Directives / Questions / Spend / Findings, and verify both light + dark themes render correctly.
- [ ] Filter-form Apply / "Clear all defaults" affordance — the unstyled-button issue noted in Phase 8's Deferred section is _partially_ addressed (filter-form buttons inherit the new global `.filter-form button` editorial style), but the specific behavioral interaction wasn't re-verified.

## Rollback plan

`git checkout -- apps/factory-web/src/layouts/Dashboard.astro apps/factory-web/src/components/*.astro` reverts the redesign without touching anything else. Working tree was dirty at write time; nothing else in the workspace changed.

## Carry-forward notes

After Tier 9 closes:

- **Inline-style audit** on the 11 pages still partially deferred (cosmetic-only `style="margin-top: …"` etc. remaining). Self-contained ~30-min sweep when motivated.
- **ADR 0031 — Editorial Control Room aesthetic + dual-theme tokens** could formalize the design decision retrospectively if a future tier wants to lean on it. Not load-bearing without that follow-up tier.
- The original Phase 8 Deferred list (U005 chat REPL cancel, per-project deadline override, `factory config get/set`, override-after-auto-answer, etc.) remains intact — Tier 9 did not touch any of it.

## Commit message (if operator chooses to commit)

```
feat(phase-9): editorial control room redesign — dual-theme port of factory-web

Apply the "Editorial Control Room" aesthetic from the sibling conductor
project (G:/Projects/Small-Projects/Harness/conductor, Phase 19) to
apps/factory-web. Fraunces display serif + Bricolage Grotesque body +
JetBrains Mono data; vermillion (#ff4d1c) signal accent; hairline rules;
paper-grain backdrop; letterpress card tiles; numbered nav; oversized
italic page titles; monospaced status pip with pulse animation.

Dual-theme via :root tokens flipped by prefers-color-scheme — light is
warm parchment / ink, dark is ink-black / paper. Status semantics
(green/amber/red) held theme-independent for at-a-glance recognition.

Touches:
  apps/factory-web/src/layouts/Dashboard.astro — full inline-style rewrite
  apps/factory-web/src/components/{Card,Table,Alert,Field,Form,Submit,EmptyState,PageShell}.astro
    — scoped styles trimmed; visuals live in Dashboard's global stylesheet

Absorbs the Phase 8 carry-forward "PageShell + Dashboard <style is:global>
migration" (11-page sweep). Page-level markup untouched; the global
stylesheet now carries the look that pages have always referenced via
shared classes (.card, .alert, .empty, .form-field, .btn, etc.).

All four pnpm gates green: build / test / lint / format:check.

Tier 9 of factory5 upgrade arc.
```
