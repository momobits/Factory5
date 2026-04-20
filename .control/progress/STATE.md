# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.
>
> **This is the initial template.** On first install, fill in the project-specific
> fields below. The "Current phase" stays as "not-yet-defined" until you complete
> `/bootstrap` (or fill `.control/architecture/phase-plan.md` and scaffold Phase 1 manually).

**Last updated:** <YYYY-MM-DD HH:MM UTC> by setup
**Current phase:** not-yet-defined
**Current step:** n/a (bootstrap -- no phase started)
**Status:** needs-bootstrap

---

## Project spec
**Canonical:** `.control/spec/SPEC.md` (not yet populated -- run `/bootstrap <spec-file>` or `/bootstrap` to scan)
**Artifacts:** `.control/spec/artifacts/` (evolutions of the spec over time)
**Role:** Source of truth for project content. When distilled docs (overview, phase-plan, phase READMEs) disagree with the spec, the spec wins. Consult specific sections by reference when steps cite them. Newest artifact wins over `SPEC.md` on conflicts.

---

## Next action
Run `/bootstrap <path-to-your-spec-file.md>` if you have a spec, OR `/bootstrap` (no args) to let Claude scan the codebase and produce a starter `.control/spec/SPEC.md` through a guided questionnaire.

After bootstrap populates everything, run `/session-start` to begin Phase 1.

---

## Git state
- **Branch:** main
- **Last commit:** <short-sha> -- chore: install Control framework
- **Uncommitted changes:** none
- **Last phase tag:** `protocol-initialised` (set by setup.sh)

---

## Open blockers
- None

---

## In-flight work
- None -- fresh install.

---

## Test / eval status
- **Last test run:** n/a (no tests yet)
- **Eval score** (agent phases only): n/a
- **Regression tests:** n/a

---

## Recent decisions (last 3 ADRs)
- No ADRs yet. First ADR typically captures the tech-stack decision or project charter.

---

## Recently completed (last 5 steps)
- Installed Control framework -- <YYYY-MM-DD> -- commit `<short-sha>`, tag `protocol-initialised`

---

## Attempts that didn't work (current step only)
- None yet.

---

## Environment snapshot
- **Language / runtime:** n/a -- project stack not yet decided
- **Key pinned deps:** n/a
- **Model in use:** n/a
- **Other:** n/a

---

## Notes for next session
Project just scaffolded with Control. Priority is running `/bootstrap` to populate the canonical spec at `.control/spec/SPEC.md` plus all derived docs. Read `.control/PROJECT_PROTOCOL.md` at the root for the full framework reference.
