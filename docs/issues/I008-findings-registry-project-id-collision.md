---
id: I008
severity: MEDIUM
area: state/findings-registry
status: OPEN
created: 2026-04-21
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

Open. Candidate fixes, ordered by intrusiveness:

1. **Use `project_path` as the dedup key.** Change the registry PK
   to `(project_path, finding_id)`, let `project_id` be a
   non-unique human label derived as today. This mirrors the
   file-system truth (the per-project `findings.json` _is_ identified
   by path). Downside: a project physically moved to a new path
   becomes a new set of registry rows.

2. **Derive `project_id` from workspace + name.** Set the default to
   `<basename(parentOf(projectPath))>/<basename(projectPath)>`
   (e.g. `factory5-v5f-example-2/example`). Keeps the composite PK
   shape, keeps `project_id` readable. Downside: longer ids in `list`
   output; still collides if two workspaces happen to share both
   parent basename and project basename.

3. **Require explicit `projectId` at every caller.** Drop the
   basename default entirely; make callers pass a globally-unique
   handle from `projects.name` (which in turn would have to be
   canonicalized cross-workspace too). Largest churn — touches
   `projects.upsert` semantics.

Preferred shape per operator experience: #1 (PK on `project_path`) —
the source-of-truth for "is this the same project?" is the
filesystem path, not the name. Defer until an operator actually runs
into the limitation in earnest; the Phase 5/6c corpus is the only
known repro and the workaround (backfill per-workspace) is
functional.

Candidate phase: defer to Phase 7 or later. Not blocking any
operator-trust criterion; the advisory-flag display and per-project
`factory findings` still work.
