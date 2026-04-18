# @factory5/wiki

Per-project state operations: knowledge wiki, BUILD.md, findings tracker.

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

## API (planned)

- `readWiki(projectPath)` — load all markdown pages
- `writeWikiPage(projectPath, slug, content)` — write/update a page
- `wikiReadiness(projectPath)` — check the readiness gate (all modules have interface defs, architecture has mermaid, dependencies/testing documented)
- `addFinding(projectPath, finding)` — append finding to BUILD.md + findings.json (atomic)
- `updateFindingStatus(projectPath, id, status, resolution?)`
- `listFindings(projectPath, filter?)` — query open/fixed/verified findings
- `appendBuildLog(projectPath, entry)`

## Status

Stub. Implementation lands in Phase 1.
