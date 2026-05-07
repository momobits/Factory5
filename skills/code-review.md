---
name: code-review
description: |
  Review completed module against CLAUDE.md spec and coding standards.
  Use after completing each module before moving to the next one.
---

# Code Review

Walk this checklist against each module the builders produced. Each
checklist item that fails is a candidate `FINDING`; the reviewer's
prompt body (`prompts/agents/reviewer.md`) sets the framing — this
skill provides the per-item granularity.

## Per-module checklist

### Spec Compliance

- [ ] Module does what the project's spec (CLAUDE.md / wiki) says it should
- [ ] All public functions and methods listed in the spec are implemented with the expected signatures
- [ ] Return shapes match what other modules expect (cite `docs/CONTRACTS.md` or equivalent)
- [ ] Behavior at the documented boundaries (empty input, max input, error cases) matches the spec

### Code Quality

- [ ] Type annotations on all public functions (TypeScript strict mode; Python type hints where the project uses them)
- [ ] Docstrings on all public functions and classes — short but present
- [ ] No bare `except:` (Python) or `catch (e)` that swallows without inspecting (TypeScript) — handle specific cases or rethrow
- [ ] Functions stay focused; split when one is doing too many things
- [ ] Files stay focused; split when a single file mixes too many responsibilities
- [ ] Naming follows the project's convention (snake_case in Python, camelCase / PascalCase in TypeScript) and is consistent within a module

### Security

- [ ] No hardcoded API keys, passwords, secrets, or tokens
- [ ] No `eval()` / `exec()` / `Function()` constructor on dynamic input
- [ ] SQL queries are parameterized — no string concatenation or f-strings on user input
- [ ] User inputs are validated before use (zod / pydantic / explicit checks at the boundary)
- [ ] Sensitive data is not logged (auth headers, tokens, raw secrets, PII)
- [ ] Trust boundaries (HTTP request → handler, IPC → worker, channel → brain) gate inputs explicitly

### Dependencies

- [ ] New imports are declared in the project's manifest (`pyproject.toml`, `package.json`, etc.)
- [ ] No circular imports
- [ ] External calls (network, subprocess) carry timeouts and error handling
- [ ] Native modules build cleanly on the project's target platforms

## Severity grading

Per ADR 0018, reviewer findings flow as **blocking** (every source
except `verifier` defaults to blocking; reviewer is included). The
reviewer prompt body explains the operator-visibility consequences.
Use the four-level severity scale:

- **CRITICAL** — exploitable security bug, data loss, or crash on
  expected inputs. Demands directly observable evidence (shadow test
  or exact reproduction recipe).
- **HIGH** — real bug on plausible inputs, or spec-impl drift on a
  load-bearing surface.
- **MEDIUM** — gap that fires under specific conditions, missing edge
  case, or contract violation that hasn't yet manifested as a bug.
- **LOW** — minor correctness issue, weakly-validated assumption, or
  a finding raised with the "unverified" caveat per the reviewer
  prompt's anti-hallucination rule.

## Output — FINDING marker

Each failing checklist item lands as one line in your prose output:

```
FINDING [LOW|MEDIUM|HIGH|CRITICAL] <target>: <description>
```

`<target>` is a path-like string (`packages/<pkg>/src/<file>.ts:<line>`,
`src/auth/login.py`, `tests/test_foo.py:42`). `<description>` may span
continuation lines until a blank line or the next `FINDING [` marker.
The worker parses these via `packages/worker/src/parse-findings.ts`
(line-anchored regex; case-insensitive on the keyword and severity)
and persists each via `addFinding` with `source: 'reviewer'` stamped
automatically. The per-project `findings.json` is the canonical
persistence surface (per ADR 0021); a cross-project `findings_registry`
mirror is dual-written best-effort when the worker is given a binding.

## Anti-noise rule

A finding consumes operator and fixer attention. Don't raise one for:

- An item the assessor already failed (e.g. `gate.verify === false`).
  Restating that as a finding is noise — the assessor's signal is
  already authoritative.
- Stylistic taste outside the items above (cross-module style drift,
  naming preferences, documentation polish). That is verifier territory
  and flows advisory by default; raising it as a reviewer finding
  mis-tiers the operator's attention.
- An "unverified" hunch unless raised at LOW with the explicit caveat
  in the description, per the reviewer prompt's anti-hallucination
  rule.

If a module passes every item above, emit no FINDING for it. Silence
is a valid outcome.
