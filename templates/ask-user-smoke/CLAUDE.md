# ask-user-smoke

## Project Overview

A minimal Python CLI that prints a greeting read from a config file.
Purpose: exercise the worker-subprocess `ask_user` MCP tool end-to-end
(ADR 0024, Phase 8.7 live validation). Keep the surface deliberately
tiny so a `--max-usd 2` run has generous headroom.

## Tech Stack

- Python 3.11+
- pytest
- stdlib only in the core; the config-format choice may add one dep

## Key Modules

1. `src/greet.py` — single-file CLI entry. Parses an optional `--name`
   argument, loads the config, prints `greeting_template.format(name=name)`.
2. `src/config.py` — `load_config(path: str) -> dict[str, str]`. Reads
   the config file and returns the two keys below.

## Config keys

The config file stores exactly two string keys:

- `name` — default value for the greeting target
- `greeting_template` — e.g. `"Hello, {name}!"`

## Config format — operator-deferred (do not guess)

The file format is **not** specified here. Both YAML and TOML are fine
choices; they have different ecosystem implications that the operator
wants to weigh in on.

Before implementing `src/config.py`, the builder **must** call
`ask_user(question="Config format: YAML or TOML?", options=["yaml", "toml"])`
to get the operator's choice. This is the one design call the operator
deliberately reserved — do not guess, do not default.

Implementation notes per the answer:

- **TOML** — use Python 3.11's built-in `tomllib` for reads. Writes (if
  the spec needs them) need `tomli-w`.
- **YAML** — add `PyYAML` to deps. Use `yaml.safe_load` for reads.

Seed the workspace with one example config file named
`config.yaml` or `config.toml` accordingly.

## Coding Standards

- Type hints on public functions
- No bare `except`
- Docstrings on the two public functions in `config.py` and `greet.py`

## Testing

- `pytest` from repo root
- `tests/test_config.py` — load a known config file; assert both keys
  come through as expected strings
- `tests/test_greet.py` — call the greet entry point with a stub config
  dict; assert the formatted output matches `"Hello, World!"` (or the
  chosen default)
