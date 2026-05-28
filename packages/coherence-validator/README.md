# @factory5/coherence-validator

Validates the project's knowledge graph at `docs/knowledge/`:

- **Schema validity** — front-matter parses; required fields present
- **Reference integrity** — `documented_in:` anchors resolve; `implements:`
  task IDs match the current plan
- **Doc-fiction** (Phase B) — README code blocks actually run
- **Dead-code** (Phase B) — public symbols with no caller

Used by the worker at task completion and the brain at post-merge +
final-verification phases.

## Programmatic API

```typescript
import { validateKnowledgeGraph } from '@factory5/coherence-validator';
const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
// result.findings contains structured findings if any checks failed
```

## CLI

```bash
factory5 graph check [<projectPath>]
```

See spec at `docs/superpowers/specs/2026-05-28-living-knowledge-graph-design.md`.
