# Issues

Internal issue tracker for factory5 itself. Mirrors the finding-lifecycle pattern factory uses on its outputs.

> Individual issues live as `INNN-short-kebab-title.md` next to this index.

## Status legend

- **OPEN** — recognized, not started
- **IN_PROGRESS** — being worked on (set `owner` in frontmatter)
- **RESOLVED** — fix landed, awaiting verification
- **VERIFIED** — fix confirmed (tests pass, behavior correct)
- **WONTFIX** — closed without fix (with rationale)

## Open

| ID                                                              | Severity | Area              | Title                                                                              | Created    |
| --------------------------------------------------------------- | -------- | ----------------- | ---------------------------------------------------------------------------------- | ---------- |
| [I009](I009-telegram-inbound-budget-defaults.md)                | MEDIUM   | channels/telegram | Telegram/Discord inbound doesn't inherit `[budget.defaults]` — builds run uncapped | 2026-04-23 |
| [I012](I012-telegram-reply-matcher-fifo-not-targeted.md)        | LOW      | channels/telegram | Telegram Reply-feature answer matcher is FIFO — can't target a specific question   | 2026-04-23 |
| [I013](I013-worker-worktree-cleanup-blocked-by-node-modules.md) | MEDIUM   | worker/worktree   | Worker's `pnpm install` leaves `node_modules/` that blocks worktree cleanup (Win)  | 2026-04-24 |
| [I014](I014-architect-resume-no-autocommit.md)                  | MEDIUM   | brain/architect   | Architect re-running on existing project leaves wiki edits uncommitted             | 2026-04-26 |

## Resolved (last 20)

| ID                                                           | Severity | Area                    | Title                                                                                                                                           | Resolved   |
| ------------------------------------------------------------ | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [I015](I015-file-sink-logger-silent-fail.md)                 | MAJOR    | @factory5/logger        | File-sink logger silently disabled by transitive `createLogger` calls at module init                                                            | 2026-04-27 |
| [I011](I011-telegram-inbound-no-project-resolution.md)       | HIGH     | channels/telegram       | Telegram inbound doesn't resolve project paths — `/build` fails off factoryd's cwd                                                              | 2026-04-23 |
| [I010](I010-worker-spawn-enoent-junction-cwd.md)             | LOW      | worker/run-worker       | Worker subprocess spawn fails with `ENOENT` when `cwd` is inside a Windows junction (WONTFIX — junction artifact, not reproduced post-I011-fix) | 2026-04-23 |
| [I008](I008-findings-registry-project-id-collision.md)       | MEDIUM   | state/findings-registry | `findings_registry` collides when two workspaces share a project name                                                                           | 2026-04-21 |
| [I007](I007-builder-pip-install-pollutes-user-site.md)       | LOW      | brain/builder           | Builder `pip install -e .` inside worktrees leaves stale `.pth` in user-site                                                                    | 2026-04-19 |
| [I006](I006-assessor-pip-install-pollutes-user-site.md)      | HIGH     | assessor                | Assessor's `pip install -e .` pollutes the user-site Python env — cross-project bleed                                                           | 2026-04-19 |
| [I005](I005-worker-persistfindings-dirties-main-worktree.md) | HIGH     | worker/run-worker       | `persistFindings` dirties main's working tree, blocking merges                                                                                  | 2026-04-19 |
| [I004](I004-worktree-concurrent-merge-race.md)               | HIGH     | worker/worktree         | Concurrent sibling worktree merges silently lose commits                                                                                        | 2026-04-19 |
| [I003](I003-scaffolder-omits-project-hygiene-artifacts.md)   | MEDIUM   | brain/scaffolder        | Scaffolder omits project-hygiene artifacts (README ≥30 lines, LICENSE, .gitignore)                                                              | 2026-04-19 |
| [I001](I001-planner-emits-serial-chain.md)                   | MEDIUM   | brain/planner           | Planner emits a fully serial task chain on simple specs                                                                                         | 2026-04-19 |
| [I002](I002-assessor-inherits-host-python-env.md)            | HIGH     | assessor                | Assessor inherits host's Python env — no venv, no deps, no pin                                                                                  | 2026-04-19 |

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
