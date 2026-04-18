# Architecture Decision Records

Decisions are append-only. To overturn a decision, write a new ADR with `Supersedes: NNNN` in its header and update the superseded ADR's status.

## Status legend

- **Accepted** — current
- **Superseded by NNNN** — replaced; see linked ADR
- **Deprecated** — no longer applies; not replaced

## Records

| ID                                                   | Title                                                                                 | Status             | Date       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------ | ---------- |
| [0001](0001-typescript-on-node.md)                   | TypeScript on Node 20+ as the implementation language                                 | Accepted           | 2026-04-18 |
| [0002](0002-two-binary-split.md)                     | Two binaries — `factory` (CLI + brain) and `factoryd` (daemon) — separated from day 1 | Accepted           | 2026-04-18 |
| [0003](0003-sqlite-and-files-hybrid-storage.md)      | Files for project state, SQLite for factory runtime state                             | Accepted           | 2026-04-18 |
| [0004](0004-category-based-model-routing.md)         | Category-based model routing (declare intent, not agent)                              | Accepted           | 2026-04-18 |
| [0005](0005-three-autonomy-modes.md)                 | Three autonomy modes: chat / assisted / autonomous, with mid-flight escalation        | Accepted           | 2026-04-18 |
| [0006](0006-phase-1-inline-pipeline-single-shot.md)  | Phase 1 inline pipeline uses single-shot provider calls, not tool-loop subprocesses   | Superseded by 0007 | 2026-04-18 |
| [0007](0007-phase-2-tool-using-worker-subprocess.md) | Phase 2 tool-using worker subprocess (scaffolder/builder/fixer)                       | Accepted           | 2026-04-18 |
| [0008](0008-per-task-git-worktrees.md)               | Per-task git worktrees for agent isolation                                            | Accepted           | 2026-04-18 |
| [0009](0009-stream-json-ndjson-parsing.md)           | Stream-json NDJSON parsing in `ClaudeCliProvider.stream()`                            | Accepted           | 2026-04-18 |
| [0010](0010-parallel-worker-pool-with-heartbeats.md) | Parallel worker pool with heartbeats                                                  | Accepted           | 2026-04-18 |
| [0011](0011-single-daemon-pidfile.md)                | Single-daemon-instance coordination via pidfile                                       | Accepted           | 2026-04-18 |
| [0012](0012-brain-in-factoryd-process.md)            | Brain hosted inside `factoryd` via a supervised serve loop                            | Accepted           | 2026-04-18 |
| [0013](0013-doorbell-event-emitter.md)               | Doorbell via in-process `EventEmitter` plus 250 ms polling fallback                   | Accepted           | 2026-04-18 |
| [0014](0014-cli-rpc-transport.md)                    | CLI-RPC transport: HTTP + SQLite polling (with pluggable listener hook)               | Accepted           | 2026-04-18 |

## Adding a new ADR

1. Find next number = max + 1
2. `cp 0005-three-autonomy-modes.md NNNN-short-kebab-title.md` (use it as a template for shape)
3. Fill in: Context / Decision / Consequences / Alternatives considered
4. If superseding: add `Supersedes: NNNN` in the header; update the old ADR's status row above
5. Add a row to the table above
