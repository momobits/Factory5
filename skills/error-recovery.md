---
name: error-recovery
description: |
  Diagnose and recover from build failures. Use when tests fail unexpectedly,
  imports break, or the build is stuck. Guides debugging strategy and
  deciding when to fix forward vs. refactor.
---

# Error Recovery

When something breaks, follow this diagnostic process before retrying blindly.

## Step 1: Read the Error

Do not guess. Read the full traceback or error output.

- **Last line**: the actual error (e.g., `ImportError`, `TypeError`, `ENOENT`)
- **Middle lines**: the call chain — which function called which
- **First line**: where it started — often the test or entry point

## Step 2: Classify the Failure

### Environment Errors (fix the setup)

- `ModuleNotFoundError` / `Cannot find module` → dependency not installed
- `Permission denied` → wrong file permissions or missing venv activation
- `command not found` → tool not installed or not on PATH
- **Action**: Fix the environment, don't change code

### Logic Errors (fix the code)

- `AssertionError` in tests → implementation doesn't match spec
- `TypeError` / `AttributeError` → wrong types or missing methods
- `KeyError` / `IndexError` → bad assumptions about data shape
- **Action**: Read the failing test, understand what it expects, fix the implementation

### Design Errors (rethink the approach)

- Circular imports → modules are too coupled, need to split or restructure
- Tests pass individually but fail together → shared state or import side effects
- Same test keeps failing after 2 fix attempts → the approach is wrong
- **Action**: Step back. Re-read CLAUDE.md. Consider an alternative design. Note the decision in BUILD.md

### External Errors (work around)

- API rate limits → add retry with backoff, or mock for tests
- Network timeouts → add timeout config, fail gracefully
- File not found → check paths are relative to project root, not CWD
- **Action**: Add defensive code, don't assume external services are reliable

## Step 3: Fix and Verify

1. Make the smallest change that fixes the error
2. Run the failing test again — confirm it passes
3. Run the full test suite — confirm nothing else broke
4. If the fix introduced a new failure, stop and re-read Step 2

## When to Refactor vs. Patch

**Patch** (quick fix, move on):

- Off-by-one error
- Wrong variable name
- Missing null check
- Typo in import path

**Refactor** (change the structure):

- Third time fixing the same module
- Circular dependency
- Module is over 300 lines and tangled
- Test requires mocking 5+ things to work

When refactoring:

- Move the current tests to match the new structure FIRST
- Confirm tests still define the correct behavior
- Then restructure the code to pass them
- Commit with message: `refactor: restructure <module> to fix <problem>`

## Stall Prevention

If you've been working on the same error for most of this iteration:

1. Document the error and what you tried in BUILD.md Issues
2. Move on to the next module if possible
3. Come back to it in a later iteration with fresh context

Do NOT:

- Delete a failing test to make the suite pass
- Comment out broken code
- Skip updating BUILD.md because you're frustrated
- Retry the exact same fix that already failed
