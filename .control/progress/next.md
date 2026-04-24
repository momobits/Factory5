# Next session — paste this to start

Phase 10 is 4/9 closed after a code-heavy session (2026-04-24T13): ADR 0026
accepted, Node + Go + Rust runtimes shipped, 37 new tests. Next work is
operator-triggered live validation.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase / step /
carry-forwards), then the Phase 10 charter at
`.control/phases/phase-10-assessor-tier3/README.md` and its sub-step
outline at `.control/phases/phase-10-assessor-tier3/steps.md` (10.1 / 10.2 /
10.4 / 10.6 checkboxes already flipped).

Read the four new files that ADR 0026 produced in code:

- `packages/assessor/src/types.ts` — the `Runtime` / `FailureMode` /
  `ProvisioningRecord` / `RuntimeAssessor` contract
- `packages/assessor/src/runtimes/python.ts` — thin adapter over the
  pre-ADR-0026 pytest stack (behaviourally unchanged)
- `packages/assessor/src/runtimes/node.ts` — full implementation; mirror
  it when reading Go / Rust since they follow the same pattern
- `packages/assessor/test/node-e2e.test.ts` — the one real-subprocess
  integration test (runs real `pnpm install` against a seeded tmpdir)

Skim [ADR 0026](../../docs/decisions/0026-pluggable-runtime-contract.md)
for the four sub-decisions (provisioner shape, verify-gate command
mapping, failure-mode taxonomy, host-tool pre-flight).

Run `/session-start` for the full drift check.

## Next concrete work — 10.3 (Node live validation)

This is the load-bearing test of the whole ADR-0026 design. Everything
built so far was seam-injected or single-fixture — real `factory build`
against a scaffolded Node project exercises scaffolder → builder → verifier
→ assessor.node.runGate → gate composition → findings surfacing end-to-end.

**Proposed spec:** "Build a TypeScript CLI that parses a JSON log file and
prints totals." Small enough that a green run is cheap, rich enough that
the three gate commands (pnpm install, tsc --noEmit, vitest) all engage.

**Pre-flight before kicking off the build:**

1. Make sure factoryd is running cleanly. If it was running before 10.2
   landed, restart it so the new `@factory5/assessor` dist is loaded.
2. Set a modest directive budget ceiling — $5 per-directive should be
   plenty for a ~200 LOC TS CLI. Use the `--budget` / `limits.maxUsd` flag
   or operator-config default per ADR 0020.
3. Use autonomy mode (per ADR 0005) so the build runs end-to-end without
   human gates.
4. Ensure the scaffolder propagates `spec.language: 'node'` through to
   `plan.json` — that's what `assess()`'s dispatch keys on. If the
   scaffolder hasn't learned `'node'` yet, surface as a finding and fold
   the fix into 10.8's init-picker work.

**Success signal:** directive closes `complete` with a green assessor gate
(build + integration + verify all true); `AssessResult.failureMode`
absent on final evaluation; `AssessResult.provisioning.preflight.ok`
true; spend under the ceiling; factory's build log shows the three
pipeline commands executed cleanly.

**Failure signals worth distinguishing:**

- `failureMode: 'ENV_HOST_MISSING_TOOL'` → host lacks `node` or `pnpm` on PATH
- `failureMode: 'ENV_SETUP_FAILURE'` → pnpm install failed (probably a
  broken `package.json` the scaffolder emitted)
- `failureMode: 'BUILD_FAILURE'` → typecheck failed (scaffolder generated
  code with type errors; verifier should iterate)
- `failureMode: 'TEST_FAILURE'` → tests exist and failed (the right kind
  of signal — builder has a clear iteration target)

## Then in order

**10.5 (Go live validation)** and **10.7 (Rust live validation)** follow
the same shape but need the host tools installed first:

- **Go:** `https://go.dev/dl/` → `go` on PATH
- **Rust:** `https://rustup.rs/` → `cargo` on PATH

Run `command -v go && command -v cargo` before either to confirm.

**10.8 (`factory init` language picker)** — pure code. Today the wizard
assumes Python. Add a prompt; thread selection into `spec.language` so
the assessor's dispatch picks the right runtime on first build. Python
stays the default for backwards compat with `factory5-workspace/`'s
existing Python corpus. Can land alongside 10.3 if 10.5 / 10.7 are
blocked on tool installs.

**10.9 (phase close)** — tag `phase-10-assessor-tier3-closed`, write
`docs/Phase10_Progress.md`, prepend `docs/PROGRESS.md`, extend
`CompleteArchitecture.md` with the pluggable-runtime story (likely a
new §22 or a small edit to §6 storage + §9 runtime). Scaffold Phase 11
(Web UI 9b — mutation surface: answer questions / kick off builds from
the browser).

## Carry-forward from Phase 9 (unchanged, still non-blocking)

- **Issue I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound
  doesn't inherit `[budget.defaults]`.
- **Issue I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher
  can't target a specific open question.
- **Stale-dist dev-loop gotcha** (`docs/Phase9_Progress.md` §Non-trivial
  finding) — flip `packages/{daemon,ipc,state}/package.json` `main`
  from `"./dist/index.js"` to `"./src/index.ts"`. Highest-ROI Phase 10
  cleanup item. Easy single-commit chore any session that touches those
  manifests. Now overdue; worth pairing with the 10.8 commit.
- **`factory ui-token` CLI command** (ADR 0025 §2) — operator closes
  terminal → loses dashboard URL; mitigation is restart factoryd.
- **Fastify preHandler scoped to `/api/v1/*`** — ADR 0025 §3 described a
  shared preHandler; 9.3 used inline handler-level checks. Stylistic
  refactor; effect identical.
- **Phase 6 operator follow-up:** revoke PAT at
  <https://github.com/settings/tokens>; `gh repo delete momobits/factory5-6b-smoke --yes`;
  `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

Report back on wake-up with a status block in this shape:

```
Phase 10 — 4/9 closed; 10.3 Node live validation next
Last action: feat(10.6) 0563a85 + session-end docs(state) on top
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-9-web-ui-closed
Open blockers: 0 (I009 + I012 non-blocking; 10.5/10.7 need Go/cargo install first)
Proposed next action: 10.3 — real `factory build` against a small TypeScript CLI spec
Ready to proceed?
```
