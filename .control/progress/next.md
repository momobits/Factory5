# Next session — paste this to start

Phase 15 closed still-quiet 2026-04-28 (tag `phase-15-demand-driven-runoff-closed`). **Zero sub-steps shipped.** Phase content across its lifetime: scaffold + 1 still-quiet pass-through + close commit. The carry-forward candidate pool (Bash sandboxing, `/build` flag parsing, network egress scoping, orphan `node.exe`, Phase 6 follow-ups) stayed deferral-predicate-unsatisfied throughout — no incident, no operator request, no demand signal.

**Active Control phase chain exited.** No Phase 16 scaffolded. Future sessions bootstrap into a dormant state, not a paused phase. The framework supports re-entry from the dormant state when a demand signal surfaces.

Workspace at exit: **876 tests** green across 15 packages (last gate, Phase 14.5 close — unchanged across Phase 15 because no code changed). lint + format + build clean from that same gate. `docs/issues/INDEX.md` Open empty (4th session in a row). `origin/main` synced. 28 ADRs, 8 migrations, 15 packages + 3 apps. No `CompleteArchitecture.md` change in Phase 15.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md`. **There is no current phase README/steps.md to read** — the active Control phase chain exited at Phase 15 close. Last phase artifact (closed, not active): `.control/phases/phase-15-demand-driven-runoff/`. Detailed phase shape: `docs/Phase15_Progress.md`.

Run `/session-start` for the full drift check. The git verification will confirm the close tag + branch position.

## Recommended next action — two branches

1. **A demand signal has surfaced.** New issue, incident, smoke finding, operator feature request, anything. Scaffold Phase 16 against it:

   - Pick a short name reflecting the actual bite (don't pre-cook).
   - Create `.control/phases/phase-16-<short-name>/{README.md,steps.md}` modelled on the Phase 14 or Phase 15 templates.
   - Update STATE.md: `Current phase: 16 — <name>`, `Current step: 16.1 — <bite-specific subject>`, refresh "Next action" to point at 16.1's concrete first move.
   - Open 16.1 against the bite. Commit shape: `<type>(16.1): <subject>`.
   - The framework supports this re-entry path fully — the dormant state is not a special case.

2. **Nothing has surfaced.** Confirm state, end the session. The dormant state has zero per-session protocol overhead — no "still-dormant pass" pattern is needed (unlike Phase 15's still-quiet pass shape, which existed because the phase was nominally open). If nothing changed at all this session, even the session-end docs commit can be skipped.

## Out-of-band operator actions (no Claude involvement, doable any time)

- Kill the orphan `node.exe` on port 25295 (older Node install at `C:\Program Files (x86)\nodejs\node.exe`, identified Phase 14.1, not from factory5). Or change factoryd's default port if you'd rather sidestep it.
- PAT revocation — Phase 6 hold-over.
- `gh repo delete` — Phase 6 hold-over.
- Env var cleanup — Phase 6 hold-over.

None of these need a phase frame.

## Carry-forward candidate pool (for whenever Phase 16 opens, all still non-blocking)

1. **Bash sandboxing** — ADR 0028 §4 deferred. Open only on a real incident: a worker doing something with `Bash` that should have been gated. Phase 12.4 + 13.x + 14.x + Phase 15's still-quiet pass all produced **zero** `decision":"deny"` lines.
2. **`/build` flag parsing on Telegram + Discord** — operator-request-driven. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists.
3. **Network egress scoping** — long-tail, demand-driven.
4. **Orphan `node.exe` on port 25295** — operator-side action (see above).
5. **Phase 6 operator follow-ups** — out-of-band (see above).
6. **Anything new the operator surfaces.**

## Out of scope (still deferred)

- **Worker-subprocess `ask_user`** — fully covered by ADR 0024 + Phase 8 implementation; no follow-up.
- **Discord per-question reply matcher** — Phase 7c live data showed no equivalent FIFO mismatch on Discord; one-line wiring if it ever surfaces.
- **Web UI extensions** — covered by ADR 0025 + 0027 + Phase 11. Future Web UI work would be its own phase.

## Stable-state observation (final, pre-dormancy)

factory5's open issue tracker is empty, all carry-forwards from Phases 9–14 are addressed, Phase 15's paused-state closed without sub-steps, and the codebase is at the most stable point in its history. Closing the Control phase chain is the most accurate signal of project state — there is no active work, and no work demands a phase frame.

Report back on wake-up with a status block:

```
No active phase — Control phase chain dormant since 2026-04-28
Last action: chore(phase-15) <sha> — close phase 15 still-quiet
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-15-demand-driven-runoff-closed
Open blockers: 0   |   Open issues: 0
Proposed next action: if something has surfaced — scaffold Phase 16 against it; otherwise — confirm + end the session
Ready to proceed?
```
