# Phase 14 Steps — Carry-forward continuation + ergonomics

> **Sub-step 14.1 opens next.** Subjects below are placeholders. Each
> sub-step body grows when its session opens — bound to whichever
> carry-forward is biting the operator at that moment.

## Phase 14 — Carry-forward continuation + ergonomics

- [x] 14.1 — **Stale-dist dev-loop gotcha (overdue since Phase 9).**
      Conditional exports + `tsx --conditions=development`: each
      `packages/*/package.json` adds `"development": "./src/<entry>.ts"`
      to its `exports` map; root `pnpm factoryd` / `pnpm factory` and
      each app's `dev` script pass `--conditions=development` so dev
      runs route to source. Prod path (`node dist/main.js`) unchanged.
      Verified: factoryd boots cleanly with `packages/daemon/dist/`
      removed; same boot fails with `ERR_MODULE_NOT_FOUND` when the
      flag is absent. 855 tests still green.

- [x] 14.2 — **I013 status re-read → RESOLVED (paid down by Phase
      10.3).** Code re-read confirmed `prePurgeDepDirs` lives at
      `packages/worker/src/worktree.ts:375` and is invoked by
      `cleanupWorktree` at line 358 (before `git worktree remove --force`).
      Regression test at `worktree.test.ts:138` covers the
      node_modules-leak scenario; cross-runtime concern handled (`.venv`
      and `__pycache__` purged alongside). Issue file moved to
      `status: RESOLVED, resolved: 2026-04-24`; INDEX row moved from
      Open to Resolved.

- [x] 14.3 — **I012 — Telegram Reply-feature matcher pinned to specific
      question.** Migration 008 adds `pending_questions.bot_message_id`
      (nullable, indexed); the outbound worker stamps the provider's
      message id onto the linked question after successful delivery
      (when `metadata.questionId` is set). Telegram matcher now prefers
      the exact `bot_message_id = ?` rung when an inbound reply
      includes `reply_to_message.message_id`; falls through to the
      legacy `channel_ref` / `LIKE` rungs for un-stamped rows. Four
      regression tests across telegram, outbound-worker, and
      pending-questions queries.

- [x] 14.4 — **Pending-questions orphan sweep CLI plus Windows
      mojibake README addendum.** New `findOrphaned` /
      `markOrphanAnswered` helpers in `pendingQuestions` (channel-
      and since-aware, oldest-first; idempotent answered-row guard).
      A `factory questions cleanup` command (with `--since` and
      `--dry-run` flags) lists orphans and stamps each with a
      self-describing synthetic note when not in dry-run. Twelve
      regression tests across state and CLI. README gains a "Windows
      operator tips" subsection pointing at the UTF-8 console encoding
      fix for PowerShell 5.1 em-dash mojibake.

- [x] 14.5 — **Phase close.** Tag
      `phase-14-carry-forward-continuation-closed`. Author
      `docs/Phase14_Progress.md`, prepend a Phase 14 entry to
      `docs/PROGRESS.md`. No `CompleteArchitecture.md` change
      (sweep phase, as predicted). Scaffolded Phase 15 — Demand-
      driven runoff — at
      `.control/phases/phase-15-demand-driven-runoff/`. Phase 15 is
      pending demand signal; opens when something bites.
