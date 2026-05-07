---
name: error-recovery
description: |
  Diagnose and recover from build failures. Use when tests fail unexpectedly,
  imports break, or the build is stuck. Guides debugging strategy and
  deciding when to fix forward vs. refactor.
---

# Error Recovery

When something breaks, follow this diagnostic process before retrying
blindly. The investigator and fixer agents both load this skill (per
`docs/AGENTS.md`); the role-specific framing comes from their prompt
bodies (`prompts/agents/investigator.md`, `prompts/agents/fixer.md`).

## Step 1: Read the Error

Do not guess. Read the full traceback or error output verbatim:

- **Last line**: the actual error type (e.g. `ImportError`, `TypeError`,
  `ENOENT`, `EACCES`).
- **Middle lines**: the call chain — which function called which.
- **First line**: where the failure originated — often the test or
  entry point.

The fix lives somewhere in the trace. Skipping straight to a retry
without reading wastes a turn and burns budget.

## Step 2: Classify the Failure

### Environment Errors (fix the setup)

- `ModuleNotFoundError` / `Cannot find module` → dependency not installed
- `Permission denied` → wrong file permissions, missing venv
  activation, or a sandbox-boundary violation (see "External" below
  for the ADR 0028 case)
- `command not found` → tool not installed or not on `PATH`
- **Action**: Fix the environment. Don't change source. The
  `dependency-install` skill (if loaded) covers the install path.

### Logic Errors (fix the code)

- `AssertionError` in tests → implementation doesn't match the spec
- `TypeError` / `AttributeError` → wrong types or missing methods
- `KeyError` / `IndexError` → bad assumptions about data shape
- **Action**: Read the failing test, understand what it expects,
  fix the implementation. Don't delete the test to make it pass.

### Design Errors (rethink the approach)

- Circular imports → modules are too coupled; need to split or
  restructure.
- Tests pass individually but fail together → shared state or import
  side effects.
- Same test keeps failing after two fix attempts → the approach is
  wrong.
- **Action**: Step back. Re-read the spec (CLAUDE.md / wiki).
  Consider an alternative design. If the redesign is non-trivial,
  escalate to architect via the planner — don't redesign in flight.

### External Errors (work around or recognise the boundary)

- API rate limits → add retry with backoff, or mock for tests.
- Network timeouts → add a timeout config, fail gracefully on
  expiry.
- "File not found" or "Permission denied" reading a path **outside**
  the worker's sandbox prefix → not a transient external error.
  ADR 0028 scopes worker filesystem access to the project's path
  prefix; reads outside it are rejected by design. Recognise the
  boundary and stay inside it (the project tree is your scope).
- **Action**: Add defensive code at the network boundary; respect
  the sandbox at the filesystem boundary.

## Step 3: Fix and Verify

1. Make the smallest change that addresses the error.
2. Run the failing test again — confirm it now passes.
3. Run the full test suite — confirm nothing else broke.
4. If the fix introduced a new failure, stop and re-read Step 2.

## When to Refactor vs. Patch

**Patch** (quick fix, move on):

- Off-by-one error
- Wrong variable name
- Missing null check
- Typo in import path

**Refactor** (change the structure):

- Third time fixing the same module
- Circular dependency
- One file is over a few hundred lines and tangled
- A test requires mocking five-plus things to work

When you do refactor:

- Move the existing tests to match the new structure first.
- Confirm the tests still define the correct behaviour (they should
  pass against the OLD implementation; the refactor should not
  change the behaviour they exercise).
- Then restructure the code to make them pass under the new shape.
- Commit with a message like `refactor: restructure <module> to fix
<problem>`.

## Stall Prevention — escalate before retrying blindly

If you've spent most of this task on the same error without progress,
the cost of guessing again exceeds the cost of asking. Escalate via
`ask_user` (per ADR 0024 + the `ask-user` skill) rather than retry:

- The error class is genuinely ambiguous and two reasonable fixes
  diverge — ask which the operator wants.
- The fix scope balloons outside your file ownership — ask before
  silently widening.
- The symptom only fires under operator-known context you lack
  (e.g. "did the migration actually run?") — ask.

Investigator-specific framing (per `prompts/agents/investigator.md`):
when you've narrowed a hypothesis, emit it as `HYPOTHESIS:` /
`EVIDENCE:` / `RECOMMENDED NEXT:` blocks. Don't loop forever waiting
for certainty — emit your best guess explicitly framed as one, and
let the operator (or next planner step) act on it.

Fixer-specific framing (per `prompts/agents/fixer.md`): when a fix
genuinely cannot land cleanly inside the finding's scope, emit
`RESOLUTION <FID> (WONTFIX): <reason>` rather than silently leaving
the finding open. The worker parses these markers
(`packages/worker/src/parse-resolutions.ts`) and the registry flips
automatically.

## Things you must NOT do

- Delete a failing test to make the suite green.
- Comment out broken code rather than fixing or removing it.
- Retry the exact same fix that already failed.
- Hide a workaround inside a function without surfacing the
  rationale (commit message, finding, or task summary).
