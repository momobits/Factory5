# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-02 19:50 UTC by step 1.4 commit
**Current phase:** 1 — doc-sweep
**Current step:** 1.5 — Add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md`
**Status:** ready

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Step 1.5 — add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md` per [`../../UPGRADE/plans/tier-1-doc-sweep.md`](../../UPGRADE/plans/tier-1-doc-sweep.md) §1.5. Insert as the next section after §5 "Web dashboard" (so it becomes §6, and Discord/Telegram channel walkthroughs renumber from §6/§7 → §7/§8). Cover `factory chat` REPL (`/quit`, 120s per-turn timeout — issue U005), Discord chat (mention → thread → /build prefix), Telegram chat (DM or group reply-to), and the shared model (every channel writes the same `Directive` shape).

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

- Step 1.4 — add §"Web dashboard" to `docs/ONBOARDING.md` (open / recover URL / page tour / today-limitations); renumber §5→§6 Discord, §6→§7 Telegram, §7→§8 multi-instance, §8→§9 backups, §9→§10 troubleshooting; update inline §-refs on lines 17/18/71; add ADR 0025/0027 to Pointers — 2026-05-02 — pending commit
- Step 1.3 — refresh `apps/factory-web/README.md` (drop `(wired in 9.3)` phase ref; replace Routing stub with 10-page index URL→file→purpose; explain query-string `detail.astro` choice) — 2026-05-02 — `30293ff`
- Step 1.2 — refresh `packages/channels/README.md` (Status reflects what's shipped; new Telegram plugin + Web ≠ ChannelPlugin sections) — 2026-05-02 — `c53f8d9`
- Step 1.1 — refresh `packages/cli/README.md` (drop Phase column; add spend/findings/questions cleanup rows) — 2026-05-02 — `d33635a`
- Reconcile STATE.md + Phase 1 README to actual git state (drift fix) — 2026-05-02 — `91541a9`

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
