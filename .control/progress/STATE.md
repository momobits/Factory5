# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-02 19:25 UTC by step 1.3 commit
**Current phase:** 1 — doc-sweep
**Current step:** 1.4 — Add §"Web dashboard" to `docs/ONBOARDING.md`
**Status:** ready

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Step 1.4 — add §"Web dashboard" to `docs/ONBOARDING.md` per [`../../UPGRADE/plans/tier-1-doc-sweep.md`](../../UPGRADE/plans/tier-1-doc-sweep.md) §1.4. Insert between §4 "First build" and §5 "Optional — Discord channel". Cover what the dashboard is (read + write surface for directives / projects / questions / spend / findings), how to open it (factoryd's stdout `ui:` line; token capture from `?t=`), how to recover with `factory ui-token`, a tour of the ten pages, and the today-limitation that detail pages don't refresh live (Tier 3 will add SSE).

---

## Git state

- **Branch:** main
- **Last commit:** `cc35dd2` — chore(install): bootstrap factory5 project docs (scanned from codebase)
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-15-demand-driven-runoff-closed` (legacy — leftover from the removed v1 Control framework; first new tag will be `phase-1-doc-sweep-closed`)

---

## Open blockers

- None

---

## In-flight work

None — pre-Phase-1 housekeeping committed (see "Recently completed"). Step 1.1 can begin from the clean working tree.

---

## Test / eval status

- **Last test run:** 2026-05-02 — 876 passed, 3 skipped (worker-sandbox Windows-only / Linux-only branches; `describe.skipIf`)
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

---

## Recently completed (last 5 steps)

- Step 1.3 — refresh `apps/factory-web/README.md` (drop the `(wired in 9.3)` phase reference; replace stub Routing section with a 10-page index that maps URL → file → purpose; explain the query-string `detail.astro` choice) — 2026-05-02 — pending commit
- Step 1.2 — refresh `packages/channels/README.md` (Status reflects what's shipped; new Telegram plugin + Web ≠ ChannelPlugin sections; Adding-a-channel verified) — 2026-05-02 — `c53f8d9`
- Step 1.1 — refresh `packages/cli/README.md` (drop Phase column; add spend/findings/questions cleanup rows; remove `inspect`/`push`; reword `logs` stub) — 2026-05-02 — `d33635a`
- Reconcile STATE.md + Phase 1 README to actual git state (drift fix) — 2026-05-02 — `91541a9`
- Bootstrap factory5 project docs (scanned from codebase) — 2026-05-02 — `cc35dd2`

---

## Attempts that didn't work (current step only)

- None yet — Step 1.1 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

## Notes for next session

Phase 1 is doc-only — no live-LLM spend, no risk to production code. Most-felt UX gaps close in Phase 2 (channel parity) and Phase 3 (web UI live + complete). Tier ordering: 1 → 2 → 3+4 in parallel.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
