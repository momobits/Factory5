# Phase 11 — progress & roadmap

> Phase-level overview of the Phase 11 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 11
> (what shipped, what "done" looked like, carry-forwards).

## Where we were, end of Phase 10

Phase 10 closed 2026-04-26 (`phase-10-assessor-tier3-closed`) with the
assessor's pluggable-runtime contract complete: Python (existing) + Node

- Go + Rust all dispatching through the same `RuntimeAssessor` shape
  under [ADR 0026](decisions/0026-pluggable-runtime-contract.md). Three
  live validation runs (Node `log-totals` $3.57 / Go `go-line-counter`
  $5.40 / Rust `rust-csv-summary` $1.98) all gated `verify = true`.
  **666 tests green**, 26 ADRs.

The Web UI at Phase 10 close was **read-only**. Phase 9 had shipped
five SPA pages backed by `/api/v1/*` GET routes
([ADR 0025](decisions/0025-web-ui-architecture.md)), but the mutation
surface (answer-a-question, kick-off-a-build, set-budget-defaults) was
deferred at Phase 9 charter time as the "9b" follow-up. Phase 11 picks
that up: complete the operator surface so the dashboard becomes a
real operating console, not just a dashboard.

## Phase 11 scope

Single-charter phase (no sub-letter split). Seven sub-steps shipped in
order; the charter and per-step detail live in
`.control/phases/phase-11-web-ui-9b/{README.md,steps.md}`.

| Step | Subject                                                                                                                                                        | Status                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 11.1 | ADR 0027 — mutation route shape, idempotency rules, error envelope, per-project budget defaults                                                                | ✅ `ea2f21c` + `2557800` (prettier reflow) |
| 11.2 | `POST /api/v1/pending-questions/:id/answer` — same answer-write path the channel collectors take, idempotent re-POST + 409 on conflicting payload              | ✅ `1a1af0e`                               |
| 11.3 | `POST /api/v1/builds` — directive-creation route mirroring `factory build <project>`, server-side `resolveProjectPath` + `loadOrCreateProjectMetadata` chain   | ✅ `dcaa0a3`                               |
| 11.4 | `PUT /api/v1/projects/:id/budget` — `metadata.budgetDefaults` writes + three-tier budget resolution (flag → project → config) in CLI and daemon both           | ✅ `3231c5c`                               |
| 11.5 | SPA write affordances — three forms, two new pages, `apiPost`/`apiPut` helpers, shared form CSS primitives, `GET /api/v1/projects` list + detail prerequisites | ✅ `08a0d63`                               |
| 11.6 | Live validation — operator-driven browser smoke against a real factoryd, all three flows verified end-to-end                                                   | ✅ `db90421`                               |
| 11.7 | Phase close (tag, this doc, PROGRESS entry, §23 in CompleteArchitecture, Phase 12 scaffold)                                                                    | ✅ this commit                             |

## What "done" looked like

Three operator-driven browser smokes against a real factoryd on
2026-04-26 (Phase 11.6), project `log-totals-cli` (a Phase 10 fixture):

| Smoke | Route                                                     | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2    | `POST /api/v1/builds` (build form)                        | Form created directive `01KQ5CRRVDT16YRP0TMDEP8PHX` with `hasLimits: false`. Brain claimed via doorbell within 1ms. Full assisted-mode arc: triage → architect → planner → pool (scaffolder + 3 builders + verifier, all `exitCode: 0`) → assessor → terminal status `blocked` (2 blocking + 4 advisory findings). Total $4.25.                                                                                                                     |
| #1    | `POST /api/v1/pending-questions/:id/answer` (answer form) | Both askUser questions raised by Smoke #2's flow were answered via the SPA textarea. Each fired `ipc: answered`; brain's askUser poll caught the answer within ~600ms each time and the directive resumed. The form path is independent of the cli-channel outbound delivery (the `outbound: abandoning` warnings are expected noise — ADR 0024 §4 + ADR 0027 §1).                                                                                  |
| #3    | `PUT /api/v1/projects/:id/budget` (budget form)           | Four PUT calls exercised set + idempotent re-save + two empty-body clear-all-defaults paths. **Propagation check**: Build #2 created via the form with no body limits logged `hasLimits: true` and `maxUsd: 50, maxSteps: 50` — sourced from the project tier alone. The `hasLimits: false` (Build #1) vs `hasLimits: true` (Build #2) contrast across an unchanged form is the load-bearing observation that proves ADR 0027 §4 budget resolution. |

The combined run cost $4.25 of LLM spend (one full directive runs to
completion plus two trivial follow-on directive creations that didn't
need to claim before the smoke was done). No SPA-side regressions
observed; the new pages render in both light and dark color-scheme via
the existing `color-mix(currentColor)` palette.

## Refactors that landed in service of the routes

Several non-trivial seams were extracted across 11.3 / 11.4 so both the
CLI and the daemon's directive-creation paths share one implementation:

1. **`languageFromProjectMeta` + `ProjectLanguage` type** moved from
   `packages/cli/src/commands/build.ts` to
   `packages/wiki/src/project-metadata.ts`. CLI test file updated to
   import from `@factory5/wiki`. Daemon's `POST /api/v1/builds` reads
   the same helper. (11.3)
2. **`projectBudgetDefaultsSchema` + `ProjectBudgetDefaults` type** added
   to `@factory5/core` to mirror `directiveLimitsSchema`. (11.4)
3. **`budgetDefaultsFromProjectMeta` + `updateProjectMetadata` + `ProjectMetadataNotFoundError`**
   added to `@factory5/wiki`. `updateProjectMetadata` is a
   read-modify-write helper for any future `metadata.*` writer; reuses
   the existing `writeFileAtomic` pattern. `ProjectMetadataNotFoundError`
   distinguishes "workspace path lost the file" 404 from
   "corrupt-but-present" 422 in the error envelope. (11.4)
4. **`InflightTask` type** re-exported from `@factory5/state` index for
   the daemon test's orphan-task path; matches the existing
   `FindingsRegistryEntry` / `SpendFilter` re-export pattern. (11.2)
5. **Three-tier budget resolution** in both code paths. CLI
   (`packages/cli/src/commands/build.ts`): `flag → project metadata →
config`. Daemon (`POST /api/v1/builds`): `body → project metadata`
   (config tier is CLI-only since the daemon doesn't load brain
   config). Per-field independent so a body-supplied `maxUsd` doesn't
   flush the project's stored `maxSteps`. (11.4)
6. **`apiPost<TReq, TRes>` / `apiPut<TReq, TRes>`** helpers added to
   `apps/factory-web/src/lib/api.ts` — JSON-encode + Content-Type +
   reuse of the existing `apiFetch` envelope unwrap. Forms switch on
   `ApiError.code` for route-specific UI. (11.5)
7. **Shared form CSS primitives** — `.form`, `.form-field`, `.btn`,
   `.btn-primary`, `.btn-danger`, `.alert--*` added to
   `apps/factory-web/src/layouts/Dashboard.astro`'s style block. Built
   on the existing `color-mix(currentColor)` palette so they auto-adapt
   to light / dark via `color-scheme`. Primary action buttons use the
   `Canvas` system color for inverted contrast. (11.5)
8. **`readProjectMetadata` consumer in the daemon** — load-only variant
   used by `GET /api/v1/projects/:id` so the read path doesn't
   accidentally create a new metadata file via the load-or-create
   helper. (11.5)

## Bugs surfaced and fixed in-phase

None. Every sub-step landed first-try plus a single prettier reflow
each (cosmetic, no logic touched). The only mid-phase noise was the
pre-existing `packages/daemon/src/pidfile.test.ts > pidfile > reaps a
stale pidfile (dead owner)` flake under parallel test load on Windows;
passed on retry and in isolation, not from 11.x changes.

## Carry-forwards (still non-blocking)

- **I009** (MEDIUM, OPEN, `channels/telegram`) — Telegram / Discord
  inbound `/build` doesn't inherit `[budget.defaults]`. After 11.4 it
  also doesn't inherit project-tier `metadata.budgetDefaults` — two
  tiers skipped instead of one. The right fix extracts a shared
  `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)` helper in
  `@factory5/brain` or `@factory5/wiki` so every directive-creation
  path runs the same three-tier resolution. Recorded as ADR 0027 §4
  carry-forward.
- **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion`
  FIFO matcher can't target a specific open question.
- **I014** (MEDIUM, OPEN, `brain/architect`) — architect re-running on
  an existing project leaves wiki edits uncommitted, dirty-tripping
  `gate.verify`. Targeted fix: stage + commit at end of `runArchitect`
  if a git repo exists.
- **Stale-dist dev-loop gotcha** — Phase 9's recommended one-line fix
  (flip workspace `main` from `dist/index.js` to `src/index.ts`) is
  incompatible with the prod runtime path (raw `node dist/main.js`
  fails on `.js`-extension imports against `.ts` source). Bundling
  workspace deps via `noExternal: [/^@factory5\//]` then breaks on
  transitive npm deps not declared in the app's package.json. Needs
  design (conditional exports + `--conditions=development`, OR
  app-side bundling with full transitive npm deps declared as direct).
  Workaround: `pnpm build` after editing workspace deps before running
  `pnpm factoryd`.
- **`factory ui-token` CLI command** (ADR 0025 §2 carry-forward) —
  operator closes terminal → loses dashboard URL. Ergonomic
  follow-up; `factory ui-token` command would re-mint and print.
- **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env
  var cleanup. Out-of-band.

## Decisions captured

One new ADR this phase. **ADR 0027** — Web UI mutation surface
(2026-04-26, Accepted, ~280 lines). Five sub-decisions in one ADR
following the multi-decision shape established by ADRs 0024 / 0025 /
0026:

1. **HTTP verbs + URL shapes per route.** Answer is action-on-resource
   (`POST …/:id/answer`, not partial PUT — posting an answer triggers
   downstream side effects). Build is top-level collection
   (`POST /api/v1/builds`, not nested under project; mirrors `factory
build <name>`). Budget is full-doc PUT (not PATCH; rejected the
   `{maxUsd: null}` ambiguity).
2. **Idempotency rules.** Answer same-payload no-op + different-payload
   409 with original preserved. Build NOT idempotent (each POST mints a
   new directive; SPA submit-disable handles double-click — no
   client-supplied `Idempotency-Key` header). Budget naturally
   idempotent via PUT replacement.
3. **Error envelope.** Reuse existing `ipcErrorSchema` (`{error: {code,
message, details?}}`); pinned six new mutation codes. Considered +
   rejected separate codes for `QUESTION_ANSWER_EMPTY` /
   `INVALID_LANGUAGE` / `INVALID_BUDGET` — those collapse into
   `SCHEMA_VALIDATION_FAILED` via Zod with the field path in `details`.
4. **`metadata.budgetDefaults` shape.** Mirrors `directiveLimitsSchema`,
   lives under ADR 0021's `metadata` extension point — same slot as
   10.8's `metadata.language` (no schema migration, no top-level
   promotion).
5. **Auth.** Same `FACTORY5_UI_TOKEN` bearer as reads; no
   weaker / stronger check on mutations; CSRF out of scope per
   loopback-only design (ADR 0025).

All 27 ADRs live under `docs/decisions/`.

## Tests at close

**717 total** (666 → +51 in Phase 11) across 14 packages:

| Package    | Count | Δ from Phase 10 close                                                                                                     |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| core       | 14    | —                                                                                                                         |
| logger     | 13    | —                                                                                                                         |
| ipc        | 14    | —                                                                                                                         |
| providers  | 39    | —                                                                                                                         |
| state      | 134   | —                                                                                                                         |
| assessor   | 79    | —                                                                                                                         |
| channels   | 62    | —                                                                                                                         |
| wiki       | 58    | +9 (11.4 — 5 `budgetDefaultsFromProjectMeta` + 4 `updateProjectMetadata`)                                                 |
| events     | 3     | —                                                                                                                         |
| worker     | 28    | —                                                                                                                         |
| brain      | 74    | —                                                                                                                         |
| daemon     | 121   | +42 (9 from 11.2 answer route + 11 from 11.3 build route + 12 from 11.4 budget route + 10 from 11.5 GET /projects routes) |
| cli        | 63    | —                                                                                                                         |
| worker-mcp | 15    | —                                                                                                                         |

`pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14
packages + 3 apps. **Total spend on Phase 11**: $4.25 (all from the
single live validation run; the seven backend / SPA sub-steps
themselves were $0 — TypeScript / Markdown / schema work only).

## Memory updates

- New: `feedback_use_frontend_design_skill.md` — standing rule that the
  operator wants the `frontend-design` skill invoked BEFORE
  hand-rolling Astro markup or form designs in this repo. Applied at
  11.5; the skill drove the design + form primitives.

## Phase 12 kicks off — Worker filesystem-scoping

Phase 12 picks up the Phase 8 carry-forward "filesystem scoping" plus
the broader concern that emerged across Phase 6c / 7 / 10 live runs:
worker subprocesses today run with unconstrained Read / Glob / Grep
tools, which means a worker can read `node_modules/` from the factory5
checkout, neighbouring projects, or `~/.ssh/` — anywhere the host user
has read access. The verifier hallucination from Phase 6c (F001) and
the I013 worktree-cleanup pain on Phase 10 were both downstream
consequences of the same root cause: workers see too much.

Phase 12 will scope the worker's filesystem view to its active
worktree + `.factory/` + template dirs only. Charter and per-sub-step
detail seeded in `.control/phases/phase-12-worker-fs-scoping/{README.md,steps.md}`.

Estimated 2–3 sessions: 12.1 ADR (whitelist contract — gate at MCP
layer vs subprocess layer; cwd-relative vs absolute prefix; out-of-scope
behaviour); 12.2 implementation; 12.3 regression test; 12.4 live
validation against a built project; 12.5 phase close.
