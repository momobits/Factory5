# Phase 12 — progress & roadmap

> Phase-level overview of the Phase 12 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 12
> (what shipped, what "done" looked like, carry-forwards).

## Where we were, end of Phase 11

Phase 11 closed 2026-04-26 (`phase-11-web-ui-9b-closed`) with the Web UI mutation surface complete: three new routes (`POST /api/v1/pending-questions/:id/answer`, `POST /api/v1/builds`, `PUT /api/v1/projects/:id/budget`), three SPA forms, and three-tier budget resolution (flag → project → config) [ADR 0027](decisions/0027-web-ui-mutation-surface.md). The dashboard became a real operating console. **717 tests green**, 27 ADRs.

The worker subprocess at Phase 11 close still spawned `claude` with `allowedTools: ['Read','Write','Edit','Bash','Glob','Grep']` and `--dangerously-skip-permissions` — host-wide filesystem access. Three forcing functions had been accumulating against this:

- **F001** — Phase 6c verifier hallucination. ADR 0018 demoted the verifier to advisory as an interim mitigation; the underlying cause (worker fs view includes irrelevant repo-internal files) remained.
- **Phase 8 carry-forward.** ADR 0024 explicitly noted the worker still has full fs access and deferred the scoping question.
- **Phase 10 I013** — `git worktree remove --force` failed on Windows because workers polluted their worktrees with `node_modules/` from outside the worktree.

Phase 12's charter pays down all three with one path-prefix gate.

## Phase 12 scope

Single-charter phase (no sub-letter split). Five sub-steps shipped in order; the charter and per-step detail live in `.control/phases/phase-12-worker-fs-scoping/{README.md,steps.md}`.

| Step | Subject                                                                                                                                                  | Status         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 12.1 | ADR 0028 — gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope                                                   | ✅ `452db47`   |
| 12.2 | Implementation — new package `@factory5/worker-sandbox` + worker wiring + `permissionMode: 'acceptEdits'` mode-shift + `FACTORY5_DISABLE_WORKER_SANDBOX` | ✅ `fab1327`   |
| 12.3 | Regression tests — 96 new tests across `worker-sandbox` + `worker` (path algebra, F001 replay, cross-platform out-of-scope, hook contract, integration)  | ✅ `1f070f9`   |
| 12.4 | Live validation — operator-driven `factory build log-totals-cli` end-to-end under the new gate                                                           | ✅ `09b0876`   |
| 12.5 | Phase close (tag, this doc, PROGRESS entry, §24 in CompleteArchitecture, Phase 13 scaffold)                                                              | ✅ this commit |

## What "done" looked like

Operator-driven `factory build log-totals-cli` on 2026-04-26 (Phase 12.4), directive `01KQ5PNR3GYMCW48NBWVZQE75W`, against a real factoryd under the new gate:

| Datapoint                       | Pre-Phase-12 (11.6 baseline)                    | Phase 12.4                                                                                |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Spend                           | $4.25                                           | $3.07                                                                                     |
| Tasks                           | 5/5 succeeded                                   | 5/5 succeeded                                                                             |
| Terminal status                 | blocked (2 blocking + 4 advisory)               | blocked (4 blocking + 4 advisory)                                                         |
| `worker.sandbox: gate up` lines | 0 (gate did not exist)                          | 4 (scaffolder + 3 builders, each with its own settings.local.json)                        |
| `decision":"deny"` lines        | n/a                                             | **0** — LLM never reached out of scope                                                    |
| Worktree cleanup failures       | 0                                               | 0 (verified post-build: `.factory/worktrees/` is empty on disk; no stray `.claude/` dirs) |
| Verifier path                   | unchanged                                       | unchanged (`provider.call()`, no sandbox config; ADR 0028 §5 deliberate)                  |
| Builder write demonstration     | builder advanced base from one HEAD to the next | builder `4p8pb1j2` advanced base `aa3a1263 → 0d4dcbc3` with 1 file changed under the gate |

The build was a Python project (`log-totals-cli` is a Python fixture; `assessor-env` lives at project-level `.factory/assessor-env` per ADR 0017), so node_modules-in-worktree wasn't directly exercised. The clean worktree cleanups across all 4 tool-using tasks are sufficient evidence that the gate doesn't break the merge flow — paying down I013's surface even if not the literal node_modules path.

The "blocked" terminal status is the same shape Phase 11.6 produced on the same project — the verify gate fails because there are no real tests; not a sandbox-induced failure.

## Architecture decision

**[ADR 0028](decisions/0028-worker-sandbox-contract.md)** — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope. Five sub-decisions in one ADR (mirrors the 0024/0025/0026/0027 multi-part shape):

1. **Gate site.** Three Claude Code-native primitives layered per-spawn, no MCP middleware (Claude Code's MCP layer adds new tools; cannot intercept built-in `Read`/`Write`/`Edit`/`Bash`/`Glob`/`Grep`), no OS sandbox (heaviest, hardest to make cross-platform). Static `permissions.deny` in `<worktree>/.claude/settings.local.json` for obvious danger zones; a `PreToolUse` hook (small Node script) for the affirmative path-prefix algebra; `--permission-mode acceptEdits` replacing `--dangerously-skip-permissions`. Pre-decision survey of Claude Code drove §1: MCP servers cannot wrap built-ins.
2. **Path-prefix algebra.** `{ workspaceRoots, readOnlyRoots, allowSymlinks }`. Cross-platform: Windows case-insensitive prefix, separator normalisation, drive letters, UNC paths, `..` traversal, symlink rejection (`lstatSync`).
3. **Out-of-scope behaviour.** Hard error via `permissionDecision: "deny"` with reason naming allowed roots (deliberately not deny rules — no evasion hints). Hook + static-deny layers compose (deny rules absolute; hook handles affirmative). Fail-closed on hook crash.
4. **Bash story.** Accepted as Phase 12 limitation. cwd pinning (already present) + small static command-pattern denies are heuristic and leaky. OS-level Bash sandboxing deferred to Phase 13+ if a real incident surfaces.
5. **Write-vs-read scope.** Explicit asymmetry. Writes scoped to `workspaceRoots` only (the worktree); reads scoped to `workspaceRoots ∪ readOnlyRoots` (worktree + project `.factory` + repo templates).

## Implementation footprint

| Component                                   | Change                                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/worker-sandbox/` (NEW)            | 15th workspace package. Public API: `WorkerSandboxConfig`, `evaluateToolCall`, `pathInsideAny`, `writeWorktreeSandbox`, `getHookScriptPath`, `runHook`, `parseSandboxConfig`. Hook script entry at `dist/hook-runtime.js`.    |
| `packages/worker/src/run-worker.ts`         | New `prepareSandbox` helper called between worktree allocation and `provider.stream`. Switches `permissionMode` from `'bypassPermissions'` → `'acceptEdits'` when sandbox up. Cleanup `rm -rf <worktree>/.claude` in finally. |
| `packages/worker/package.json`              | Adds `@factory5/worker-sandbox` dep.                                                                                                                                                                                          |
| `FACTORY5_DISABLE_WORKER_SANDBOX=1` env var | Operator escape hatch — short-circuits to pre-Phase-12 path (`bypassPermissions`). For 12.4 A/B + emergency rollback.                                                                                                         |
| `worker.sandbox` logger channel             | New `createLogger('worker.sandbox')` for gate-up + cleanup-failure events. Hook subprocess emits structured stderr audit lines.                                                                                               |
| Per-spawn artefacts                         | `<worktree>/.claude/settings.local.json` + `<worktree>/.claude/factory5-sandbox-config.json` written before spawn; `rm -rf <worktree>/.claude` in worker finally so the per-spawn config never bleeds into `git add -A`.      |

Slight deviation from ADR 0028's implementation outline: the worker (not the provider) calls `writeWorktreeSandbox`, so `@factory5/providers` stays LLM-agnostic and `ProviderRequest.sandbox?` was not added. Same gate contract, less coupling. Documented in the 12.2 commit body.

## Cross-platform verification

The path-prefix algebra (`pathInsideAny` + `normaliseForCompare`) is unit-tested against the matrix in ADR 0028 §2: Windows case-insensitive vs Linux byte-equal, separator normalisation (`\` ↔ `/`), drive-letter case, `..` traversal, UNC paths, trailing-slash insensitivity, symlink rejection. Tests with Windows-only assertions skip on Linux runners and vice versa via `describe.skipIf`. 96 new tests total across two packages: 89 in `worker-sandbox` (86 passed, 3 Linux-only skips on the Windows host that ran 12.3) + 10 in `worker` (sandbox-integration: kill switch, happy path, claudeDir layout).

## Forcing functions paid down

| Forcing function                           | Status                                           | Evidence from 12.4                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F001** (Phase 6c verifier hallucination) | Underlying cause removed (worker fs view scoped) | Verifier saw `provider.call()` text only — never asks for fs reads — but the _worker-side_ truth that fed it is now sandbox-bounded. Re-promotion of the verifier from advisory is a separate decision. |
| **Phase 8 carry-forward** (worker fs)      | Closed                                           | `worker.sandbox: gate up` line per task; `permissionMode: acceptEdits` replaces the previous `bypassPermissions`; deny-rules + hook-allowlist enforced.                                                 |
| **Phase 10 I013** (worktree-cleanup pain)  | Surface paid down                                | `worktree: merged and removed` clean for every task; no `Directory not empty`; `.factory/worktrees/` empty on disk post-build.                                                                          |

## Tests at close

**813 tests green** across 15 packages (was 717 across 14). +96 from 12.3:

- `worker-sandbox` (NEW): 86 passed + 3 skipped (Linux-only on Windows runner) = 89 total
- `worker`: 28 → 38 (+10 sandbox-integration)
- All other packages: unchanged

`pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.

## Carry-forward — discovered or amplified during Phase 12

| Item                                             | Severity | Origin                  | Notes                                                                                                                                                                      |
| ------------------------------------------------ | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File-sink logger silently failing**            | MAJOR    | 12.4 operator discovery | `<dataDir>/logs/factoryd-*.log` doesn't materialise despite `mkdirSync` running. Pretty-printed stdout works; only the file sink is broken. Phase 13.1.                    |
| **`factory ui-token` CLI command**               | MEDIUM   | ADR 0025 §2 (Phase 7+)  | Operator closes terminal → loses dashboard URL; per-startup token rotation means restart loses sessions. Phase 13.2.                                                       |
| **I009** — Telegram/Discord `/build` budget tier | MEDIUM   | Phase 11 carry-forward  | After 11.4 it skips two tiers (project + config) instead of one. The right fix extracts a shared `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)`. Phase 13.3.    |
| **I014** — architect-on-resume dirty tree        | MEDIUM   | Phase 10 carry-forward  | Architect re-runs leave tracked wiki edits uncommitted; `gate.verify` dirty-trips. Targeted fix: stage + commit at end of `runArchitect` if a git repo exists. Phase 13.4. |
| **PowerShell em-dash mojibake**                  | LOW      | 12.4 operator discovery | Console codepage decodes UTF-8 em-dashes as Windows-1252 (`ΓÇö`). Operator-side fix: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`. Not a factory5 bug.       |
| **14 stale "open" pending_questions**            | LOW      | 12.4 operator discovery | Cleanup chore — orphaned escalations from older directives that completed without anyone answering. Not blocking; one-shot DB sweep when convenient.                       |
| **Stale-dist dev-loop gotcha**                   | LOW      | Phase 9 carry-forward   | `pnpm build` after editing workspace deps before `pnpm factoryd`. Conditional exports + `--conditions=development` design pending.                                         |
| **I012** — askUser FIFO matcher                  | LOW      | Phase 8 carry-forward   | Telegram inbound's `maybeAnswerPendingQuestion` can't target a specific open question.                                                                                     |
| **Phase 6 operator follow-ups**                  | LOW      | Out-of-band             | PAT revoke, `gh repo delete`, env var cleanup.                                                                                                                             |

## Out of scope, deferred

- **Bash sandboxing** — Phase 12 charter explicitly accepted as a limitation. cwd pinning + small command-pattern denies are heuristic. Real OS-level Bash isolation (chroot / Linux namespace / Job Object / sandbox-exec) deferred to a follow-up phase if a real incident materialises (a verifier `cat ~/.ssh/id_rsa` event, a worker exfiltrating a token via `curl`, etc.). 12.4 produced **zero** sandbox denies, so demand signal is currently absent.
- **Network egress scoping** — long-tail concern; today workers reach npm / crates.io / etc. for legitimate dep installs. Wait for an egress-policy demand signal.
- **`allowSymlinks: true` with target-prefix recheck** — `pnpm install` (default) creates a symlink farm. 12.4 ran on a Python project so didn't exercise this; if a Node fixture surfaces the friction, the contract field is in place — flip the default + add the recheck.

## Where we are heading

**Phase 13 — Operator experience polish.** Charter scaffolded at `.control/phases/phase-13-operator-experience/`. Five sub-steps addressing the carry-forward debt that the operator just hit during 12.4 plus the older Phase 10/11 follow-ups: 13.1 file-sink logger fix → 13.2 `factory ui-token` CLI → 13.3 I009 (`resolveDirectiveLimits` extraction) → 13.4 I014 (architect commits wiki on resume) → 13.5 phase close. Estimated ~2-3 sessions; mostly TS work, no live-LLM spend except optional smoke-runs.
