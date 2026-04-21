# Phase 6a Steps — Cross-project findings registry

- [x] 6a.1 — Schema design + `state` migration for `findings_registry` — `5d81fe2`
- [x] 6a.2 — `wiki.addFinding` dual-write (per-project file + registry) — `e6a2640`
- [x] 6a.3 — `cli findings list` with `--severity`, `--status`, `--project`, `--advisory|--blocking` filters
- [x] 6a.4 — `cli findings show <id>` with full content + origin metadata
- [x] 6a.5 — Backfill script for existing `<workspace>/*/.factory/findings.json`
- [x] 6a.6 — Test coverage (state migration, wiki dual-write, cli round-trip)
- [ ] 6a.7 — Live validation on the Phase 5 `example` corpus
- [ ] 6a.8 — Close Phase 6a

## Sub-step detail

### 6a.1 — Schema design + `state` migration

**Where:** new migration in `packages/state/src/migrations/` (follow the
existing pattern — numbered file + registration in
`packages/state/src/migrations/index.ts`).

**Schema:** a `findings_registry` table that dedupes per
`(project_id, finding_id)` (F001–F999 are project-scoped, so the same
project rebuilt reuses the same ID sequence; the registry treats each
re-raise as an update, not an insert). Columns:

| column              | type    | notes                                                  |
| ------------------- | ------- | ------------------------------------------------------ |
| project_id          | TEXT    | FK → projects.name (stable handle)                     |
| project_path        | TEXT    | snapshotted at insert time for cross-workspace display |
| finding_id          | TEXT    | e.g. `F001` — scoped per project                       |
| source              | TEXT    | agent role                                             |
| target              | TEXT    |                                                        |
| severity            | TEXT    | LOW/MEDIUM/HIGH/CRITICAL                               |
| status              | TEXT    | OPEN/FIXED/VERIFIED/WONTFIX                            |
| description         | TEXT    |                                                        |
| resolution          | TEXT    | nullable                                               |
| advisory            | INTEGER | 0/1, defaults 0 (ADR 0018)                             |
| origin_directive_id | TEXT    | the directive that raised the finding                  |
| created_at          | TEXT    | ISO                                                    |
| resolved_at         | TEXT    | nullable                                               |
| updated_at          | TEXT    | bumped on re-raise or status change                    |

Primary key `(project_id, finding_id)`. Index on `(severity, status)`
for the common `list --severity HIGH --status OPEN` query.

**Decision point — possible ADR 0019:** if dedup turns non-trivial
(e.g. a project is rebuilt and raises a finding with the _same_ F-ID
but a _different_ description, do we overwrite, append a version row,
or fork to a new ID?). Prefer the simple answer: upsert on
`(project_id, finding_id)`, bumping `updated_at`, and treat the latest
description as the current one. If the user objects, file ADR 0019.

**Commit:** `feat(6a.1): state migration for findings_registry table`

### 6a.2 — `wiki.addFinding` dual-write

**Where:** `packages/wiki/src/findings.ts` (`addFinding`,
`updateFindingStatus`). Add a `registryDb?: Database` option (or a
callback interface) so the wiki's per-project file stays the source
of truth and the registry is a derived mirror.

**What:**

- `addFinding` upserts into `findings_registry` after the per-project
  write succeeds. Write is best-effort — a registry failure must NOT
  fail the per-project write (log a warning, continue). The registry
  is recoverable via 6a.5's backfill.
- `updateFindingStatus` upserts the status change into the registry.
- The wiki package takes on a `@factory5/state` dependency for this;
  update `packages/wiki/package.json` accordingly.
- Every callsite that invokes `addFinding` needs a db handle. The
  worker has one through `state` already (model_usage recording); the
  brain has one; standalone scripts (6a.5 backfill) open their own.

**Commit:** `feat(6a.2): wiki.addFinding dual-writes to findings_registry`

### 6a.3 — `cli findings list`

**Where:** new `packages/cli/src/commands/findings.ts` registered via
`packages/cli/src/index.ts`.

**Surface:**

```
factory findings list [--severity LOW|MEDIUM|HIGH|CRITICAL]
                      [--status OPEN|FIXED|VERIFIED|WONTFIX]
                      [--project <name-or-glob>]
                      [--advisory | --blocking]
                      [--limit <n>]
                      [--json]
```

Default filter: `--status OPEN --blocking`. Human output is a table;
`--json` emits NDJSON for scripting. Column set:
`project | id | severity | status | source | target | description[0..80]`.
Advisory findings get an `[adv]` badge next to severity.

**Commit:** `feat(6a.3): cli findings list — filter by severity/status/project/advisory`

### 6a.4 — `cli findings show <id>`

**Where:** same `findings.ts` file as 6a.3.

**Surface:**

```
factory findings show <project>/<id>
# or if the id is globally unique among open:
factory findings show <id>
```

Shows full description, resolution note, origin directive ID (link to
`factory directive show <directiveId>` when that lands), project path,
timestamps, advisory flag.

**Commit:** `feat(6a.4): cli findings show — full finding detail + origin`

### 6a.5 — Backfill script

**Where:** `packages/cli/src/commands/findings.ts` as a hidden
subcommand `factory findings backfill [--workspace <path>]`, OR a
standalone tsx script under `scripts/findings-backfill.ts`. Prefer the
CLI-subcommand form for parity with other factory-managed state.

**What:** walk `--workspace` (default `~/factory5-workspace`), glob
`*/.factory/findings.json`, insert/upsert into registry. Report a
summary: `N projects scanned, M findings imported, K updated`. Idempotent
— re-running is safe.

**Commit:** `feat(6a.5): findings backfill script`

### 6a.6 — Test coverage

- `packages/state/src/migrations/<N>.test.ts` — migration applies
  forward + reverse cleanly; table shape matches schema.
- `packages/wiki/src/findings.test.ts` — `addFinding` with registry
  handle writes to both; with no handle, falls back to file-only
  (backwards-compat); status updates propagate.
- `packages/cli/src/commands/findings.test.ts` — round-trip: seed the
  registry, exercise `list` + `show` against an in-memory db + temp
  workspace, assert the table output + JSON output.

No new ADR expected unless 6a.1's dedup decision gets escalated.

**Commit:** `test(6a.6): findings registry + cli round-trip coverage`

### 6a.7 — Live validation

Run on the Phase 5 corpus (`~/factory5-workspace/*/` plus
`/c/Users/Momo/factory5-v5f-example-2` and
`/c/Users/Momo/factory5-v6c-example`):

```bash
factory findings backfill --workspace /c/Users/Momo
factory findings list --severity HIGH
factory findings list --advisory    # expect 6c's advisory findings
factory findings show F001          # pick whichever project's F001
```

Expect: at least the Phase 6c advisory findings (F001/F002 MEDIUM/LOW
from `factory5-v6c-example/example`) plus any open findings from Phase
5 regression fixtures.

**Commit:** `test(6a.7): live validation — registry shows Phase 5-6c corpus`

### 6a.8 — Close Phase 6a

1. Append a session entry to `docs/PROGRESS.md`.
2. Flip `docs/Phase6_Progress.md` 6a row to ✅.
3. Run `/phase-close` — Control tags `phase-6a-findings-registry-closed`,
   scaffolds `phase-6b-github-channel/` steps, updates STATE.md.

**Commit:** `chore(phase-6a): close Phase 6a, kick off Phase 6b`
