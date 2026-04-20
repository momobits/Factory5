---
description: Add a new artifact to the project spec (evolution, addendum, pivot, deep-dive)
argument-hint: <slug>
---

Create a new spec artifact at `.control/spec/artifacts/<YYYY-MM-DD>-$ARGUMENTS.md` from `.control/templates/spec-artifact.md`.

Artifacts are the mechanism by which the project spec grows over time without rewriting `SPEC.md` on every iteration. Use them for:

- **Addendums** that extend the original spec with new sections
- **Pivots** where a decision in `SPEC.md` has been revised (record what changed + why)
- **Deep-dives** on a specific subsystem that wasn't detailed in the original
- **Discovered constraints** that only surfaced during implementation

## Process

1. Ask the user:
   - **Title** -- short descriptive name
   - **Kind** -- addendum | pivot | deep-dive | constraint | other
   - **Scope** -- which part of `SPEC.md` (or prior artifacts) this touches; if it supersedes anything, note it
   - **Summary** -- one paragraph describing the artifact's content

2. Create `.control/spec/artifacts/<today>-$ARGUMENTS.md` from the template, populated with the user's inputs.

3. If the artifact **supersedes** content in `SPEC.md` or an earlier artifact, add a prominent `**Supersedes:**` field near the top of the new artifact. Do NOT edit `SPEC.md` itself -- the superseded section stays there for historical record; the artifact is authoritative from its date forward.

4. If the artifact affects the phase plan (e.g. a new phase, a changed outcome, a dropped step), update `.control/architecture/phase-plan.md` to reference the artifact and describe the change. Example:
   ```
   Phase 4 outcome updated by .control/spec/artifacts/2026-05-01-pivot-central-store.md (was Postgres; now Postgres + Redis).
   ```

5. Update `.control/progress/STATE.md`'s "Recent decisions" section to note the new artifact with its date.

6. Commit: `docs(spec): add artifact <today>-$ARGUMENTS -- <summary-short>`.

7. Journal entry: `- Added spec artifact <today>-$ARGUMENTS -- <title> (<kind>)`.

## Guardrails

- **Do not edit `SPEC.md` directly** after bootstrap. Grow the spec via artifacts instead. This keeps history auditable.
- **Artifacts are authoritative from their date** -- when conflicts arise, newer artifacts win over older content. Derived docs should reflect this.
- **If an artifact invalidates a closed phase's done criteria**, flag it as a blocker -- you may need to revisit that phase.
