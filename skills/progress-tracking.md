---
name: progress-tracking
description: |
  Track build progress in BUILD.md. Update the Build Log, Current State,
  and Findings sections after every task. BUILD.md is the single source
  of truth — it enables restart, human review, and intervention.
---

# Progress Tracking

You MUST update BUILD.md after every task. This file is the project's memory
between iterations. Humans also read it to understand progress and give direction.

## At the START of every iteration

1. Read BUILD.md — especially ## Current State, ## Architecture, and ## Human Directives
2. If there are Human Directives, follow them — they override other priorities
3. Read the Architecture section for the module you are about to work on
4. Check the Build Log for context on what was tried before (especially for FIX tasks)

## What to Update After Each Task

### ## Build Log
Append an entry:
```markdown
### Iteration N — STATE task — YYYY-MM-DD HH:MM
- What you did (specific actions, not vague descriptions)
- Tests written: X, Tests passing: Y/Z
- Review result: SHIP IT / NEEDS FIXES
- Decisions made: (any choices you had to make)
- Result: PASS / FAIL / ESCALATED
```

### ## Current State
Update all fields:
```markdown
## Current State
- Phase: BUILD
- Next task: build src/formatter.py
- Modules: 3/5 complete
- Tests: 18 pass, 0 fail
- Iteration: 10/30
```

### ## Findings & Issues
Add any:
- Bugs discovered in other modules while working on this one
- Design problems (circular deps, interface mismatches)
- Workarounds applied and why
- Dependency issues encountered

### ## Architecture
Only the ARCHITECT updates this section. If you find an interface mismatch
during BUILD or FIX, note it in Findings & Issues — do NOT modify Architecture.

## Rules

- NEVER skip updating BUILD.md
- NEVER mark something done without running its tests
- Note test pass counts — "tests: 4 pass" not just "done"
- Log decisions so future iterations understand why
- Log blockers in Findings & Issues so they aren't re-discovered
- Commit BUILD.md changes with your other changes, not separately
