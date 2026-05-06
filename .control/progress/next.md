# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-06T20:31:45Z by
> `.claude/hooks/regenerate-next-md.sh`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Step 4.7 — refresh [`../../packages/cli/README.md`](../../packages/cli/README.md) to document the five new (or newly-verified) commands shipped in this session: `cancel`, `ask`, `budget set`, `project list/show/delete`, `completion`. Add a Tab completion install section (bash / zsh / pwsh one-liners). Add a row to the subcommand table for each of them. Update `Exit codes:` blocks to match the 4-code surfaces (`cancel` 0/1/2/3; `budget set` 0/1/2; `project delete` 0/1/2; `ask` 0/1/2). Cross-reference [`../../docs/WORKFLOWS.md`](../../docs/WORKFLOWS.md) for the canonical operator loops. **One file, no tests, ~1 commit.** After 4.7: 4.8 (move issues U018-U021 Open → Resolved + verify Tier 4 ROADMAP boxes are all ticked) then 4.9 (`/phase-close` — tag `phase-4-cli-completion-closed`).

## Notes for next session

Phase 4 is **6 of 9 sub-steps closed** (4.1 → 4.6). Three remain:

**Step 4.7 — `packages/cli/README.md` refresh (recommended start):**

Touch one file. Add documentation for the new commands shipped this session:

- `factory cancel <directive-id> [--reason <text>]` — exit codes 0/1/2/3.
- `factory ask "<question>"` — single-shot chat, `--json` shape.
- `factory budget set <project> --max-usd <n> [--max-steps <n>]` — per-field merge, exit codes.
- `factory project list / show <name> / delete <name>` — `--force` and `--purge` semantics.
- `factory completion <shell>` — install one-liners for bash / zsh / pwsh.

Add a Tab completion top-level section. Update the subcommand table (which is missing the five new rows). Cross-reference `docs/WORKFLOWS.md` for canonical operator loops. Suggested commit: `docs(cli): packages/cli/README.md — refresh after Tier 4` (or `docs(4.7)`).

**Step 4.8 — Resolve U018-U021 + verify ROADMAP ticks:**

Move issues U018 (rich --help), U019 (tab completion), U020 (project commands), U021 (budget set) from Open → Resolved in [`../../UPGRADE/ISSUES.md`](../../UPGRADE/ISSUES.md) with full Resolution lines pointing at this session's commits (`91eebca` for U018, `9340cfd` for U019, `9da25ba` for U020, `fa28e6d` for U021). Verify all six Tier 4 ROADMAP rows are ticked (cancel `9da25ba` 4.5; budget `fa28e6d` 4.2; project `9da25ba` 4.3; ask was implicit via this session — should be ticked already; tab completion `9340cfd` 4.5 ✅; rich --help `91eebca` 4.6 ✅). Suggested commit: `chore(4.8): resolve U018-U021 + tick Tier 4 ROADMAP`.

**Step 4.9 — `/phase-close`:**

Run after 4.7 + 4.8. Tag `phase-4-cli-completion-closed`. The phase-close runbook will scaffold Phase 5 if a phase-plan.md entry exists, otherwise the upgrade arc closes out and STATE.md transitions to "all phases complete".

**Estimate:** all three remaining steps fit comfortably in a single short session (~1 hour of session time). 4.7 is a single-file doc edit; 4.8 is mechanical issue moves; 4.9 is `/phase-close`.

**Carry-forward items (still don't block):** Pause primitive; PageShell + `<style is:global>` migration (1-commit sweep); brain-side `log.line` forwarder; chat-page click-test; Control framework 2.2.3 publish; `/session-end` skill lag-by-1 fix (now 10 occurrences).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for the remaining 4.x steps (CLI/docs only) but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.
