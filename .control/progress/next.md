# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-06T13:05:00Z by
> `/phase-close`. Edit STATE.md's "Next action" or "Notes for next session"
> to influence this prompt; **do not edit next.md by hand** -- it's overwritten
> on every session end and at /phase-close.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Phase 3 (web-ui) is **closed** (annotated tag `phase-3-web-ui-closed`). Phase 4 (cli-completion) is now active — small but high-leverage tier estimated at ~1 session. Read [`../phases/phase-4-cli-completion/README.md`](../phases/phase-4-cli-completion/README.md) and [`steps.md`](../phases/phase-4-cli-completion/steps.md) plus the full plan at [`../../UPGRADE/plans/tier-4-cli-completion.md`](../../UPGRADE/plans/tier-4-cli-completion.md).

Two pre-kickoff README edits the operator should make before starting code work:

1. `## Where we were, end of Phase 3` section in the new README — terse summary of the 10-step Phase 3 arc that 4.x can rely on (SSE protocol via ADR 0029, Astro component library, web cancel/chat/projects-new, mobile nav, logout/connection pip, all six SSE event types live-verified).
2. `## Why this phase exists` section — the carry-forward block (3 deferred items from Phase 3) is already seeded; add the operator-facing motivation paragraph (CLI is the third operator surface, Phase 4 closes parity with web + channels).

Then start step **4.1** — Verify `factory cancel <directive-id>` end-to-end. Phase 2 step 2.4 shipped the brain hook + IPC route + DB-direct fallback; the CLI surface was wired then. 4.1 is a verification commit (smoke against a real factoryd; possibly no-op or tiny doc tweak). The first feature step is **4.2** — `factory budget set <project> --max-usd <n> [--max-steps <n>]` reusing `packages/wiki/src/project-metadata.ts`; same code path as the web UI's `PUT /api/v1/projects/:id/budget` route.

Background processes from Phase 3 may still be running: factoryd PID may have rotated; live URL via `factory ui-token` (or `node apps/factory/dist/main.js ui-token`). Astro dev on `127.0.0.1:4321` is not used by Phase 4 (CLI-only work) — stop both at session start if you want a clean slate.

## Notes for next session

Phase 3 closed cleanly. Six issues moved from Open to Resolved in `UPGRADE/ISSUES.md` (U006, U007, U008, U009, U010, U022 — each with a full Resolution line pointing at the closing commit per step). ADR 0029 promoted past the gated state — Live verification table now shows ✅ for all six event types; the unit-test-only carve-out for `finding.created` is retired (closed in 3.7's `node-sse-smoke` smoke); the `finding.created live verification gap` Negative-consequence bullet removed; future-work list trimmed. Phase 3 README's `## Deferred to Phase 4 (or later)` section populated with three carry-forward items so the carry-forward auto-seeding into Phase 4's `## Why this phase exists` block worked. Tier 3 ROADMAP boxes were already ticked through step-3.10 close — `/phase-close` had nothing to do there, the Tier 3 close itself is the wrap.

**Phase 4 sub-step roadmap (full detail in `tier-4-cli-completion.md`):**

1. **4.1** — Verify `factory cancel <directive-id>` end-to-end (smoke-only or tiny fix; Phase 2 brain hook + IPC route + DB-direct fallback already shipped).
2. **4.2** — `factory budget set <project>` reusing wiki helpers; same code path as the web UI's `PUT /api/v1/projects/:id/budget`.
3. **4.3** — `factory project list / show / delete` (with `--purge` for explicit destructive variant + double-confirm).
4. **4.4** — `factory ask "<question>"` single-shot chat (`--json` for scripting); reuses chat.ts via extracted `submitOneDirective` helper.
5. **4.5** — Tab completion via `factory completion <shell>` (bash/zsh/pwsh, static — sub-commands + flag names; dynamic completion is future polish).
6. **4.6** — Rich `--help` examples via `addHelpText('after', '...')` on every command; top-level `addHelpText('afterAll', '...')` pointing at `docs/WORKFLOWS.md`.
7. **4.7** — `packages/cli/README.md` refresh.
8. **4.8** — Resolve issues U018, U019, U020, U021 in `UPGRADE/ISSUES.md` + tick Tier 4 boxes in `UPGRADE/ROADMAP.md` (mark resolved as each sub-step closes, or fold into one `chore(4.8)` commit at the end — operator's call).
9. **4.9** — `/phase-close`.

**Carry-forward items from Phase 3** (none block 4.x — captured in the new Phase 4 README's "Why this phase exists"):

- **Pause primitive on directive detail.** Defer until a real workflow signal demands it (cancel solves the primary operator-pain case; pause-then-think is the kind of feature worth designing once the demand is real).
- **PageShell adoption + Dashboard `<style is:global>` migration.** 11-page structural sweep — self-contained ~1 commit; absorbs the unstyled "Clear all defaults" + 4× filter-form Apply buttons, the inline-style audit, and Dashboard's slot-content scoping issue. Operator can slot any time as a "loose-ends sweep" or carry into Phase 5.
- **Brain-side `log.line` forwarder.** Selective pino-stream tap filtered by `correlationId` so the FE log tail uses live events instead of polling. ADR 0029 future-work item; not gating any 4.x step but a natural fit alongside CLI-completion polish.

**Other carry-forward (not deferred-from-Phase-3 specifically):**

- **Pre-3.5 baseline live-smoke (chat-page click-test).** 30-second smoke (open `/app/chat`, type a question, see streamed reply) — the chat page passes its 3.5 unit + integration coverage and ADR 0029's six-event-type live-verification is closed, so this isn't a Phase 3 acceptance dependency anymore. Natural fit during Phase 4 if the operator wants a quick visual check while testing CLI commands against a live daemon.
- **Smoke residue cleanup.** Two projects + 3 cancelled directives in DB + workspace dirs on disk. Phase 4's `factory project delete --purge` (step 4.3) will be the right tool to clean these up once it ships — natural validation target.
- **Control framework repo** at `G:\Projects\Small-Projects\Control` — uncommitted upstream patches; operator's go for 2.2.2 → 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 drift — 8 occurrences (the 9th lands at next session-end). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit. Worth filing during a quiet Phase 4 session as ergonomic infrastructure work.

**Frontend-design judgement calls carried from Phase 3** (Phase 4 is CLI-only, but worth recalling for any web-side polish that lands during the loose-ends sweep):

- Smart defaults read better than empty states.
- Native HTML beats custom widgets when semantics align.
- Theme-independent intentional colors for status semantics (traffic-light pip).
- Error-class differentiation matters when recovery paths differ.
- Visible-label vs. hover-title separation.
- Inherit-don't-invent; root-cause CSS fixes over global rewrites; hint-copy-teaches-consequence; in-context-affordance-vs-nav.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end` and at `/phase-close`).
