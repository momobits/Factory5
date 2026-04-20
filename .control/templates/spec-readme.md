# Project Spec

This directory holds the canonical project spec and its evolution.

## Files

- **`SPEC.md`** -- the canonical project spec. Source of truth for scope, architecture, decisions, and design rules. Distilled docs (`.control/architecture/overview.md`, `.control/architecture/phase-plan.md`, per-phase READMEs) derive from this file; when they disagree with `SPEC.md`, `SPEC.md` wins.

- **`artifacts/`** -- evolutions of the spec over time. Addendums, pivots, deep-dives, discovered constraints. Each artifact is dated and named. Newer artifacts take precedence over conflicting content in `SPEC.md` or older artifacts.

## How the spec grows

- **At project start:** `/bootstrap <spec-file>` copies your spec into `SPEC.md`, or `/bootstrap` (no args) scans the codebase and prompts you to produce one.
- **During the project:** `/new-spec-artifact <slug>` creates a new dated artifact whenever a decision changes, a subsystem is detailed, or a constraint is discovered.

## Do not

- Edit `SPEC.md` directly after bootstrap. Grow the spec via artifacts so history stays auditable.
- Rename `SPEC.md` to anything else. All Control-managed references use this canonical path.

## Authority order

1. Newest artifact (by date)
2. ...earlier artifacts (by date)
3. `SPEC.md` (original bootstrap content)

If a distilled doc (e.g. `phase-plan.md`) appears out of date against the spec, update the distilled doc -- not the spec.
