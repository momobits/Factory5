# Phase 13 Steps — Operator experience polish + carry-forward sweep

> **Sub-step 13.1 opens next.** The rest are outlines that expand once
> 13.1's investigation pins the logger bug's root cause. Per the Phase
> 12 pattern, sub-step bodies grow as each session opens.

## Phase 13 — Operator experience polish

- [ ] 13.1 — **File-sink logger bug.** The Pino file sink at
      `<dataDir>/logs/factoryd-<YYYY-MM-DD>.log` does not materialise
      on disk despite `mkdirSync(logsDir, { recursive: true })` running
      during `initLogger`. Pretty-printed stdout works, so the
      multistream construction succeeds — only the file destination is
      broken. Investigate, write a regression test, fix.

  Sub-actions:
  - File a major issue under `docs/issues/` (regression-test required
    before close per CLAUDE.md).
  - Trace `pino.destination({ dest, sync: false, mkdir: true })`
    behaviour: does the lazy file open silently swallow errors via an
    unlistened-to `'error'` event? Is the error surfaced via `multistream`?
    Reproduce in isolation with a minimal repro.
  - Fix at the right layer (likely either: attach an `'error'`
    listener to the destination stream and crash loud, or switch to
    `sync: true` / a direct `fs.createWriteStream`, depending on the
    investigation outcome).
  - Add a regression test in `@factory5/logger` that covers the
    file-sink path: `initLogger`, write a line, read the file back,
    assert the JSON line is there.
  - Update `docs/issues/INDEX.md` row when the issue lands and again
    when it closes.

- [ ] 13.2 — **`factory ui-token` CLI command.** ADR 0025 §2
      carry-forward, on the list since Phase 7. Operator closes terminal
      → loses dashboard URL; restart rotates the token (lose session
      tabs). Fix: small CLI subcommand that reads the live daemon's
      currently-active `FACTORY5_UI_TOKEN` and prints the dashboard URL.

  Sub-actions:
  - Decide where the daemon exposes the token: extend the existing
    `/status` IPC route, or add a dedicated `/ui-token` route. Pick
    based on whether we want the token in unauthenticated `/status`
    responses (probably not — keep it on a separate route that requires
    no auth but loops back to itself or requires the worker token).
  - Implement the daemon-side route in `packages/daemon/src/server.ts`.
  - Implement the CLI subcommand in `packages/cli/src/commands/`.
  - Tests: round-trip — start daemon, `factory ui-token` prints a
    valid URL whose `?t=…` resolves against `/api/v1/status`.
  - Document the new command in `packages/cli/README.md`.

- [ ] 13.3 — **I009 fix — extract `resolveDirectiveLimits`.** Phase
      11.4 added the project-tier in CLI + daemon; Telegram + Discord
      inbound `/build` still skip two tiers. The right shape is one
      shared helper called from every directive-creation path.

  Sub-actions:
  - Pick the home — `@factory5/brain` (where pre-call enforcement
    already lives) vs `@factory5/wiki` (where `budgetDefaultsFromProjectMeta`
    lives). Decide based on the existing import graph + which package
    each directive-creation path already imports.
  - Extract `resolveDirectiveLimits({ projectMeta, cfg, explicitFlags }) → DirectiveLimits`.
  - Rewire all four callers: `packages/cli/src/commands/build.ts`,
    `packages/daemon/src/server.ts` (`POST /api/v1/builds`),
    `packages/channels/src/telegram.ts` inbound `/build`,
    `packages/channels/src/discord.ts` inbound `/build`.
  - Regression test: Telegram inbound `/build` against a project with
    `metadata.budgetDefaults` set picks up the project-tier limits.
  - Move I009's row in `docs/issues/INDEX.md` to RESOLVED when the
    fix lands.

- [ ] 13.4 — **I014 fix — architect commits wiki on resume.** When
      `runArchitect` modifies tracked `docs/knowledge/*.md` files on
      a `factory resume`, the edits stay uncommitted in main and
      dirty-trip `gate.verify`. Targeted fix: stage + commit at the
      end of `runArchitect` if a git repo exists.

  Sub-actions:
  - In `runArchitect`, after writing the wiki pages, check
    `isGitRepo(projectPath)`; if true, run `git add docs/` + commit
    with a deterministic message (e.g. `factory: architect updated
wiki for directive <id>`).
  - Use `simpleGit` (already a dep). Don't run if no changes
    (`git status --porcelain` empty after add).
  - Regression test: build a fixture, manually dirty `docs/knowledge/`
    with a stale wiki edit, run a resume, assert the tree is clean
    after architect runs.
  - Move I014's row in `docs/issues/INDEX.md` to RESOLVED.

- [ ] 13.5 — **Phase close.** Tag `phase-13-operator-experience-closed`.
      `docs/Phase13_Progress.md` + `docs/PROGRESS.md` entry. Likely no
      `CompleteArchitecture.md` change (sweep phase, no new
      architectural seam) — or a small extension if 13.1's logger fix
      changes the multistream contract. Scaffold Phase 14 (carry
      forward by demand signal — most likely Bash sandboxing if a
      live incident surfaces by then, else continue paying down debt).
