# @factory5/wiki

Per-project state operations: knowledge wiki, BUILD.md, plan, findings tracker, readiness gate.

> Per-project state lives in **files** in the project directory (see ADR 0003); this package is the typed read/write API.

## Layout it manages

```
<project>/
├── docs/knowledge/*.md   ← wiki: overview, architecture, modules/, decisions/, ...
├── BUILD.md              ← human-readable findings table + decisions log
└── .factory/
    ├── findings.json     ← machine-readable finding lifecycle
    ├── plan.md, plan.json
    ├── checkpoints/
    └── runs/<directive-id>/  ← per-run audit trail
```

## API

All functions are async and operate on a project path (project root directory).

**Paths:**

- `projectPaths(root)` → `{ root, claudeMd, buildMd, docs, knowledge, factory, findings, plan, planJson, checkpoints, worktrees, logs, runs }`

**Wiki pages:**

- `readWiki(root)` → `WikiPage[]` — recurses `docs/knowledge/`, sorted
- `writeWikiPage(root, slug, content)` — slugs may contain `/` for nesting; path traversal is rejected; a trailing newline is appended if missing

**Findings:**

- `addFinding(root, { source, target, severity, description, status?, createdAt? })` → `Finding` — assigns the next F-sequence id (F001, F002, ...)
- `updateFindingStatus(root, id, status, resolution?)` → `Finding` — auto-stamps `resolvedAt` on terminal transitions (FIXED/VERIFIED/WONTFIX)
- `listFindings(root, { status?, source? })` → `Finding[]`
- `getFinding(root, id)` → `Finding | undefined`

**BUILD.md:**

- `rebuildFindingsTable(root)` — regenerates the `## Findings` table from `findings.json`; leaves `## Log` intact
- `appendBuildLog(root, entry, now?)` — append-only timestamped log line

**Plan:**

- `writePlan(plan)` — validates via `planSchema`, writes `plan.json` + rendered `plan.md`
- `readPlan(root)` → `Plan | undefined`

## Status

Implemented in Phase 1. 18 unit tests.
