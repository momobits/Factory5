# Next session — paste this to start

Phase 7 closed (tag `phase-7-closed`). All three sub-phases shipped:
7a budget enforcement, 7b spend dashboard, 7c Telegram channel. 463
tests across 13 packages; no open blockers.

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`docs/Phase7_Progress.md` for the full Phase 7 close (done criteria,
carry-forward, ADRs 0020/0021/0022).

## Decisions awaiting your input

**Phase 8 charter.** Three live options (no HALT, pick based on what's
most painful in the current surface):

1. **Web UI** — browser-based operator dashboard served by `factoryd`
   (Fastify is already the IPC server, so the delta is templates +
   static assets + one or two new routes). Wraps `factory spend`,
   directive queue, outbound message history, and pending-question
   answer UI. Probably the largest operator-visible upgrade. Budget:
   3–5 sessions.
2. **Assessor tier-3** — language-aware project environments beyond
   the current Python venv (Node `package.json` scripts, Go modules,
   Rust cargo). Unblocks "factory builds in $language" beyond the
   current Python bias. Budget: 2–3 sessions.
3. **Worker-subprocess `ask_user`** — surface the brain's existing
   `askUser` tool to tool-using workers so a mid-build agent can
   escalate interactively rather than marking blocked. Cleanest fix
   for "agent gets confused and silently thrashes" cases that
   budget enforcement in 7a only bounds rather than resolves.
   Budget: 2–3 sessions.

**How to pick:** tell me which one lands next, or describe a fourth
problem you'd rather solve. I'll open
`.control/phases/phase-8-<name>/README.md` + `steps.md` from the
chosen charter.

Once picked:

1. Author `.control/phases/phase-8-<name>/README.md` with goal,
   sub-phase schedule, done criteria, rollback plan.
2. Expand `steps.md` placeholders — first sub-phase in detail, rest
   as outlines.
3. Begin the first sub-step.

Report back a 5-line status in this shape:

```
Phase 7 — CLOSED (tag phase-7-closed; 463 tests; 22 ADRs)
Last action: Phase 7c + Phase 7 closed (commits 74ad146 → <close sha>; tag phase-7-closed; 463 tests green)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=phase-7-closed
Open blockers: 0
Proposed next action: Phase 8 charter — operator to pick between Web UI / Assessor tier-3 / worker-subprocess askUser
Ready to proceed?
```

**Operator follow-up from Phase 6 close (still out-of-band whenever
convenient, none blocks Phase 8):** revoke the `env:GITHUB_TOKEN` PAT
at https://github.com/settings/tokens, delete the throwaway repo
(`gh repo delete momobits/factory5-6b-smoke --yes`), clear the env var
(`reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`).
