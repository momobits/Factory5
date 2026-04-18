---
name: test-driven-development
description: |
  Enforce strict RED/GREEN/REFACTOR for every module. Write the failing test
  first, then implement. Use when building any module from CLAUDE.md.
---

# Test-Driven Development

Every module MUST be built using TDD. No exceptions.

## The Cycle

### 1. RED — Write the failing test first

Before writing ANY implementation code for a module:

```bash
# Python example
# Create test file: tests/test_<module>.py
# Write test cases that define the module's expected behavior
# Run: python -m pytest tests/test_<module>.py -v
# CONFIRM: tests FAIL (because implementation doesn't exist yet)
```

Test what matters:
- Happy path: normal inputs → expected outputs
- Edge cases: empty inputs, None, zero, max values
- Error cases: invalid inputs → proper exceptions
- Integration: does it work with other modules that exist?

### 2. GREEN — Write minimal code to pass

- Implement ONLY what's needed to make the tests pass
- Don't over-engineer. Don't add features not tested.
- Run tests after each function: `python -m pytest tests/test_<module>.py -v`
- CONFIRM: all tests PASS

### 3. REFACTOR — Clean up while tests stay green

- Remove duplication
- Improve naming
- Add type hints and docstrings
- Run tests again to confirm nothing broke

### 4. COMMIT

```bash
git add src/<module>.py tests/test_<module>.py
git commit -m "feat: implement <module> with tests"
```

## Rules

- NEVER write implementation before tests
- NEVER commit code with failing tests
- If you catch yourself writing code first, STOP, delete it, write the test
- One module at a time. Don't start module B until module A's tests pass.
- Mock external dependencies (API calls, databases) in unit tests
- Use fixtures for shared test data

## Test File Conventions

Python:
- Test files: `tests/test_<module>.py`
- Use pytest, pytest-asyncio for async
- Use `unittest.mock` for mocking
- Fixtures in `tests/conftest.py`

TypeScript:
- Test files: `src/<module>.test.ts` or `__tests__/<module>.test.ts`
- Use vitest or jest
- Use `vi.mock()` / `jest.mock()` for mocking
