# Phase 15 Steps — Demand-driven runoff

> **Phase opens when something bites.** Sub-step subjects below are
> placeholders. Each sub-step body grows when its session opens —
> bound to whichever demand signal is biting the operator at that
> moment.
>
> If nothing has bitten by the next session, the right move is to
> do nothing. Phase 15 is a paused state, not a queued backlog.
>
> **Phase 15 closed still-quiet on 2026-04-28** — neither 15.1 nor
> 15.2 ever opened (no demand signal surfaced across two session
> boundaries). The 15.x close was a one-commit operation. Boxes
> left unticked are accurate: those sub-steps did not happen.

## Phase 15 — Demand-driven runoff

- [ ] 15.1 — **First demand signal.** Opens against whichever item
      from the README candidate pool fires first. Likely candidates:
      Bash sandboxing (incident-driven), `/build` flag parsing on
      Telegram/Discord (operator-request-driven), network egress
      scoping (demand-driven), orphan `node.exe` on port 25295
      investigation, or any new issue surfacing from operator usage.
      _(Never opened — phase closed still-quiet on 2026-04-28.)_

- [ ] 15.2 — _(if any)_ **Second sub-step.** Same shape as 15.1.
      _(Never opened — see 15.1.)_

- [x] 15.x — **Phase close.** Tagged `phase-15-demand-driven-runoff-closed`
      on the close commit. Authored `docs/Phase15_Progress.md` recording
      dormancy; prepended a Phase 15 entry to `docs/PROGRESS.md`. **No
      `CompleteArchitecture.md` change** — still-quiet close ships no
      architecture. **No Phase 16 scaffolded** — Control phase chain is
      dormant until new work demands a phase frame.
