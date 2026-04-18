# Issues

Internal issue tracker for factory5 itself. Mirrors the finding-lifecycle pattern factory uses on its outputs.

> No open issues yet. This file is the index; individual issues live as `INNN-short-kebab-title.md` next to it.

## Status legend

- **OPEN** — recognized, not started
- **IN_PROGRESS** — being worked on (set `owner` in frontmatter)
- **RESOLVED** — fix landed, awaiting verification
- **VERIFIED** — fix confirmed (tests pass, behavior correct)
- **WONTFIX** — closed without fix (with rationale)

## Open

| ID     | Severity | Area | Title | Owner |
| ------ | -------- | ---- | ----- | ----- |
| _none_ |          |      |       |       |

## Resolved (last 20)

| ID     | Severity | Area | Title | Resolved |
| ------ | -------- | ---- | ----- | -------- |
| _none_ |          |      |       |          |

## Adding an issue

1. Find next number = max ever used + 1 (don't reuse)
2. Create `docs/issues/INNN-short-kebab-title.md` with frontmatter:

   ```markdown
   ---
   id: I001
   severity: LOW | MEDIUM | HIGH | CRITICAL
   area: <package or subsystem>
   status: OPEN
   created: YYYY-MM-DD
   ---

   # Title

   ## Description

   What's broken / missing / wrong.

   ## Repro / evidence

   How to see it.

   ## Hypothesis

   What's likely going on.

   ## Resolution

   (filled when work begins)
   ```

3. Add a row to "Open" above
4. When resolved: move row to "Resolved", update frontmatter `status` and `resolved` date
