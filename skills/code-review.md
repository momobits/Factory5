---
name: code-review
description: |
  Review completed module against CLAUDE.md spec and coding standards.
  Use after completing each module before moving to the next one.
---

# Code Review

After completing a module (tests pass, committed), review it before moving on.

## Review Checklist

### Spec Compliance
- [ ] Module does what CLAUDE.md says it should
- [ ] All functions/methods listed in spec are implemented
- [ ] Return types match what other modules expect

### Code Quality
- [ ] Type hints on all public functions
- [ ] Docstrings on all public functions and classes (Google style)
- [ ] No bare `except:` — catch specific exceptions
- [ ] No `pass` in except blocks — at minimum log the error
- [ ] Functions under 50 lines (split if longer)
- [ ] Files under 300 lines (split if longer)
- [ ] Consistent naming: snake_case (Python) or camelCase (TypeScript)

### Security
- [ ] No hardcoded API keys, passwords, or secrets
- [ ] No `eval()` or `exec()`
- [ ] SQL uses parameterized queries (no f-strings in SQL)
- [ ] User inputs are validated before use
- [ ] Sensitive data not logged

### Dependencies
- [ ] New imports are in requirements/package.json
- [ ] No circular imports
- [ ] External calls have timeout and error handling

## Action on Issues

- **CRITICAL** (security, data loss, crashes): Fix NOW before moving on
- **WARNING** (missing types, poor naming): Fix if quick, otherwise add to BUILD.md Issues
- **INFO** (style, minor improvements): Note in BUILD.md, fix during final polish

## Output

After review, add a one-line summary to BUILD.md:
```
- [x] Module: sentinel/profiler.py (tests: 4 pass, review: clean)
- [x] Module: sentinel/scorer.py (tests: 6 pass, review: 1 WARNING — missing docstring on _normalize)
```
