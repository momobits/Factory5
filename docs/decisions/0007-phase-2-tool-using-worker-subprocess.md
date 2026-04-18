# 0007 — Phase 2 tool-using worker subprocess

- **Status:** Accepted
- **Date:** 2026-04-18
- **Supersedes:** 0006

## Context

ADR 0006 scoped Phase 1 workers to single-shot provider calls so the full
directive lifecycle could be wired end-to-end first. Phase 2 lifts that
restriction so `factory build example` actually produces runnable source
code. The subprocess path, tool whitelist, worktree isolation, and NDJSON
streaming are each non-trivial enough that collapsing them into one ADR
obscures the rationale; this ADR only covers the execution-mode split.

Not every agent should get a tool-using subprocess. Triage / architect /
planner / reviewer / investigator / verifier emit structured JSON or
narrative findings — their outputs are better parsed than written. Only
scaffolder / builder / fixer need to touch the filesystem.

## Decision

`runWorker` branches on `task.agent`:

- **Read-only path** (`triage | architect | planner | reviewer | investigator | verifier`):
  unchanged from Phase 1 — a single `provider.call()` with `--output-format json`.
  Response text is scanned for `FINDING [...]` markers, which are persisted
  via `@factory5/wiki`. No worktree is allocated.

- **Tool-using path** (`scaffolder | builder | fixer`):
  1. Allocate a per-task git worktree (see ADR 0008).
  2. Call `provider.stream()` with
     - `cwd = worktree.path`
     - `allowedTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']`
       (overridable per call; default shared across the three roles)
     - `permissionMode = 'bypassPermissions'`
       (translated to `--dangerously-skip-permissions` by the claude-cli
       provider — the single flag with the widest CLI-version compatibility
       for unattended operation)
     - `max-turns = 20` (enforced provider-side; prevents runaway loops)
  3. Accumulate assistant-text deltas into `rawResponse`; the terminal
     chunk from the `result` event carries final usage.
  4. Compute `filesChanged` from the worktree (uncommitted `git status` ∪
     `git diff --name-only base..HEAD`).
  5. Parse findings out of `rawResponse` exactly like the read-only path.
  6. Hand the worktree to `cleanupWorktree` with the task outcome (ADR 0008).

The worker package continues to be acyclic-DAG-clean: brain → worker, not
the other way. The agent registry's `tools` field is no longer aspirational
— for tool-using roles it's the canonical whitelist, passed verbatim into
`ProviderRequest.allowedTools`. The default in `runWorker` is used only
when the brain doesn't supply one.

## Consequences

**Positive:**

- `factory build example` can now produce real source code; the assessor's
  pytest gate can actually be exercised against a working project.
- Read-only agents keep their cheap single-shot path — we don't pay the
  subprocess startup cost for triage calls.
- Tool whitelist per role lets us tighten an agent's blast radius (e.g.
  a future `dependency-scanner` role could get `Read + Bash + Grep` only).
- `permissionMode: 'bypassPermissions'` is safe inside a worktree because
  the agent cannot escape its `cwd` via the built-in tools; any damage is
  bounded to the worktree, which is thrown away on failure.

**Negative:**

- Subprocess + streaming + worktree raises the minimum working config for
  `factory build`: the user's `claude` CLI must support `-p`,
  `--output-format stream-json`, `--allowedTools`, and
  `--dangerously-skip-permissions`. We check `claude --version` via
  `factory doctor`; version-specific incompatibilities will surface as a
  subprocess exit code, not a silent failure.
- Observability is coarser than token-level streaming — each chunk is an
  entire assistant message, not a token delta. Acceptable for now; genuine
  token-level streaming would require either a richer CLI flag or an
  anthropic-api provider. Either can slot in via the existing
  `ProviderStreamChunk` contract.

**Reversible?** Yes. Flipping a role back to read-only is a one-line
change in `isToolUsingAgent`. Rolling back entirely is a git revert.

## Alternatives considered

- **Also send architect/reviewer through the tool-using path.** Rejected
  for this phase: their outputs are JSON the brain validates and persists.
  Letting them write wiki pages directly via `Write` tool use couples them
  to a specific provider's tool semantics and bypasses the Zod envelope
  that catches malformed model output.
- **Use `call()` with `--output-format json` plus tools.** Rejected: the
  JSON envelope is emitted only after the agentic loop completes, so
  failures (or long-running builds) are opaque until the very end.
  `stream-json` lets us persist progress (and in future, surface live
  output to the user) without changing the envelope contract.
- **Invent a text-based file-write protocol the worker parses.** Rejected
  (same reasoning as ADR 0006): the CLI's own file-edit tools are already
  the right abstraction — reinventing would cost more and deliver less.
