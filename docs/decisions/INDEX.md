# Architecture Decision Records

Decisions are append-only. To overturn a decision, write a new ADR with `Supersedes: NNNN` in its header and update the superseded ADR's status.

## Status legend

- **Accepted** — current
- **Superseded by NNNN** — replaced; see linked ADR
- **Deprecated** — no longer applies; not replaced

## Records

| ID                                                       | Title                                                                                                                               | Status                           | Date       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------- |
| [0001](0001-typescript-on-node.md)                       | TypeScript on Node 20+ as the implementation language                                                                               | Accepted                         | 2026-04-18 |
| [0002](0002-two-binary-split.md)                         | Two binaries — `factory` (CLI + brain) and `factoryd` (daemon) — separated from day 1                                               | Accepted                         | 2026-04-18 |
| [0003](0003-sqlite-and-files-hybrid-storage.md)          | Files for project state, SQLite for factory runtime state                                                                           | Accepted                         | 2026-04-18 |
| [0004](0004-category-based-model-routing.md)             | Category-based model routing (declare intent, not agent)                                                                            | Accepted                         | 2026-04-18 |
| [0005](0005-three-autonomy-modes.md)                     | Three autonomy modes: chat / assisted / autonomous, with mid-flight escalation                                                      | Accepted                         | 2026-04-18 |
| [0006](0006-phase-1-inline-pipeline-single-shot.md)      | Phase 1 inline pipeline uses single-shot provider calls, not tool-loop subprocesses                                                 | Superseded by 0007               | 2026-04-18 |
| [0007](0007-phase-2-tool-using-worker-subprocess.md)     | Phase 2 tool-using worker subprocess (scaffolder/builder/fixer)                                                                     | Accepted                         | 2026-04-18 |
| [0008](0008-per-task-git-worktrees.md)                   | Per-task git worktrees for agent isolation                                                                                          | Accepted                         | 2026-04-18 |
| [0009](0009-stream-json-ndjson-parsing.md)               | Stream-json NDJSON parsing in `ClaudeCliProvider.stream()`                                                                          | Accepted                         | 2026-04-18 |
| [0010](0010-parallel-worker-pool-with-heartbeats.md)     | Parallel worker pool with heartbeats                                                                                                | Accepted                         | 2026-04-18 |
| [0011](0011-single-daemon-pidfile.md)                    | Single-daemon-instance coordination via pidfile                                                                                     | Accepted                         | 2026-04-18 |
| [0012](0012-brain-in-factoryd-process.md)                | Brain hosted inside `factoryd` via a supervised serve loop                                                                          | Accepted                         | 2026-04-18 |
| [0013](0013-doorbell-event-emitter.md)                   | Doorbell via in-process `EventEmitter` plus 250 ms polling fallback                                                                 | Accepted                         | 2026-04-18 |
| [0014](0014-cli-rpc-transport.md)                        | CLI-RPC transport: HTTP + SQLite polling (with pluggable listener hook)                                                             | Accepted                         | 2026-04-18 |
| [0015](0015-mid-flight-user-engagement.md)               | Mid-flight user engagement via brain-level `askUser` + checkpoint-and-rehydrate                                                     | Accepted                         | 2026-04-18 |
| [0016](0016-planner-materialisation-and-turn-budgets.md) | Planner materialisation: category floor, file-ownership deps, per-task turn budgets                                                 | Accepted                         | 2026-04-18 |
| [0017](0017-assessor-project-env-provisioning.md)        | Assessor project-env provisioning: venv + requires-python + pip install                                                             | Accepted                         | 2026-04-19 |
| [0018](0018-verifier-advisory-only.md)                   | Verifier becomes advisory-only (findings don't block the gate)                                                                      | Accepted                         | 2026-04-21 |
| [0019](0019-drop-github-integration.md)                  | Drop GitHub integration from factory5; future output-to-GH is operator-directed                                                     | Accepted                         | 2026-04-21 |
| [0020](0020-pre-call-budget-enforcement.md)              | Pre-call budget enforcement: rolling-average estimator and clean-escalation shape                                                   | Accepted                         | 2026-04-21 |
| [0021](0021-first-class-project-identity.md)             | First-class project identity via `.factory/project.json` (closes I008)                                                              | Accepted                         | 2026-04-21 |
| [0022](0022-telegram-polling-in-plugin.md)               | Telegram long-polling lives inside the ChannelPlugin, not as a separate EventSource                                                 | Accepted                         | 2026-04-22 |
| [0023](0023-repo-local-instance-and-cwd-walk.md)         | Repo-local factory instances via cwd-walk discovery; `.factory/` replaces `.factory5/`                                              | Accepted                         | 2026-04-22 |
| [0024](0024-worker-subprocess-ask-user.md)               | Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation                                            | Accepted                         | 2026-04-23 |
| [0025](0025-web-ui-architecture.md)                      | Web UI architecture: Astro MPA + ViewTransitions, `FACTORY5_UI_TOKEN` bearer, `/app` + `/api/v1/*`                                  | Accepted                         | 2026-04-23 |
| [0026](0026-pluggable-runtime-contract.md)               | Pluggable assessor runtimes: env-owning/env-assuming provisioner + failure-mode taxonomy + host-tool pre-flight                     | Accepted                         | 2026-04-24 |
| [0027](0027-web-ui-mutation-surface.md)                  | Web UI mutation surface: route shape + idempotency + error envelope + per-project budget defaults                                   | Accepted                         | 2026-04-26 |
| [0028](0028-worker-sandbox-contract.md)                  | Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope                | Accepted                         | 2026-04-26 |
| [0029](0029-directive-stream-protocol.md)                | Directive-stream protocol: SSE for live build observation, six event types, brain-side optional-callback emission                   | Accepted                         | 2026-05-05 |
| [0030](0030-pending-question-auto-answer.md)             | Pending-question auto-answer: deadline-driven LLM dispatch, structured `answered_by` provenance, daemon-wide config                 | Accepted (§2 superseded by 0036) | 2026-05-08 |
| [0031](0031-log-forwarder-design.md)                     | Log-forwarder design: manual `emitLogLine` sites at brain stage breakpoints; pino-transport-tap deferred to Tier 11+                | Accepted                         | 2026-05-16 |
| [0032](0032-budget-ux-paradigm.md)                       | Budget UX paradigm: operator-facing vs internal-pacing budgets; default-publication; escalation rule; persistence                   | Superseded by 0035               | 2026-05-17 |
| [0033](0033-wiki-readiness-critique-loop.md)             | Wiki-readiness critique loop: LLM judge replaces regex, architect–critic retry, exhaustion escalation, per-agent category overrides | Accepted                         | 2026-05-23 |
| [0034](0034-budget-pool-paradigm.md)                     | Budget Pool Paradigm: directive-wide pools for `maxTurns*` axes, live re-resolve from `project.json`, auto-increase toggle          | Superseded by 0035               | 2026-05-24 |
| [0035](0035-budget-axis-canonical-table.md)              | Budget Axis Canonical Table: 12-axis unified model with type classification and auto-increase eligibility                           | Accepted                         | 2026-05-25 |
| [0036](0036-config-home-consolidation.md)                | Config-home consolidation: one `config.toml`, retire the daemon-wide `config.json`                                                  | Accepted                         | 2026-05-30 |

## Adding a new ADR

1. Find next number = max + 1
2. `cp 0005-three-autonomy-modes.md NNNN-short-kebab-title.md` (use it as a template for shape)
3. Fill in: Context / Decision / Consequences / Alternatives considered
4. If superseding: add `Supersedes: NNNN` in the header; update the old ADR's status row above
5. Add a row to the table above
