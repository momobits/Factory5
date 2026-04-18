# 0006 — Phase 1 inline pipeline uses single-shot provider calls, not tool-loop subprocesses

- **Status:** Superseded by [0007](0007-phase-2-tool-using-worker-subprocess.md)
- **Date:** 2026-04-18

## Context

The v0 architecture (`CompleteArchitecture.md` §7) describes workers that
spawn `claude -p` directly with `Write`/`Edit`/`Bash` tools enabled, so the
coding agent writes files to the worktree autonomously. That is still the
target.

Phase 1, however, has one goal: get the pipeline — `factory build <project>`
→ triage → architect → plan → delegate → assess → summary — wired
end-to-end against a real provider. Building a robust worktree + tool-loop
harness (subprocess lifecycle, streaming output, per-tool heartbeats, cancel
signals, worktree cleanup, concurrent worker pool) is its own half of the
work and was scoped to Phase 2. Blocking Phase 1 on it would mean nothing
runs until both halves are done.

## Decision

Phase 1 workers make a **single-shot, non-tool-using provider call** for
each task. The prompt carries wiki + finding context; the response text is
parsed for `FINDING [SEV] target: description` markers (the finding
lifecycle) and persisted via `@factory5/wiki`. No files are written by the
agent — the agent's response is text, and findings are the structured output.

Implications, chosen deliberately:

- Phase 1 `factory build` produces a wiki, a plan, a findings table, and
  an assessor report. It **does not produce runnable source code** unless
  the user ran an additional scaffolding step.
- The worker → provider path is minimal: `registry.resolve(category)` →
  `provider.call({ systemPrompt, messages })`. No streaming deltas are
  persisted; the one-shot response is the unit.
- Architect and planner output is constrained to a JSON envelope
  (`{ pages: [...] }`, `{ tasks: [...] }`) that the brain validates with
  Zod and then materializes (write wiki pages, write plan.json).
- `@factory5/providers/claude-cli` uses `claude -p --output-format json`
  and pipes the prompt via stdin (so argv escaping on Windows is not in
  the hot path).

## Consequences

**Positive:**

- The full directive lifecycle (SQLite insert → claim → triage → architect
  → plan → delegate → assess → terminal status) is exercised against a
  real provider. Every seam is either real or has a typed contract.
- Every provider call records into `model_usage` today, so budget telemetry
  is live from day 1 of Phase 1 (not Phase 2).
- The worker interface is already shaped for the Phase 2 upgrade: swap
  the body of `runWorker` for a subprocess-spawning implementation; its
  `WorkerOutcome` shape (findings, usage, exit code) is the same.
- Findings + BUILD.md + readiness gate are exercised under real load,
  so bugs in those (e.g. the Windows `dirname` bug the wiki tests caught)
  show up now rather than mixed in with worktree issues later.

**Negative:**

- `factory build example` does not yet produce a working Python CLI — it
  produces a design + plan + assessor report. That's a real gap from the
  §7 vision, flagged clearly to users in the output and in `docs/PROGRESS.md`.
- Agents accustomed to writing to disk via Claude Code tool use will
  produce text-only outputs in Phase 1. Prompts are already written with
  "respond in this exact JSON shape" framing so this is the expected mode.
- The `builder` agent as registered can't actually build files until Phase 2;
  the planner will still emit builder tasks (cheap; they just produce
  findings, no code). Real building lands in Phase 2 when workers can
  invoke tools.

**Reversible?** Yes. Phase 2 replaces the body of `runWorker` and may
optionally add a `providerOverride` path to skip registry resolution
(direct subprocess). No public API changes required.

## Alternatives considered

- **Ship Phase 2 and Phase 1 together.** Rejected: delays every downstream
  task (CLI, assessor, state wiring) by weeks without any interim value.
- **Use the Anthropic SDK directly instead of the Claude CLI.** Rejected
  for v0: the CLI uses the user's existing subscription without requiring
  an API key. ADR 0004's chain design means we can add `anthropic-api` as
  a fallback without changing the brain.
- **Have the architect write wiki pages directly via tool use in its own
  provider call.** Rejected: couples the architect to a specific provider's
  tool-use semantics, and we don't yet have the worktree isolation to run
  that safely.
- **Have the worker parse agent output for file-write markers and apply
  them.** Rejected as brittle. Let Phase 2 do file writes the right way
  (via the coding-agent CLI's own file-edit tools) rather than inventing a
  fragile text protocol we'd have to maintain.
