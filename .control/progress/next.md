# Next session — paste this to start

Phase 12 closed 2026-04-26 (tag `phase-12-worker-fs-scoping-closed`).
All 5 sub-steps shipped: ADR 0028 + new 15th workspace package
`@factory5/worker-sandbox` + worker wiring + 96 new regression tests +
operator-driven live validation. Three forcing functions paid down with
one mechanism: F001 (Phase 6c verifier hallucination), Phase 8's
deferred fs-scoping, Phase 10's I013 worktree-cleanup pain.

Live validation datapoint (12.4): `factory build log-totals-cli`,
directive `01KQ5PNR3GYMCW48NBWVZQE75W`, 5/5 tasks succeeded, 4
`worker.sandbox: gate up` lines, **zero deny lines**, $3.07 spend.
One builder advanced base from `aa3a1263 → 0d4dcbc3` with 1 file
changed under the gate — write-side gate is permissive within scope.

Workspace: 813 tests green across 15 packages. lint + format clean.
Builds clean across 15 packages + 3 apps.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase /
step / carry-forwards), then the Phase 13 charter at
`.control/phases/phase-13-operator-experience/{README.md,steps.md}`.
The `README.md` lays out the four-fix sweep: file-sink logger bug
(13.1), `factory ui-token` CLI (13.2), I009 fix (13.3), I014 fix
(13.4). All four are TS work, $0 spend baseline (optional cheap
smoke after 13.3).

Run `/session-start` for the full drift check.

## Next concrete work — 13.1 (File-sink logger bug)

Discovered during 12.4 operator investigation: the daemon writes
pretty-printed log lines to stdout (visible in the foreground
factoryd terminal) but the file sink at
`<dataDir>/logs/factoryd-<YYYY-MM-DD>.log` does not materialise on
disk. `mkdirSync(logsDir, { recursive: true })` runs during
`initLogger` (no exception bubbles up — daemon starts cleanly), but
the directory + file never appear. `find` across `~/.factory`,
`~/.factory5`, repo `.factory/`, and AppData all turn up empty.

Three sub-actions:

1. **File a major issue under `docs/issues/`.** Per CLAUDE.md issue
   lifecycle: major issues need a regression test before they go to
   RESOLVED. Title something like `I0XX-file-sink-logger-silent-fail.md`
   with frontmatter (status: OPEN, severity: MAJOR, component:
   `@factory5/logger`). Reference `packages/logger/src/logger.ts`
   `initLogger` + the `pino.destination({ dest, sync: false, mkdir: true })`
   call site. Update `docs/issues/INDEX.md`.

2. **Reproduce + diagnose.** Trace
   `pino.destination({ sync: false, mkdir: true })` behaviour:
   - Is the lazy file open silently swallowing errors via an
     unlistened-to `'error'` event on the destination stream?
   - Is `mkdirSync` running but with a wrong `dir` value at module-init
     vs spawn-time cwd resolution?
   - Does `multistream` suppress per-stream errors so the broken file
     destination is silently skipped?

   Build a minimal in-isolation repro (small `.test.ts` that calls
   `initLogger`, writes a line, asserts the file exists). Iterate
   until the failure is deterministic.

3. **Fix at the right layer + add a regression test.** Likely options:
   - Attach an `'error'` listener to the destination stream that
     re-throws / surfaces via `multistream`.
   - Switch the file sink to `sync: true` / a direct
     `fs.createWriteStream` if pino's lazy-open semantics aren't
     compatible with our `mkdirSync` ordering.
   - Move the `mkdirSync` to be inside the destination construction
     guard so it always runs immediately before the open.

   The regression test in `packages/logger/src/logger.test.ts` (or
   a new file): `initLogger`, write a known line, read the file from
   disk, assert the JSON line is there. Cross-platform-safe (use
   `tmpdir()` + `mkdtemp` per the existing test patterns).

Output: an issue file, a regression test, a fix in `@factory5/logger`,
a passing test. INDEX row moves to RESOLVED at the close.

## Then in order

**13.2 — `factory ui-token` CLI command.** ADR 0025 §2 carry-forward;
on the list since Phase 7. Operator just hit this during 12.4 (token
rotates per startup, terminal scrollback is the only recovery, no
CLI command to surface the live token). Add a small subcommand
`packages/cli/src/commands/ui-token.ts` that hits a daemon route
and prints the URL with token. Decide at 13.2 open whether to extend
`/status` or add a dedicated `/ui-token` route.

**13.3 — I009 fix — extract `resolveDirectiveLimits`.** Phase 11.4
landed the project-tier in CLI + daemon; Telegram + Discord inbound
`/build` still skip two tiers. Extract one shared helper called from
every directive-creation path. Decide between `@factory5/brain` and
`@factory5/wiki` based on the existing import graph. Regression test:
Telegram inbound `/build` against a project with stored
`metadata.budgetDefaults` picks up the project-tier limits.

**13.4 — I014 fix — architect commits wiki on resume.** When
`runArchitect` re-runs on an existing project (typical for
`factory resume`), tracked `docs/knowledge/*.md` edits stay
uncommitted in main and dirty-trip `gate.verify`. Targeted fix:
stage + commit at the end of `runArchitect` if `isGitRepo`. Use
`simpleGit` (already a dep). Regression test: build a fixture, dirty
`docs/knowledge/`, run a resume, assert tree clean post-architect.

**13.5 — Phase close.** Tag `phase-13-operator-experience-closed`.
Author `docs/Phase13_Progress.md`, prepend `docs/PROGRESS.md`. Likely
no `CompleteArchitecture.md` change (sweep phase, no new
architectural seam) — unless 13.1's logger fix changes the
multistream contract. Scaffold Phase 14 by demand signal (Bash
sandboxing if a real incident materialised, else continue paying
down debt).

## Mid-phase opportunities

If a session lands in any of the four touched seams, two carry-forwards
are one-commit wins:

- **PowerShell em-dash mojibake** — adjust log messages to use ASCII
  `--` instead of UTF-8 `—`, OR document the
  `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` fix in
  the project README. Operator-side, but a one-line README addition
  would help future operators.
- **14 stale "open" pending_questions** — one-shot DB sweep:
  `UPDATE pending_questions SET status = 'orphaned' WHERE created_at < <90-days-ago> AND answered_at IS NULL`. Maybe expose as
  `factory questions cleanup --orphaned --since <date>`.

## Carry-forward (still non-blocking)

- **File-sink logger bug** (MAJOR, OPEN) — handled in 13.1.
- **`factory ui-token` CLI command** (MEDIUM, OPEN) — handled in 13.2.
- **I009** (MEDIUM, OPEN) — handled in 13.3.
- **I014** (MEDIUM, OPEN) — handled in 13.4.
- **I012** (LOW, OPEN) — Telegram inbound FIFO matcher.
- **14 stale "open" pending_questions** (LOW) — DB sweep.
- **PowerShell em-dash mojibake** (LOW) — operator-side fix.
- **Stale-dist dev-loop gotcha** — needs design.
- **Phase 6 operator follow-up** — out-of-band.

Report back on wake-up with a status block in this shape:

```
Phase 13 — 0/5 closed; 13.1 file-sink logger bug next
Last action: chore(phase-12) <SHA> (close + tag) on top of docs(12.4) 09b0876 (live validation)
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-12-worker-fs-scoping-closed
Open blockers: 0 (file-sink-logger MAJOR + 3× MEDIUM carry-forwards all sweep targets, not blockers)
Proposed next action: 13.1 — file the issue, write a regression test, fix the logger
Ready to proceed?
```
