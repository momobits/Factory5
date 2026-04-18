---
name: integration-testing
description: |
  Write integration tests that verify modules work together. Use after
  50% or more of the modules are implemented and passing unit tests.
---

# Integration Testing

Unit tests prove each module works alone. Integration tests prove they work together.

## When to Write Integration Tests

- After 50%+ of modules from CLAUDE.md are implemented with passing unit tests
- After implementing a module that depends on 2+ other modules
- Before declaring FACTORY_COMPLETE

## What to Test

### Data Flow
Test that data passes correctly between modules end-to-end:
```
Input → Module A → Module B → Module C → Expected Output
```

Write a test that feeds real (not mocked) input into the first module and checks the final output from the last module.

### Entry Points
Test the main entry point (CLI, API endpoint, main function) with realistic inputs:
- Does `python -m <package>` run without error?
- Does the CLI parse arguments and produce output?
- Does the API return valid responses?

### Error Propagation
Test that errors in one module surface correctly:
- Module A returns invalid data → Module B raises a clear error (not a cryptic crash)
- External service is down → graceful error message, not a traceback

## How to Write Them

### File Location
```
Python:  tests/test_integration.py
TypeScript:  src/__tests__/integration.test.ts
```

### Structure

```python
"""Integration tests — modules working together."""

class TestPipeline:
    """Test the full data flow from input to output."""

    def test_end_to_end_happy_path(self):
        """Feed valid input through the full pipeline."""
        # Use REAL modules, not mocks
        # Only mock external services (APIs, databases)
        result = pipeline.run(sample_input)
        assert result.status == "success"
        assert len(result.data) > 0

    def test_end_to_end_bad_input(self):
        """Verify the pipeline handles bad input gracefully."""
        result = pipeline.run(invalid_input)
        assert result.status == "error"
        assert "expected" in result.message.lower()
```

### Rules

- **No mocking between internal modules** — the point is to test real wiring
- **Mock only external boundaries** — APIs, databases, file systems if needed
- **Use realistic data** — not trivial examples, but representative inputs
- **Keep them fast** — integration tests should run in seconds, not minutes
- **Separate from unit tests** — use a different file or test marker

## After Writing Integration Tests

1. Run them: `python -m pytest tests/test_integration.py -v`
2. If they fail, the bug is in the wiring between modules — check:
   - Return types: does Module A return what Module B expects?
   - Import paths: is everything importing from the right place?
   - Shared state: are modules accidentally sharing mutable state?
3. Fix the wiring, re-run, confirm all pass
4. Run the full suite (unit + integration) to confirm nothing regressed
5. Update BUILD.md: `- [x] Integration tests (X pass)`
