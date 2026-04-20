# Parallel Example CLI

## Project Overview

A tiny command-line toolbox with two **completely unrelated** utilities
exposed via a single dispatcher. Built as a factory5 reference project
for validating that the planner lets independent modules run in parallel.

## Tech Stack

- Python 3.11+
- Standard library only (no third-party dependencies)
- pytest for tests

## Key Modules

1. `src/rot13.py` — a ROT13 cipher. Exposes `encode(text: str) -> str`
   which rotates each ASCII letter by 13 positions (a↔n, b↔o, …);
   non-letter characters pass through unchanged. Pure string work.
   **Imports nothing from the other modules in this project.**
2. `src/art.py` — an ASCII-art text renderer. Exposes
   `render(text: str) -> str` which returns the same string rendered as
   a simple block-letter banner (one small hand-rolled character table
   is fine — no third-party art libs). Pure string work.
   **Imports nothing from the other modules in this project.**
3. `src/cli.py` — the dispatcher. Exposes two subcommands `rot13` and
   `art`; parses `sys.argv` with `argparse`; delegates to
   `rot13.encode()` and `art.render()`. This is the only module that
   imports both utilities.

## Coding Standards

- Type hints on all public functions
- Short docstrings on public functions — plain prose, no code blocks
- Keep module documentation and the wiki free of data-structure
  literals (no JSON or dict examples) — string-in/string-out descriptions
  only
- Catch specific exceptions (`ValueError`) — never bare `except`

## Testing

- pytest
- `tests/test_rot13.py` covers the cipher in isolation (letter-case
  preservation, non-letter passthrough, double-encode returns original)
- `tests/test_art.py` covers the renderer in isolation (single letter,
  multi-letter, empty string, unsupported characters)
- `tests/test_cli.py` exercises the dispatcher end to end — `rot13`
  subcommand with a short string, `art` subcommand with a short word
- Target: each utility fully covered; dispatcher covered on both
  subcommands + one error path
