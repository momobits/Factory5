# UPGRADE — factory5 first-class roadmap

This directory holds the audit, plans, log, issues, and specs for the work to take factory5 from "v1, working" to first-class. It is the persistent workspace that any session can pick up from.

## How to use this directory

**Starting a session:**

1. Read [`LOG.md`](LOG.md) — most recent entry tells you the handoff state.
2. Read [`ROADMAP.md`](ROADMAP.md) — four-tier plan with current status. Tier order is dependency-aware.
3. Open the matching plan in [`plans/`](plans) — concrete sub-tasks, file pointers, acceptance criteria.
4. Skim [`ISSUES.md`](ISSUES.md) for anything that might block the chosen work.

**During work:**

- When you discover something that needs to be tracked but isn't part of the current task, append to [`ISSUES.md`](ISSUES.md) under "Open".
- When an upgrade requires pinning a new contract (e.g. SSE event shape, Discord slash command grammar, project.json migration), add it under [`specs/`](specs) and link it from the plan.

**Ending a session:**

- Append a new section at the top of [`LOG.md`](LOG.md) with: date, what shipped, what was decided, what's next.
- Tick checkboxes in [`ROADMAP.md`](ROADMAP.md) and the relevant plan.
- Move resolved issues in [`ISSUES.md`](ISSUES.md) to the "Resolved" section with a date.

## Files in this directory

| File                       | Purpose                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| [`README.md`](README.md)   | This file — how to use the workspace                                         |
| [`AUDIT.md`](AUDIT.md)     | Frozen findings from 2026-05-02 — the "where are improvements needed" report |
| [`ROADMAP.md`](ROADMAP.md) | Four-tier upgrade plan with status checkboxes                                |
| [`LOG.md`](LOG.md)         | Session-by-session handoff log (append-only, newest at top)                  |
| [`ISSUES.md`](ISSUES.md)   | Open + resolved issues discovered during upgrade work                        |
| [`plans/`](plans)          | One implementation plan per tier — pickable cold                             |
| [`specs/`](specs)          | Contract pins required by upgrade tiers                                      |

## Conventions

- **Control orchestrates execution; this directory holds the content.** The Control framework (`.control/`) provides the operational layer — cursor in `STATE.md`, phase gating, slash commands, hooks. Per-tier work in [`ROADMAP.md`](ROADMAP.md) maps onto Control phases under `.control/phases/phase-N-<name>/`. See [`../CLAUDE.md`](../CLAUDE.md) "Control framework" section for the session-start protocol; this directory holds the audit/roadmap/plans/log/issues that those phases iterate over.
- Code-side discipline still applies (see `CLAUDE.md` at the repo root): no `console.log`, no `any`, all four `pnpm` gates clean (`build`, `test`, `lint`, `format:check`) before declaring work done.
- ADRs (`docs/decisions/`) remain the canonical "why" record. If a tier introduces a new architectural decision, write an ADR in addition to any spec under [`specs/`](specs). Specs pin shapes; ADRs explain rationale.
