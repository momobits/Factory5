# 0021 — First-class project identity via `.factory/project.json`

- **Status:** Accepted
- **Date:** 2026-04-21

## Context

Phase 7b's spend dashboard needs to roll up `model_usage` rows "per project."
But factory5 today has no first-class, stable project identity in the data
model. Project identity is buried in two places:

1. `directives.payload_json` — a JSON blob; queries that want the project must
   parse the blob.
2. `projects.name TEXT PRIMARY KEY` — keyed on a single column, derived from
   `basename(projectPath)` at first sight. Two workspaces that share a basename
   share a row.

Both are workarounds. The second is the same trap I008 documents on
`findings_registry`: when an operator runs `factory build example` in
`/c/Users/Momo/factory5-v5f-example-2/` and again in
`/c/Users/Momo/factory5-v6c-example/`, the registry collapses both into one
`(example, F001)` slot. The same trap would befall a "per-project spend"
rollup keyed on `basename(projectPath)`.

Two candidate fixes were considered at the start of Phase 7b:

A. **Per-directive primary view; per-project as a fuzzy secondary view with a
   `--by-path` escape hatch.** Stays in 7b's "pure query work" budget but ships
   a known-fuzzy view that operators have to learn the caveat for. Defers I008.
B. **Use `project_path` as the canonical key on `findings_registry` and
   `directives`.** Resolves the collision but conflates *location* with
   *identity*. Copying a project to a new folder changes its identity (and
   severs spend / findings history); moving a project changes identity for the
   duration of the move; the same project in two folders becomes two projects.

(B) is what I008's preferred-fix #1 names. Operating-experience surfaces its
limitation: paths are not stable. The operator's mental model of "is this the
same project?" is the project itself, not where it currently lives on disk.
Git answers this with `.git/`; npm with `package.json`; uv with `pyproject.toml`.
Each is a per-project file the tool reads to claim identity.

`.factory/` already exists per-project (`<project>/.factory/{findings.json,
plan.json, plan.md, assessor-env/, worktrees/, logs/}`, gitignored,
factory-owned — established by `worker.ts:104`). It is the obvious home for an
identity file.

## Decision

Add a new file `<project>/.factory/project.json` carrying a stable ULID
identity for the project. Make `projects.id` (the ULID) the canonical key
everywhere factory5 talks about projects. Read-or-create on every directive
that references a project; missing file = new project; corrupted file =
hard-fail (never silently re-tag).

Five parts.

### 1. Identity file shape

`<project>/.factory/project.json`:

```json
{
  "id": "01KPRHNEX1T3VR3S4ZTTSJ8F0M",
  "name": "example",
  "createdAt": "2026-04-21T17:30:00Z",
  "factoryVersion": "0.x",
  "metadata": {}
}
```

- `id` — ULID generated at first sight; the canonical handle, forever.
- `name` — human-readable display name. Initially `basename(projectPath)`,
  but explicit and editable. Not unique; not used for joins.
- `createdAt` — ISO timestamp of first sight.
- `factoryVersion` — for forward-migration logic (the project file format may
  evolve).
- `metadata` — extension point for future per-project state factory wants to
  attach without another schema decision (spec ref, default budget overrides,
  project-scoped flags, etc.).

The file is gitignored via the existing `.factory/` guard, so it is intentionally
project-local — *not* checked into version control by factory. Operators who
want to share a project's identity across collaborators can opt into committing
the file themselves; factory does not impose either way.

### 2. Resolution at directive insert

A new helper in `@factory5/wiki` (or `@factory5/state` — implementation-phase
choice; the `.factory/` directory is wiki-managed today, but the `projects`
table lives in state):

```ts
loadOrCreateProjectMetadata(workspacePath, projectName): ProjectMetadata
```

Behaviour:

1. Compute `filePath = <workspacePath>/<projectName>/.factory/project.json`.
2. If `filePath` exists and parses cleanly: return its parsed contents (the
   project keeps its existing identity — no reassignment).
3. If `filePath` does not exist: generate a new ULID, populate the file, write
   it atomically (temp-file + rename), return it (the project claims a new
   identity).
4. If `filePath` exists but does not parse: throw a typed error
   `ProjectMetadataCorruptError`. The operator must decide whether to recover
   from a backup or accept the project as new (by deleting the corrupted file).
   Factory never silently re-tags, since a re-tag would lose the project's
   spend / findings / build history just as surely as a path change does.

`directives.insert` calls this helper when the incoming directive references a
workspace+project, and stores the resolved `id` on the new
`directives.project_id` column.

### 3. Schema migration (006)

Migration 006 makes the canonical key first-class:

- **`projects` table** — change PK from `name TEXT PRIMARY KEY` to
  `id TEXT PRIMARY KEY`. Demote `name` to a non-unique column. Add
  `last_workspace_path TEXT` (advisory snapshot of the most recent workspace
  path seen for this project; not used for joins, populated for operator
  display only).
- **`directives` table** — add `project_id TEXT REFERENCES projects(id) ON
  DELETE SET NULL`. Nullable, since chat / system directives are not tied to
  a project.
- **`findings_registry` table** — change PK from `(project_id, finding_id)`
  where `project_id = basename(path)` to `(project_id, finding_id)` where
  `project_id` is the ULID. Update `wiki.addFinding`'s `mirrorToRegistry` and
  the CLI backfill (`runFindingsBackfill`) to pass the ULID.
- **`learnings.source_project`** — currently references `projects.name`.
  Migrate to reference `projects.id`.

### 4. Backfill

Migration 006 is one-shot at startup:

- For each existing row in `projects`: read or create
  `<workspace_path>/.factory/project.json`. If `workspace_path` no longer
  exists on disk (deleted/moved without factory's knowledge), generate a ULID
  and skip writing the file; mark `last_workspace_path` with an advisory
  `(stale)` annotation. Operators can prune these rows later.
- For each existing row in `directives`: parse `payload_json` to find
  workspace + project name; look up `projects.id` by joining on the demoted
  `projects.name` (the only mapping that exists in current data); populate
  `project_id`. Directives without a workspace+project leave the column NULL.
- For each existing row in `findings_registry`: map old basename `project_id`
  to the new ULID by joining through `projects.name`. Pre-existing collisions
  stay collided (this is data we have already lost per I008's repro; the
  migration does not invent rows it cannot prove).

Pre-existing collisions in `findings_registry` are unrecoverable without
re-running per-workspace backfill, exactly as I008 already documents — the
migration does not make this worse.

### 5. CLI display

The CLI shows `name (id-suffix)` when surfacing projects, so operators see a
friendly label without losing disambiguation:

```
$ factory spend --group-by project
PROJECT                  N_DIR  SPENT
example (…JF0M)          1      $1.50
example (…XK7Q)          1      $2.00
foo (…3R8P)              1      $0.30
```

Two `example` projects in two different workspaces appear as distinct rows.

## Consequences

**Positive.**

- **Identity is stable across path moves.** Copy a project to a new folder
  with `.factory/project.json` intact, and factory continues against the same
  identity — spend, findings, learnings all carry forward. This matches the
  operator's mental model and is what was lost under both `name`-keyed and
  `path`-keyed alternatives.
- **Identity is explicit at fork.** To deliberately fork a project (start a
  new spend / findings history from a copy), delete the file before the next
  build. Factory will see no id and create one. The fork is an explicit
  operator action, not an accident of `cp -r`.
- **Identity is stable across renames.** Renaming `<workspace>/example/` to
  `<workspace>/example-v2/` does not touch the identity (the file is inside
  the project, not its location).
- **I008 closes properly.** ULID-keyed `findings_registry` is exactly I008's
  preferred fix in stable form. Two `example` projects in two workspaces
  become two distinct registry slots, never collide again.
- **Spend rollups are honest from day one.** Per-project queries join through
  `directives.project_id` (a ULID). No fuzzy view, no `--by-path` escape
  hatch, no operator-facing footnotes about caveats.
- **Extension point established.** `metadata` field absorbs future
  per-project factory state (spec ref, default budget overrides,
  project-scoped flags) without another schema decision per addition.
- **Familiar pattern for operators.** Git, npm, uv all use a per-project file
  to claim identity. Factory adopting the same pattern is the principle of
  least surprise.

**Negative.**

- **Migration 006 is non-trivial.** Schema changes to three tables plus a
  backfill that touches the filesystem (writing project.json files into
  existing workspaces). Backfill failures (read-only mounts, permissions,
  missing workspaces) need graceful handling rather than a hard-fail, since
  Phase 7b cannot proceed without the migration completing.
- **Identity-file corruption requires operator judgment.** A corrupted
  `project.json` blocks any further directive against that project until the
  operator decides whether to recover or accept-as-new. Hard-fail is the
  right default (silent re-tag would lose history) but introduces a new
  operator failure mode that did not exist when project identity was derived
  purely from path.
- **Two-source-of-truth risk during transitions.** During a long-running
  build, the `projects` table and the on-disk file must agree. Single-writer
  pattern (the helper is the only thing that creates the file or the row)
  keeps this bounded. Tests must cover the "row exists but file is missing"
  and "file exists but row is missing" cases explicitly.
- **`.factory/` is gitignored.** The identity file is therefore project-local
  by default. Multi-developer projects that want collaborators to share
  identity must opt into committing the file themselves. This is intentional
  (factory does not impose a versioning policy on operator state) but worth
  noting.
- **Phase 7b grows from 1 to ~2 sessions.** The data-model prep is real work
  that does not directly ship the spend dashboard. The trade-off is paid in
  return for a clean foundation for everything downstream — every future
  feature that wants project-scoped queries (per-project budgets, per-project
  history views, project-scoped channel subscriptions) inherits a stable
  handle.

**Reversible?** Partially. The on-disk `.factory/project.json` files would
remain after a revert (harmless — factory simply would not read them). The
schema migration would have to be reverted with a custom down-migration; the
data lost in the revert (the `directives.project_id` populations) would have
to be re-derived from `payload_json` on demand. Not freely reversible after
operators rely on the new identity model.

## Alternatives considered

- **Per-path canonical identity** (I008's preferred fix #1): use
  `project_path` as the PK on `findings_registry` and analogous on
  `directives`. Rejected. Paths are not stable: copying a project to a new
  folder changes identity (loses history); moving a project changes identity
  for the duration of the move; symlinks can make the same project appear
  under multiple paths. The operator's mental model of "is this the same
  project?" is the project itself, not where it currently lives.
  Path-as-identity is strictly weaker than file-as-identity.

- **Per-directive primary, per-project fuzzy secondary**: default
  `factory spend` rollup is by `directive_id`; per-project rollup uses the
  existing collision-prone `name` key, with a `--by-path` escape hatch flag
  for disambiguation. Rejected. Ships a known-fuzzy view that operators must
  learn the caveat for; defers I008 indefinitely; locks in two
  project-identity schemes (per-call queries use ULIDs via `directive_id`;
  per-project queries use basenames) that will need reconciliation later.
  The "stay in 1 session" budget that justified this option was a false
  economy: the workaround would itself need replacement when I008 was
  eventually addressed.

- **Hash of `(workspace_path, name)` as identity** (deterministic, no file):
  no on-disk state required; identity derives from the directive's payload.
  Rejected. Same trap as path-keyed identity — moving the project breaks
  identity. Worse, the identity is invisible to the operator (a hash is not
  a thing they can inspect or reason about).

- **Make operators name projects globally-uniquely** (`projectId` required
  at the CLI): drop the basename default; every `factory build` requires
  `--project-id <unique-string>`. Rejected. UX regression for the common
  case (one workspace, one project named `example`); pushes naming
  discipline onto the operator that the system can manage itself.

- **Use the directive's ULID as a proxy for project identity in 7b only**
  (postpone the data-model fix): every spend query groups by `directive_id`;
  per-project rollups are deferred until "real" project identity exists.
  Rejected. Per-project spend is the second-most-asked spend question after
  per-build; deferring it ships a deliberately incomplete dashboard.

## Implementation notes

Step 7b.1 lands the data model. Rough split:

- **`@factory5/wiki` or `@factory5/state`** — new
  `loadOrCreateProjectMetadata` helper. Cross-platform (Windows path
  normalisation), atomic file write (temp + rename), typed errors
  (`ProjectMetadataCorruptError`).
- **`@factory5/state` migrations/006-project-identity.ts** — schema changes
  to `projects`, `directives`, `findings_registry`, `learnings`. SQLite-friendly
  (CHECK constraint changes via table-rebuild pattern, since SQLite can't
  ALTER CHECK).
- **`@factory5/state` queries** — `directives.insert` updated to populate
  `project_id`. `findings_registry` queries updated to require a ULID.
  `projects.upsertById` replaces `projects.upsertByName` (the latter kept as
  a one-shot backfill helper, then removed).
- **Backfill** — runs as part of migration 006 (so it runs once at the next
  daemon start). Idempotent. Logs every project file written / row updated /
  row skipped (with reason).
- **Tests** — migration shape tests; backfill correctness tests for the
  collision case (two `example` workspaces both have entries in the legacy
  `projects` table → after migration, each gets its own ULID and own
  `findings_registry` slot); helper tests for the four resolution cases
  (file present and valid, file absent, file corrupt, workspace gone).

I008's status flips to RESOLVED at the end of 7b.1. The regression test for
I008 is the migration test plus the spend round-trip in 7b.4 (two `example`
workspaces, each with its own `.factory/project.json`, both visible
distinctly in the dashboard).

`CompleteArchitecture.md` does not currently document project identity beyond
"projects table keyed on name." Update §3 (project storage layout) inline
with the same commit that lands migration 006.
