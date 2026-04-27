# Phase 15 Steps — Demand-driven runoff

> **Phase opens when something bites.** Sub-step subjects below are
> placeholders. Each sub-step body grows when its session opens —
> bound to whichever demand signal is biting the operator at that
> moment.
>
> If nothing has bitten by the next session, the right move is to
> do nothing. Phase 15 is a paused state, not a queued backlog.

## Phase 15 — Demand-driven runoff

- [ ] 15.1 — **First demand signal.** Opens against whichever item
      from the README candidate pool fires first. Likely candidates:
      Bash sandboxing (incident-driven), `/build` flag parsing on
      Telegram/Discord (operator-request-driven), network egress
      scoping (demand-driven), orphan `node.exe` on port 25295
      investigation, or any new issue surfacing from operator usage.

- [ ] 15.2 — _(if any)_ **Second sub-step.** Same shape as 15.1.

- [ ] 15.x — **Phase close.** Tag
      `phase-15-demand-driven-runoff-closed`. Author
      `docs/Phase15_Progress.md`, prepend a Phase 15 entry to
      `docs/PROGRESS.md`. Likely no `CompleteArchitecture.md`
      change unless Bash sandboxing fires and warrants ADR 0029.
      Scaffold Phase 16 by demand signal (or close the
      Control-managed phase chain if the codebase remains stable
      and no new work demands a phase frame).
