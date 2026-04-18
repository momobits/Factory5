# 0003 — Files for project state, SQLite for factory runtime state

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Factory 5 has two distinct categories of state:

1. **Per-project state** — the design wiki, build log, findings, plan for one specific project. Should ship with the project, be human-readable, version-controllable, and Obsidian-browsable.
2. **Factory runtime state** — the directive queue, session state, in-flight tasks, dedup hashes, learnings across projects, model usage tracking. Should support concurrent writes from daemon + workers + brain, atomic transactions, and queries ("show all stuck builds").

Forcing both into one storage model is wrong. Markdown files are great for (1) and painful for (2) — concurrent writes corrupt them, queries require parsing, atomic updates need locking. SQLite is great for (2) and wrong for (1) — burying a project's design in a binary file destroys portability and human readability.

## Decision

**Per-project state lives in files** inside each project directory (outside `factory5/`):

```
<workspace>/<project>/
├── CLAUDE.md                  ← user spec (input)
├── docs/knowledge/*.md        ← wiki (architect writes; ships with project)
├── BUILD.md                   ← findings, decisions, log (human-readable)
├── .factory/
│   ├── findings.json          ← finding lifecycle (mirrors BUILD.md table)
│   ├── plan.md, plan.json     ← active plan
│   ├── checkpoints/
│   ├── worktrees/             ← per-task git worktrees
│   └── logs/build-<ts>.log    ← per-build log mirror
└── src/, tests/, ...
```

**Factory runtime state lives in SQLite** — one file at `~/.factory5/factory.db` (Linux/Mac) or `%LOCALAPPDATA%\factory5\factory.db` (Windows):

| Table               | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `directives`        | Inbound work queue across all channels            |
| `outbound_messages` | Brain → channels delivery queue with audit        |
| `events_audit`      | Every event ever seen                             |
| `sessions`          | Per-channel/per-user conversational state         |
| `pending_questions` | `ask_user` calls awaiting reply                   |
| `tasks_inflight`    | Currently-running worker tasks                    |
| `projects`          | Registry of all projects factory has touched      |
| `learnings`         | Cross-project patterns extracted from past builds |
| `model_usage`       | Token/cost tracking per provider per directive    |

Driver: `better-sqlite3` (synchronous, prebuilt binaries for Win/Linux/Mac, single-file ops, zero admin).

## Consequences

**Positive:**

- Project state stays portable, human-readable, git-committable, Obsidian-browsable — preserves factory2's wiki philosophy
- Factory runtime gets atomicity, queries, durability, and concurrent-write safety for free
- Single SQLite file = trivial to back up, inspect with `sqlite3 ~/.factory5/factory.db`, or delete to reset
- No external services (no Postgres, no Redis) — operationally clean
- Both processes can read/write the same DB safely (better-sqlite3 + WAL mode)

**Negative:**

- Two storage models means two mental models. Mitigated by the rule "if it's about _one project_, it's a file; if it's about _the factory_, it's SQLite."
- SQLite is not appropriate for very high write throughput. Acceptable for our scale (single machine, single user, rare concurrent writes).
- If we go SaaS later, we'll need to migrate runtime state to Postgres or similar. The `@factory5/state` package abstracts queries, so the migration is contained to one package's implementation.

**Reversible?** Storage migrations are always work, but the abstractions are good:

- Project state is already markdown — no migration needed if we ever change storage models
- Runtime state is behind the `@factory5/state` package — Postgres swap requires changing one package, not the whole brain

## Alternatives considered

- **Files for everything** (clawhip-style: JSON files in `~/.clawhip/state/`). Rejected because concurrent writes from daemon + workers + brain to JSON files = corruption risk + complex locking. SQLite gives us the same "single user-writable file" footprint with transactions and queries for free.
- **SQLite for everything** (project state in SQLite too). Rejected because it destroys the wiki philosophy — projects must remain portable and human-readable. The wiki shipping _with_ the project as documentation is part of the value proposition.
- **Postgres from day 1** (in case of SaaS). Rejected because it adds an operational dependency for personal use. SaaS-readiness comes from the `@factory5/state` abstraction, not from picking the SaaS database upfront.
