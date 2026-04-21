---
id: I008
severity: MEDIUM
area: state/findings-registry
status: RESOLVED
created: 2026-04-21
resolved: 2026-04-21
---

# `findings_registry` collides when two workspaces share a project name

## Description

Phase 6a introduces `findings_registry` as the cross-project aggregate
of every `<workspace>/<project>/.factory/findings.json`. The registry
row keys on the composite `(project_id, finding_id)` primary key, and
both 6a.2's live dual-write (`wiki.addFinding` → `mirrorToRegistry`)
and 6a.5's backfill (`runFindingsBackfill`) derive `project_id =
basename(projectPath)` when no explicit handle is passed.

That derivation is unsafe when a user runs `factory build example`
in two different workspaces — `factory build example --workspace
/c/Users/Momo/factory5-v5f-example-2` and
`factory build example --workspace /c/Users/Momo/factory5-v6c-example`
both produce a project whose basename is `example`. The registry
treats them as the same project and the second backfill's rows
overwrite the first's. The `project_path` column still snapshots the
correct path for whatever row is currently alive, but the _other_
workspace's findings are no longer visible in the registry.

Per-project `findings.json` files are untouched — the collision is
registry-only. Re-running the backfill against the other workspace
brings those findings back at the cost of the current set. So this is
a representation limitation, not a data-loss bug, but it is
operator-misleading: `factory findings list` appears to have only one
`example/F001` when there are really two.

## Repro / evidence

Phase 6a.7 live validation (2026-04-21, factory5 main, commit
`73ff8fb`+). Both corpuses pre-exist from earlier phases:

- `/c/Users/Momo/factory5-v5f-example-2/example/.factory/findings.json`
  — 1 finding (F001, the Phase 5f verifier CRITICAL hallucination
  that kicked off Phase 6c).
- `/c/Users/Momo/factory5-v6c-example/example/.factory/findings.json`
  — 2 findings (F001 MEDIUM, F002 LOW — the Phase 6c advisory
  verifier findings).

Steps:

```bash
factory findings backfill --workspace /c/Users/Momo/factory5-v5f-example-2
# → 1 dir(s) scanned; 1 with findings.json; 0 error(s)
# → imported 1; updated 0
# → example  +1 imported  ~0 updated
#   Registry now has: (example, F001)  project_path=.../factory5-v5f-example-2/example

factory findings backfill --workspace /c/Users/Momo/factory5-v6c-example
# → 1 dir(s) scanned; 1 with findings.json; 0 error(s)
# → imported 1; updated 1
# → example  +1 imported  ~1 updated
#                           ↑ overwrite of v5f's F001
```

After the second run, `factory findings list --status all --advisory
--blocking` shows only two rows — both from v6c. The v5f CRITICAL is
gone from the registry view:

```
project  id    severity     status  source    target         ...
example  F002  [adv]LOW     OPEN    verifier  testing.md     ...
example  F001  [adv]MEDIUM  OPEN    verifier  context-block  ...

(2 findings)
```

`factory findings show F001` resolves unambiguously — the registry
only knows about one of them. The v5f finding effectively lost to the
operator without re-running backfill against v5f (which would then
clobber v6c instead).

## Hypothesis

The collision stems from two intentional-but-now-colliding design
decisions:

1. `basename(projectPath)` is the default `project_id` derivation for
   both `wiki.addFinding`'s registry mirror (`packages/wiki/src/findings.ts`
   `mirrorToRegistry`) and the CLI backfill
   (`packages/cli/src/commands/findings.ts` `runFindingsBackfill`).
2. The registry's composite PK is `(project_id, finding_id)` —
   `packages/state/src/migrations/003-findings-registry.ts`.

The intent was that `project_id` correspond to `projects.name` (the
handle factory5 uses to register a project in the `projects` table).
`projects` is keyed on `name UNIQUE`, so by _that_ table's design two
`example` projects in different workspaces are indistinguishable.
`findings_registry` inherited the assumption without validating
against real multi-workspace corpuses.

## Resolution

Resolved 2026-04-21 via Phase 7b step 7b.1 (commit `92bebf4`,
[ADR 0021](../decisions/0021-first-class-project-identity.md)).

The candidate fixes considered above all dealt with **identity in the
findings_registry alone** — patching the symptom. The accepted fix
goes a layer deeper: **make project identity first-class system-wide**,
not collision-prone basenames anywhere. The implementation:

- New `<project>/.factory/project.json` carries a stable ULID as the
  canonical project handle (`wiki.loadOrCreateProjectMetadata`).
  Stable across path moves; explicit at fork (delete file before
  next build). Mirrors how git, npm, uv claim per-project identity.
- Migration 006 makes `projects.id TEXT PRIMARY KEY` (was `name`),
  adds `directives.project_id`, and translates
  `findings_registry.project_id` from basename → ULID via a one-shot
  backfill. `learnings.source_project` similarly migrated.
- All call paths (CLI build / resume / findings backfill, brain pool,
  wiki addFinding) now resolve identity through the helper or inherit
  it from the directive's `projectId` field. Wiki's
  `mirrorToRegistry` skips the registry write when no projectId is
  available rather than fall back to the basename trap.

Two `example` projects in different workspaces are now distinct
`projects` rows with distinct ULIDs; their `findings_registry`
entries no longer collide. The historical collision (the v5f vs v6c
`example` case in this issue's repro) is preserved as-is — the
migration does not invent rows it cannot prove — but new writes from
either workspace land cleanly.

**Regression coverage:**

- `packages/state/src/migrations/006-project-identity.test.ts` — 11
  tests covering migration shape and backfill correctness, including
  the explicit "two projects with the same name are storable when
  ids differ" case which would have failed under the old `name`-PK
  schema.
- `packages/wiki/src/project-metadata.test.ts` — 11 tests covering
  the four resolution outcomes (fresh / adopt / corrupt / read-only)
  and injection points for deterministic ids in tests.
- `packages/state/src/state.test.ts` — new "two projects sharing a
  name are distinct rows when ids differ" test on the projects CRUD
  layer.
- `packages/cli/src/commands/findings.test.ts` — backfill tests now
  seed `.factory/project.json` per project; identity is resolved via
  `readProjectMetadata`. New "skips projects without identity file"
  test covers the deliberate skip behaviour.

The future "what if the operator wants per-workspace `findings_registry`
rollups for a single project" question (pre-fix this was a
side-effect of the basename trap) is now an explicit query design
choice — a clean composition of `projects.name` + `projects.workspace_path`
joins rather than an artifact of identity collision.
