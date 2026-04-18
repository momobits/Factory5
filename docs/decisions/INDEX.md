# Architecture Decision Records

Decisions are append-only. To overturn a decision, write a new ADR with `Supersedes: NNNN` in its header and update the superseded ADR's status.

## Status legend

- **Accepted** — current
- **Superseded by NNNN** — replaced; see linked ADR
- **Deprecated** — no longer applies; not replaced

## Records

| ID | Title | Status | Date |
|---|---|---|---|
| [0001](0001-typescript-on-node.md) | TypeScript on Node 20+ as the implementation language | Accepted | 2026-04-18 |
| [0002](0002-two-binary-split.md) | Two binaries — `factory` (CLI + brain) and `factoryd` (daemon) — separated from day 1 | Accepted | 2026-04-18 |
| [0003](0003-sqlite-and-files-hybrid-storage.md) | Files for project state, SQLite for factory runtime state | Accepted | 2026-04-18 |
| [0004](0004-category-based-model-routing.md) | Category-based model routing (declare intent, not agent) | Accepted | 2026-04-18 |
| [0005](0005-three-autonomy-modes.md) | Three autonomy modes: chat / assisted / autonomous, with mid-flight escalation | Accepted | 2026-04-18 |

## Adding a new ADR

1. Find next number = max + 1
2. `cp 0005-three-autonomy-modes.md NNNN-short-kebab-title.md` (use it as a template for shape)
3. Fill in: Context / Decision / Consequences / Alternatives considered
4. If superseding: add `Supersedes: NNNN` in the header; update the old ADR's status row above
5. Add a row to the table above
