<!-- packages/brain/src/assets/_schema.md -->

# Knowledge Graph Schema (v1)

This file defines the node and edge kinds used in `docs/knowledge/`.
Both agents and the `factory5 graph check` validator read this file
as the source of truth.

## Node kinds

### `feature`

A user-visible capability the project provides. Lives at
`docs/knowledge/features/<id>.md`.

Required front-matter:

- `kind: feature`
- `id: <kebab-case>` (unique within project)
- `status: documented | implemented | superseded | abandoned`
- `documented_in: [<doc-path>#<anchor>, ...]` (at least one entry)

Optional front-matter:

- `implements: [<task-id>, ...]` — task IDs that built this feature
- `decisions: [<decision-id>, ...]` — decisions that affected this feature
- `derived_from: [<feature-id>, ...]` — parent features (sub-feature decomposition)
- `supersedes: <feature-id>` — feature this one replaced

### `decision`

A judgment call made during a build that modifies a feature's spec.
Lives at `docs/knowledge/decisions/<YYYY-MM-DD>-<slug>.md`.

Required front-matter:

- `kind: decision`
- `id: <YYYY-MM-DD>-<slug>`
- `date: <YYYY-MM-DD>`
- `made_by_task: <task-id>`
- `modifies: [<feature-id>, ...]` (at least one entry)

Required body sections:

- `## Context`
- `## Decision`
- `## Consequences`

Optional front-matter:

- `supersedes: <decision-id>` — decision this one replaced
- `follow_ups: [<feature-id>, ...]` — features deferred or filed as a result

## Edge kinds (front-matter array fields)

| Edge            | Source kind      | Target          | Direction                             |
| --------------- | ---------------- | --------------- | ------------------------------------- |
| `implements`    | feature          | task-id         | feature → was built by → task         |
| `documented_in` | feature          | doc-path#anchor | feature → described at → doc location |
| `modifies`      | decision         | feature-id      | decision → changed → feature          |
| `supersedes`    | decision/feature | id of same kind | newer → replaced → older              |
| `derived_from`  | feature          | feature-id      | child → parent                        |
| `decisions`     | feature          | decision-id     | feature → affected by → decisions     |
| `follow_ups`    | decision         | feature-id      | decision → spawned → features         |

## Status state machine

```
documented ─→ implemented ─→ superseded
     │                      │
     └────→ abandoned ←─────┘
```

- `documented` — seeded by architect; no implementing task yet
- `implemented` — a builder task completed; `implements:` is populated
- `superseded` — replaced by another feature; `supersedes:` populated on the replacement
- `abandoned` — explicitly dropped without replacement; requires a `decisions:` entry explaining why

A feature MAY transition `documented → abandoned` directly (never built).
A feature MAY transition `implemented → superseded` (replaced by a better implementation).
A feature MAY NOT transition `superseded → implemented` (resurrect via a new feature with `supersedes:` pointing back).
