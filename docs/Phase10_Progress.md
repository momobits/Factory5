# Phase 10 — progress & roadmap

> Phase-level overview of the Phase 10 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 10
> (what's done, what "done" looked like, carry-forwards).

## Where we were, end of Phase 9

Phase 9 closed 2026-04-23 (`phase-9-web-ui-closed`) with the operator
Web UI shipped: Astro MPA + Islands at `apps/factory-web/`, five SPA
pages backed by `/api/v1/*` Fastify routes, separate `FACTORY5_UI_TOKEN`,
operator-browser smoke against the existing 25-directive `factory.db`.
**605 tests green**, 25 ADRs.

The assessor at Phase 9 close was **Python-only**. ADR 0017 had pinned
the pluggable-runtime _interface_ (`ProjectEnvProvisioner`); only the
Python implementation existed. Every recurring observation across Phase
6 / 7 / 8 live runs was the same: factory's deliverable surface is
capped at what the assessor can verify ground-truth on. Phase 10 widens
that surface to Node / Go / Rust.

## Phase 10 scope

Single-charter phase (no sub-letter split). Nine sub-steps shipped in
order; the charter and per-step detail live in
`.control/phases/phase-10-assessor-tier3/{README.md,steps.md}`.

| Step | Subject                                                                                                                   | Status         |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 10.1 | ADR 0026 — pluggable-runtime contract (provisioner shape, failure-mode taxonomy, host-tool pre-flight)                    | ✅ `d493ff9`   |
| 10.2 | Node / TypeScript runtime (`runtimes/node.ts`) + 15 seam tests + 1 real-subprocess e2e                                    | ✅ `34763dc`   |
| 10.3 | Live validation — Node end-to-end + `--language` threading + I013 + JSON-parser fix                                       | ✅ `50bab61`   |
| 10.4 | Go runtime (`runtimes/go.ts`) + 12 seam tests                                                                             | ✅ `10f2132`   |
| 10.5 | Live validation — Go end-to-end + `-v -count=1` runtime fix                                                               | ✅ `62ee979`   |
| 10.6 | Rust runtime (`runtimes/rust.ts`) + 9 seam tests                                                                          | ✅ `0563a85`   |
| 10.7 | Live validation — Rust end-to-end (clean first try)                                                                       | ✅ `8be8dc0`   |
| 10.8 | `factory init` project scaffold with language picker — `metadata.language` in `project.json`, fallback in `factory build` | ✅ `503da4d`   |
| 10.9 | Phase close (tag, docs, §22 in CompleteArchitecture, Phase 11 scaffold)                                                   | ✅ this commit |

## What "done" looked like

Three concrete live-validation runs against real specs, all gating to
`gate.verify=true` with the assessor dispatching to the matching
runtime. Spend stayed inside per-directive caps in every successful
attempt.

| Runtime | Spec                            | Tests passed | Total spend | Notes                                               |
| ------- | ------------------------------- | ------------ | ----------- | --------------------------------------------------- |
| Node    | log-totals NDJSON CLI           | 14 vitest    | $3.57       | Third attempt; first two surfaced I013 + parser bug |
| Go      | go-line-counter walker          | 34 go-test   | $5.40       | Resume needed after the `-v -count=1` fix           |
| Rust    | rust-csv-summary CSV summarizer | 7 cargo-test | $1.98       | Clean first try; no Rust-specific runtime bugs      |

## Bugs surfaced and fixed in-phase

The live runs caught three orthogonal-to-the-runtime bugs that the
seam-only Phase 10.2 / 10.4 / 10.6 tests had no way to find. All three
landed alongside their surfacing sub-step:

1. **`--language` flag threading gap** — the new ADR 0026 dispatch keys
   on `AssessOptions.runtime`, but no upstream surface was setting it.
   Every pre-fix build defaulted to `'python'`. Fixed by adding
   `--language` to `factory build`, threading through
   `directive.payload.language`, reading via `extractRuntime` in
   `brain/loop.ts`, carried across `factory resume`. (10.3 close commit.)

2. **I013 — worktree cleanup blocked by `node_modules` on Windows**.
   Workers that ran `pnpm install` inside their per-task worktree left
   a heavy `node_modules/` tree there; `git worktree remove --force`
   then failed with "Directory not empty" because git's `--force` does
   not override OS-level deletion refusals. Fixed by `prePurgeDepDirs`
   that rimrafs `node_modules` / `.venv` / `__pycache__` before the
   porcelain remove. 4 regression tests. (10.3 close commit.)

3. **`extractJsonObject` mis-counted braces inside string literals**.
   Architect responses with `{` characters inside markdown content
   (e.g. a `package.json` snippet inside a code block) failed to parse.
   Fixed by adding string-state tracking with `\\` escape handling.
   10 regression tests. (10.3 close commit.)

4. **Go runtime parser missed PASS / FAIL counts** — `go test ./...`
   default output is package-level only (`ok <pkg>`); per-test
   `--- PASS:` / `--- FAIL:` lines only appear with `-v`. Fixed by
   passing `-v -count=1` (the latter to bypass Go's test cache so the
   assessor always observes fresh subprocess output). (10.5 close commit.)

## New issue filed during validation (carry-forward)

- **I014** (MEDIUM, OPEN, `brain/architect`) — when the architect
  re-runs on an existing project (typical for `factory resume`), its
  modifications to tracked `docs/knowledge/*.md` files stay
  uncommitted in main and dirty the assessor's `gitClean` check. In
  fresh builds the issue is invisible because `ensureProjectRepo`'s
  initial commit captures architect output. Manual fix: commit before
  reassess. Targeted resolution: have `runArchitect` stage + commit at
  the end if a git repo exists.

## Helper added

- **`scripts/one-shot-assess.mjs`** — invoke `assess()` directly against
  a project path. Used to verify gate states after manual cleanup
  without re-running the full brain pipeline (~$0 vs. ~$3 for a fresh
  build). Useful for any "rerun assess after a manual fix" workflow.

## Tests at close

**666 total** (605 → +61 in Phase 10) across 14 packages:

| Package    | Count   | Δ from Phase 9 close                         |
| ---------- | ------- | -------------------------------------------- |
| core       | 14      | —                                            |
| logger     | 13      | —                                            |
| ipc        | 14      | —                                            |
| providers  | 39      | —                                            |
| state      | 134     | —                                            |
| assessor   | 79      | +37 (15 Node + 12 Go + 9 Rust + 1 Node e2e)  |
| channels   | 62      | —                                            |
| wiki       | 49      | +2 (project-metadata initialMetadata)        |
| events     | 3       | —                                            |
| worker     | 28      | +4 (I013 regressions)                        |
| brain      | 74      | +10 (extract-json regressions)               |
| daemon     | 79      | —                                            |
| cli        | 63      | +8 (build language fallback + init scaffold) |
| worker-mcp | 15      | —                                            |
| **Total**  | **666** | **+61**                                      |

`pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across all
14 packages + 3 apps (factory / factoryd / factory-web).

## Carry-forward into Phase 11

- **I009** (MEDIUM, OPEN, `channels/telegram`) — Telegram/Discord
  inbound `/build` doesn't inherit `[budget.defaults]`.
- **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion`
  FIFO matcher can't target a specific question.
- **I013** (MEDIUM, RESOLVED at 10.3) — fixed in-phase, regression test
  in worker.test.ts.
- **I014** (MEDIUM, OPEN, `brain/architect`) — new this phase; targeted
  fix is one git commit at the end of `runArchitect`.
- **Stale-dist dev-loop gotcha** (Phase 9 carry-forward) — flip
  `packages/{daemon,ipc,state}/package.json` `main` to `src/index.ts`.
  Still overdue.
- **`factory ui-token` CLI command** (ADR 0025 §2 carry-forward).
- Phase 6 operator follow-ups (PAT revoke, GitHub repo delete, env var
  cleanup) — still out-of-band.

## Phase 11 — Web UI 9b (mutation surface)

Per the Phase 10 forward queue, Phase 11 picks up the deferred
mutation-surface work from Phase 9: answering pending questions from
the browser, kicking off builds via the UI, configuring per-project
budget defaults. The Phase-9 read side demonstrated the pattern; 9b
extends `/api/v1/*` with the matching POST/PUT/DELETE routes and the
SPA pages get write affordances.

`.control/phases/phase-11-web-ui-9b/` scaffolded in this close commit.
