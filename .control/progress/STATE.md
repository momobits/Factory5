# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-02 21:30 UTC by /phase-close
**Current phase:** 2 — channel-parity
**Current step:** 2.1 — Wire Discord slash commands
**Status:** ready

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-2-channel-parity/README.md`](../phases/phase-2-channel-parity/README.md) and [`steps.md`](../phases/phase-2-channel-parity/steps.md). Step **2.1 = wire Discord slash commands** per [`../../UPGRADE/plans/tier-2-channel-parity.md`](../../UPGRADE/plans/tier-2-channel-parity.md) §2.1. New file `packages/channels/src/discord-commands.ts` (definitions + handlers); edit `packages/channels/src/discord.ts` to call `client.application.commands.set(commandList, guildId?)` on `Events.ClientReady` and register an `interactionCreate` listener. Embed-formatted responses; no LLM for the read commands (`status`/`spend`/`findings`).

---

## Git state

- **Branch:** main
- **Last commit:** `10e400a` — docs(1.8): tier-1 acceptance prep — mark U001-003/U014-017 resolved + fix orphan factory-inspect ref (the `chore(phase-1)` close commit will land on top of this when /phase-close finishes)
- **Uncommitted changes:** Phase 2 scaffold + STATE.md + next.md + journal.md (about to be committed by /phase-close)
- **Last phase tag:** `phase-1-doc-sweep-closed` (placed on commit `10e400a` by /phase-close; supersedes the legacy `phase-15-demand-driven-runoff-closed` tag from the removed v1 framework)

---

## Open blockers

- None

---

## In-flight work

None. Phase 2 has not started yet.

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

- Phase 1 (doc-sweep) closed — tag `phase-1-doc-sweep-closed` on commit `10e400a` — 2026-05-02
- Step 1.8 — tier-1 acceptance prep (mark U001-003/U014-017 resolved in UPGRADE/ISSUES.md; fix orphan factory-inspect ref in packages/logger/README.md) — 2026-05-02 — `10e400a`
- Step 1.7 — reconcile `docs/SKILLS.md` + `docs/AGENTS.md` against current code (add `ask-user` skill row; update 4 agents' Tools + Default-skills columns) — 2026-05-02 — `e75b5dd`
- Step 1.6 — write `docs/WORKFLOWS.md` (four canonical loops; surface decision matrix; CLAUDE.md authoring guide); cross-references from 4 anchor docs — 2026-05-02 — `b813037`
- Step 1.5 — add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md` — 2026-05-02 — `010843b`

---

## Attempts that didn't work (current step only)

- None yet — Step 2.1 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

## Notes for next session

Phase 2 splits into ~2 sessions per the tier plan: **2a** = slash commands + `setMyCommands` + button affordances (steps 2.1-2.3); **2b** = `factory cancel` plumbing + 8-intent triage classification (steps 2.4-2.5). Step 2.6 (`factory chat` per-turn timeout) is optional — defer to Phase 3 if the streaming-progress path wins.

Discord guild-vs-global slash-command scope decision: guild-scoped when `config.guildId` is set (instant register), global otherwise (1-hour propagation). Documented in tier-2 plan §"Risks + decisions".

Phase 2 is the first phase that touches code (packages/channels, packages/brain, packages/cli, packages/state, packages/ipc). Live-smoke against a real Discord bot + Telegram bot is part of acceptance — confirm test bots are configured (`factory doctor`) before Step 2.1 starts.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
