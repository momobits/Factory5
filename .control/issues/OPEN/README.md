# factory5 issues live under `docs/issues/`

factory5 tracks its own self-issues under [`docs/issues/`](../../../docs/issues/) with frontmatter-driven metadata (`id`, `severity`, `area`, `status`, `created`, `resolved`). The authoritative index is [`docs/issues/INDEX.md`](../../../docs/issues/INDEX.md).

**Open issues as of Control install (2026-04-21):** none. Phase 5 closed with all 7 factory5 self-issues (I001–I007) resolved.

## Why this directory is empty

factory5's issue shape predates Control. Issues are 100–200 lines each (I007 is 206 lines — Symptom with log snippets / Repro tied to a directive ID / Hypothesis with ruled-out alternatives / Resolution triple of fix-commit + regression-test + diff-summary). This depth is factory5's standing discipline.

Control's issue template is a 23-line skeleton with severity gating (`minor` = journal line only, `major`/`blocker` = file). factory5 files every issue regardless of severity.

See `CLAUDE.md` §"Control framework (operational layer)" for the full content-vs-operational split.

## If you run `/new-issue`

File at `docs/issues/INNN-<slug>.md` continuing factory5's sequence (next = I008). Update `docs/issues/INDEX.md`. Do not create files in this directory.

## This directory is reserved for

A future decision to adopt Control's severity-gated issue flow. Not planned.
