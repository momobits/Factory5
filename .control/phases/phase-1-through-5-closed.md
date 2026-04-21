# Phases 0–5 — closed pre-Control

These phases shipped before Control was installed on 2026-04-21. They have no `phase-<N>-closed` git tag (Control's tag convention didn't exist yet). Their arc is narrated in `docs/PROGRESS.md` (session-level) and `docs/Phase5_Progress.md` (Phase 5 arc-level).

## Summary

| Phase | Name                              | Closed      | Outcome                                                                                                                                           | Narrative                                                                                                                          |
| ----- | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Scaffold                          | 2026-04-18  | Workspace skeleton — 13 packages + 2 apps + 148 files + full doc tree                                                                             | [`docs/PROGRESS.md`](../../docs/PROGRESS.md) — first entry "2026-04-18 — Phase 0 scaffold complete"                                |
| 1     | Foundations + inline pipeline     | ~2026-04-18 | `@factory5/{core,logger,state,ipc,providers,brain}` implemented; triage → plan → build as single-shot (ADR 0006)                                  | `docs/PROGRESS.md` entries dated 2026-04-18                                                                                        |
| 2     | Tool-using worker subprocess      | 2026-04-18  | scaffolder/builder/fixer as real tool-using subprocesses; worker streams NDJSON (ADRs 0007–0009)                                                  | `docs/PROGRESS.md` entries                                                                                                         |
| 3     | Daemon + channels + assisted mode | 2026-04-18  | `factoryd` supervision; Discord channel; assisted-mode checkpoints; `ask_user` / `escalate_blocked` primitives (ADRs 0011–0015)                   | `docs/PROGRESS.md` entries                                                                                                         |
| 4     | Phase 2 finale + autonomy modes   | 2026-04-18  | Category routing (ADR 0004); autonomy-mode end-to-end; 201 tests; first live `factory build` (5/14 tasks — the run that motivated Phase 5)        | `docs/PROGRESS.md` entries; [`docs/Phase5_Progress.md`](../../docs/Phase5_Progress.md) §"Where we were, before Phase 5" summarizes |
| 5     | Green-verify end-to-end           | 2026-04-19  | Autonomous loop proven end-to-end; I001–I007 all resolved; `factory build example` fully green with `gate.verify: true`; 255 tests; **Outcome α** | Full arc: [`docs/Phase5_Progress.md`](../../docs/Phase5_Progress.md). Sub-phases 5a–5f each captured                               |

## Why this file exists

Control's `.control/phases/` convention expects one dir per phase. Retrofitting 0–5 as fake `phase-N-<name>/` directories with reconstructed step checklists would fabricate detail — those phases closed without Control's mechanical gates. This file is the navigation stub that tells readers "the closed phases are real; their history is just not in the `.control/` tree."

## Reading order for onboarding

If you need to understand what happened in Phases 0–5:

1. Skim [`CompleteArchitecture.md`](../../CompleteArchitecture.md) — the snapshot at Phase 0 close; canonical design.
2. Read [`docs/Phase5_Progress.md`](../../docs/Phase5_Progress.md) — the Phase 5 arc closes with Outcome α and summarizes what infrastructure is in place.
3. Skim [`docs/decisions/INDEX.md`](../../docs/decisions/INDEX.md) — ADRs 0001–0017 frame every architectural choice in Phases 0–5.
4. Skim [`docs/issues/INDEX.md`](../../docs/issues/INDEX.md) — "Resolved (last 20)" has all 7 Phase 4–5 self-issues.
5. `docs/PROGRESS.md` has session-level detail for any specific question.

## Rollback target for Phase 6

Since Phases 0–5 have no tag, the rollback target for the start of Phase 6c is the HEAD at Phase 5 close: commit `2a9dbd0` — "feat: add issue I003 for scaffolder project hygiene artifacts omission" (2026-04-21). `git reset --hard 2a9dbd0` reverts Phase 6 work.
