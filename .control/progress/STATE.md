# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-02 20:45 UTC by step 1.6 commit
**Current phase:** 1 — doc-sweep
**Current step:** 1.7 — Audit `docs/SKILLS.md` + `docs/AGENTS.md` against current code
**Status:** ready

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Step 1.7 — single-pass audit of `docs/SKILLS.md` + `docs/AGENTS.md` against current code per [`../../UPGRADE/plans/tier-1-doc-sweep.md`](../../UPGRADE/plans/tier-1-doc-sweep.md) §1.7. For each skill listed in `SKILLS.md`, verify the corresponding `skills/<name>.md` exists. For each agent in `AGENTS.md`, verify it's referenced from `packages/brain/src/`. Update either doc to match code where they've drifted. Commit shape depends on outcome: `docs(1.7): reconcile SKILLS.md + AGENTS.md against current code` if changes; `docs(1.7): SKILLS.md + AGENTS.md verified current; no changes` if not.

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

- Step 1.6 — write `docs/WORKFLOWS.md` (four canonical loops; surface decision matrix; CLAUDE.md authoring guide with 30-line worked example; see-also pointers); cross-references added from README.md, CLAUDE.md, docs/ARCHITECTURE.md, docs/ONBOARDING.md (4 of 4 anchor docs, exceeds the 3-doc done-criterion) — 2026-05-02 — pending commit
- Step 1.5 — add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md`; section renumber + inline §-ref updates — 2026-05-02 — `010843b`
- Step 1.4 — add §"Web dashboard" to `docs/ONBOARDING.md` (open / recover URL / page tour / limitations) — 2026-05-02 — `0ffdd8d`
- Step 1.3 — refresh `apps/factory-web/README.md` (drop `(wired in 9.3)` phase ref; replace Routing stub with 10-page index) — 2026-05-02 — `30293ff`
- Step 1.2 — refresh `packages/channels/README.md` (Status reflects what's shipped; Telegram plugin + Web ≠ ChannelPlugin sections) — 2026-05-02 — `c53f8d9`

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
