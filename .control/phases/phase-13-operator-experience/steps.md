# Phase 13 Steps — Operator experience polish + carry-forward sweep

> **Sub-step 13.1 opens next.** The rest are outlines that expand once
> 13.1's investigation pins the logger bug's root cause. Per the Phase
> 12 pattern, sub-step bodies grow as each session opens.

## Phase 13 — Operator experience polish

- [x] 13.1 — **File-sink logger bug.** The Pino file sink at
      `<dataDir>/logs/factoryd-<YYYY-MM-DD>.log` does not materialise
      on disk despite `mkdirSync(logsDir, { recursive: true })` running
      during `initLogger`. Pretty-printed stdout works, so the
      multistream construction succeeds — only the file destination is
      broken. Investigate, write a regression test, fix.

      **Closed.** Root cause: `createLogger`'s auto-init fallback fired
      from transitive top-level imports (50+ `const log =
      createLogger('foo')` declarations across packages). The auto-init
      ran with `noFile: true`, so the explicit
      `initLogger({ processName: 'factoryd' })` in
      `apps/factoryd/src/main.ts:105` was a no-op against the cached
      auto-init root — file sink never built, every line tagged
      `"process":"unknown"`. Fix in `packages/logger/src/logger.ts`:
      (1) `createLogger` now returns a `Proxy` that defers child
      binding until the first log call, (2) `initLogger` replaces an
      auto-init root when called explicitly, so existing top-level
      `createLogger` references pick up the explicit root on next
      call. Regression coverage in
      `packages/logger/src/filesink-repro.test.ts`: 7 new tests
      including a subprocess driver against the dist build that
      asserts the file lands on disk and contains
      `"process":"factoryd"`. I015 moved to RESOLVED. End-to-end
      verified by running `npx tsx apps/factoryd/src/main.ts
      --foreground` against a clean `.factory/`: log file
      materialises, all lines tagged `"process":"factoryd"`.

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

- [x] 13.2 — **`factory ui-token` CLI command.** ADR 0025 §2
      carry-forward, on the list since Phase 7. Operator closes terminal
      → loses dashboard URL; restart rotates the token (lose session
      tabs). Fix: small CLI subcommand that reads the live daemon's
      currently-active `FACTORY5_UI_TOKEN` and prints the dashboard URL.

      **Closed.** Picked the dedicated-route shape over extending
      `/status` (don't leak the token from an unauthenticated route the
      SPA already uses for liveness checks). New `GET /ui-token` on the
      daemon returns `{ token, url, hasStaticBundle }`. Auth: loopback-
      only, no bearer — matches the threat model of `/status` and
      `/healthz` (the token isn't a secret from local users; it lives
      in the daemon's process env, readable via `/proc/<pid>/environ`).
      Cross-origin browser tabs that hit the route over loopback can't
      read the JSON response under the default same-origin policy.
      `url` is the factoryd-hosted dashboard URL when an SPA bundle is
      mounted, else the dev-server URL (`http://localhost:4321/app/?t=…`)
      with a hint. New CLI subcommand
      `packages/cli/src/commands/ui-token.ts` plus a `runUiToken`
      function that returns the exit code (test-friendly).
      `--token-only` prints just the bare token for env-var piping.
      Regression coverage: 5 daemon-side route tests
      (`server.test.ts`) + 7 CLI roundtrip tests
      (`commands/ui-token.test.ts`). End-to-end verified by booting
      `factoryd --foreground` and running `factory ui-token` against
      it — printed URL with the live token, exit 0; `--token-only`
      printed just the token.

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

- [x] 13.3 — **I009 fix — extract `resolveDirectiveLimits`.** Phase
      11.4 added the project-tier in CLI + daemon; Telegram + Discord
      inbound `/build` still skip two tiers. The right shape is one
      shared helper called from every directive-creation path.

      **Closed.** Helper landed in `@factory5/wiki`
      (`resolveDirectiveLimits({ explicitFlags, projectDefaults,
      configDefaults }) → DirectiveLimits | undefined`). Per-field
      independent merge with explicit > project > config precedence.
      All four directive-creation paths rewired:
      (1) `factory build` (CLI) refactored to call the helper inline;
      (2) `POST /api/v1/builds` gained the missing config-tier via new
      `IpcServerOptions.configBudgetDefaults` threaded from the
      daemon's loaded `fileConfig`; (3) Telegram inbound and (4)
      Discord inbound gained a new `resolveBuildLimits(name)` callback
      on `ChannelContext` that the daemon binds to a closure that
      loads `projectMeta` + applies the helper. Channels stay
      decoupled from `@factory5/wiki` — the daemon does the wiring.
      I009 moved to RESOLVED. Workspace 832 → 847 passing tests
      (+15 across wiki, channels, daemon). Lint + format + build clean.

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

- [x] 13.4 — **I014 fix — architect commits wiki on resume.** When
      `runArchitect` modifies tracked `docs/knowledge/*.md` files on
      a `factory resume`, the edits stay uncommitted in main and
      dirty-trip `gate.verify`. Targeted fix: stage + commit at the
      end of `runArchitect` if a git repo exists.

      **Closed.** Adopted Option 1 of I014's hypothesis (targeted
      fix in `runArchitect` only). New helper
      `commitArchitectWritesIfRepo` in `packages/brain/src/architect.ts`:
      checks `projectPath/.git` for repo presence, stages the exact
      file paths the architect wrote (not `docs/` wholesale, so
      unrelated user-pending edits stay dirty rather than being
      swept up), commits with subject "factory: architect updated wiki
      for directive ID" only when something is actually staged after
      the add, and degrades gracefully on git failure (logged warn,
      no throw). Added `simple-git` to `@factory5/brain`'s deps. 8
      unit tests cover modify-and-commit, new-page-and-commit,
      default-subject, no-op-on-identical, no-op-on-non-repo,
      no-op-on-empty-pages, graceful-degrade, and
      isolation-from-unrelated-dirty-docs. I014 moved to RESOLVED.
      Workspace 847 to 855 passing. Lint + format + build clean.

  Sub-actions:
  - In `runArchitect`, after writing the wiki pages, check
    `isGitRepo(projectPath)`; if true, run `git add docs/` + commit
    with a deterministic message (e.g. "factory: architect updated
    wiki for directive ID").
  - Use `simpleGit` (already a dep). Don't run if no changes
    (`git status --porcelain` empty after add).
  - Regression test: build a fixture, manually dirty `docs/knowledge/`
    with a stale wiki edit, run a resume, assert the tree is clean
    after architect runs.
  - Move I014's row in `docs/issues/INDEX.md` to RESOLVED.

- [x] 13.5 — **Phase close.** Tag `phase-13-operator-experience-closed`.
      `docs/Phase13_Progress.md` + `docs/PROGRESS.md` entry. Likely no
      `CompleteArchitecture.md` change (sweep phase, no new
      architectural seam) — or a small extension if 13.1's logger fix
      changes the multistream contract. Scaffold Phase 14 (carry
      forward by demand signal — most likely Bash sandboxing if a
      live incident surfaces by then, else continue paying down debt).

      **Closed.** Final gates: pnpm build / test / lint / format all
      clean; 855 tests passing across 15 packages (was 813 at Phase
      12 close; +42 from this phase). All four target carry-forwards
      RESOLVED (I009, I014, I015) plus the `factory ui-token` ADR
      0025 §2 ergonomic gap. No new ADRs (sweep phase); no
      `CompleteArchitecture.md` change (the logger Proxy + new
      `/ui-token` route + helper extraction + auto-commit are all
      below the architecture-seam threshold). Phase 14 scaffolded
      at `.control/phases/phase-14-carry-forward-continuation/`,
      themed as continuation of the carry-forward sweep with the
      stale-dist dev-loop gotcha (overdue since Phase 9) at the
      top of the candidate pool. Demand-signal-ordered.
