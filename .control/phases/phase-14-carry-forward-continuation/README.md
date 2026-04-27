# Phase 14 — Carry-forward continuation + ergonomics

**Dependencies:** Phase 13 closed (tag `phase-13-operator-experience-closed`)
**Estimated duration:** 2–3 sessions
**Status:** 🟢 active — opens with this commit

## Goal

Continue Phase 13's sweep theme. The four blockers / amplified MEDIUMs landed; what remains is a long tail of LOW-severity-ish carry-forwards plus one "now overdue" item (the stale-dist dev-loop gotcha — has been on the list since Phase 9 close, six phases ago).

The Phase will be **demand-signal ordered**: 14.1 opens against whichever item bites the operator first, not in any pre-decided priority order. The list below is the candidate pool; the actual sub-step sequence settles as work begins.

## Charter

Candidate pool, in rough order of operator pain:

1. **Stale-dist dev-loop gotcha (now overdue).** Phase 9 close noted this as a Phase-10 follow-up and it's slid through Phase 10/11/12/13. Every workspace-dep edit currently requires manual `pnpm build` before `pnpm factoryd` — `apps/factoryd` imports `@factory5/daemon` via `main: "./dist/index.js"`, so dev runs don't see un-rebuilt source. Two solutions on the table:
   - **A. Conditional exports + `--conditions=development`.** Each `packages/*/package.json` adds a `"development": "./src/index.ts"` condition; running with `node --conditions=development` (or `tsx --conditions=development`) routes imports to source. Lowest blast radius; works with the existing tsx-based dev runner.
   - **B. Flip `main` to `src/index.ts`** in dev-only packages and bundle the production paths for prod runs. Simpler but breaks the prod-vs-dev parity Phase 9 chose.
     Pick at sub-step open after re-reading what Phase 9.9's "Non-trivial finding" recommended.
2. **I013 status re-read.** INDEX.md still lists I013 (worker pnpm install leaves node_modules) as MEDIUM/OPEN, but Phase 10's `prePurgeDepDirs` rimraf'd the symptom and Phase 12's sandbox cleanup further shrank the surface. Re-read the original issue, see if anything's still un-fixed; if not, move to RESOLVED with a regression-pointer (Phase 10 fix + Phase 12 surface). If yes, scope a targeted patch.
3. **I012 — Telegram FIFO matcher.** `maybeAnswerPendingQuestion` matches inbound replies by chat-id LIKE prefix; can't disambiguate between two open questions in the same chat. Fix: when there's >1 open question, require a `Reply-to` to the bot's specific message-id (Telegram already includes `reply_to_message.message_id` in inbound updates). One-line guard + parse already-passed `replyTo` field.
4. **Stale "open" pending_questions DB sweep.** 14 orphaned escalations from older directives that completed without anyone answering. One-shot SQL: `UPDATE pending_questions SET status='orphaned' WHERE created_at < <90-days-ago> AND answered_at IS NULL AND directive_id IN (SELECT id FROM directives WHERE status IN ('complete','failed','blocked'))`. Optional CLI surface: `factory questions cleanup --orphaned --since <date>`.
5. **PowerShell em-dash mojibake (README addendum).** Operator-side fix: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` in profile. Cheapest version: a one-paragraph note in the project README pointing operators at the fix. Free, no-code change.
6. **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env var cleanup. Out-of-band; mention in this charter for completeness, may not land this phase.

The Phase will close at 14.x-then-phase-close once the operator says "no more bites" or all candidates clear.

Out of scope:

- **Bash sandboxing.** Phase 12 + Phase 13 both deferred. 12.4 produced zero deny lines — demand signal still absent. Revisit only on a real incident.
- **Network egress scoping.** Long-tail concern; wait for an egress-policy demand signal.
- **Telegram/Discord `/build` flag parsing** (e.g. `/build foo --max-usd 5`). Hypothesis from I009's fix discussion. The shared `resolveDirectiveLimits` helper accepts an `explicitFlags` slot; once the parser lands, wiring is one line. Defer until an operator asks for inline overrides.

## Sub-step schedule (preliminary — refined as each opens)

| Step | Subject (placeholder)                                                               |
| ---- | ----------------------------------------------------------------------------------- |
| 14.1 | First-bite carry-forward — opens against whatever the operator hits first           |
| 14.2 | Second carry-forward                                                                |
| 14.3 | Third carry-forward                                                                 |
| 14.4 | (optional) Fourth carry-forward                                                     |
| 14.5 | Phase close — tag `phase-14-carry-forward-continuation-closed`, scaffold next phase |

Single-charter phase. Sub-letter split possible if any candidate (likely the stale-dist dev-loop) needs an ADR-level discussion.

## Done criteria

- [ ] All landed sub-steps checked off with commit references
- [ ] `pnpm build` clean; `pnpm test` green (regression tests included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] At least the stale-dist dev-loop landed OR explicitly re-deferred with an ADR
- [ ] `docs/PROGRESS.md` entry; `docs/Phase14_Progress.md` charter created
- [ ] `CompleteArchitecture.md` extension if any sub-step warrants one (likely not — sweep phase)
- [ ] Working tree clean
- [ ] Tag `phase-14-carry-forward-continuation-closed`

## Rollback plan

`git reset --hard phase-13-operator-experience-closed`. Each sub-step is small + isolated; reverting one doesn't affect the others.

## Forward queue (after Phase 14)

By demand signal at Phase 14 close:

- **Bash sandboxing** — only on a real incident
- **Network egress scoping** — only on demand
- **Conditional exports + `--conditions=development`** if Phase 14's stale-dist fix uncovered a deeper packaging concern
- **`/build` flag parsing on Telegram/Discord** — when an operator asks for inline overrides

The order is durable. Re-pick only if a HALT event reveals a different priority.
