# Next session — paste this to start

Phase 13 closed 2026-04-27 (tag `phase-13-operator-experience-closed`).
All 5 sub-steps shipped in a single session arc: 13.1 file-sink logger
fix (I015) → 13.2 `factory ui-token` CLI + IPC route → 13.3
`resolveDirectiveLimits` shared helper across all four directive-
creation paths (I009) → 13.4 architect auto-commits its wiki writes
on resume (I014) → 13.5 phase close. **No new ADRs** (sweep phase);
**no `CompleteArchitecture.md` change**. Three issues moved to
RESOLVED (I009, I014, I015) plus the long-standing ADR 0025 §2
ergonomic gap.

End-to-end smoke datapoints (this session):

- 13.1: `npx tsx apps/factoryd/src/main.ts --foreground` against a
  clean `.factory/` → `.factory/logs/factoryd-2026-04-27.log`
  materialises (2247 bytes); every line tagged
  `"process":"factoryd"` (was `"unknown"` pre-fix — the smoking gun).
- 13.2: same factoryd run + `node apps/factory/dist/main.js ui-token`
  → printed `http://127.0.0.1:25295/app/?t=<48-hex>`, exit 0.
  `--token-only` returned just the bare token.
- 13.3: factoryd boots clean with the new `resolveBuildLimits`
  callback wired into the channel registry; channel tests assert
  `directive.limits` is set when the resolver returns project +
  config tiers.
- 13.4: 8 unit tests around `commitArchitectWritesIfRepo` cover all
  branches incl. graceful-degrade on git failure and isolation from
  unrelated dirty `docs/`.

Workspace: **855 tests** green across 15 packages (was 813). lint +
format clean. Builds clean across 15 packages + 3 apps. Spend this
session: $0 (all TS / docs / IPC work).

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase /
step / carry-forwards), then the Phase 14 charter at
`.control/phases/phase-14-carry-forward-continuation/{README.md,steps.md}`.
Phase 14 is **demand-signal-ordered** — 14.1 opens against
whichever candidate bites the operator first, not in a pre-decided
priority. Likely first target: stale-dist dev-loop gotcha (overdue
since Phase 9 close).

Run `/session-start` for the full drift check.

## Next concrete work — 14.1 (first-bite carry-forward)

**Default pick: stale-dist dev-loop gotcha.** This has been on the
list since Phase 9's "Non-trivial finding" — `apps/factoryd` imports
`@factory5/daemon` via `main: "./dist/index.js"`, so `pnpm factoryd`
in dev doesn't see un-rebuilt source. Every workspace-dep edit
currently needs a manual `pnpm build` before relaunching factoryd.
The Phase 13.1 + 13.3 sessions both hit this several times when
testing daemon-side fixes against an actual factoryd run.

Two solution shapes on the table (decide at 14.1 open):

- **A. Conditional exports + `--conditions=development`.** Each
  `packages/*/package.json` adds a `"development":
"./src/index.ts"` condition; running with
  `node --conditions=development` (or `tsx --conditions=development`)
  routes imports to source. Lowest blast radius; works with the
  existing tsx-based dev runner.
- **B. Flip `main` to `src/index.ts`** in dev-only packages and
  bundle the production paths for prod runs. Simpler config but
  breaks the prod-vs-dev parity Phase 9 chose.

Re-read Phase 9.9's "Non-trivial finding" in
`docs/Phase9_Progress.md` for the original recommendation before
picking. Then pick one shape, apply across all `packages/*`
relevant to `apps/factoryd`'s import chain, smoke-verify by
editing a daemon source file and confirming `pnpm factoryd`
picks up the change without a manual rebuild.

If 14.1 lands an ADR-level decision (e.g. "we're committing to
dev-mode-only conditional exports"), pin it as ADR 0029.
Otherwise no new ADR; the change lives in package.json + the
factoryd launcher invocation.

## Then by demand signal

Pick from the Phase 14 candidate pool as each bites:

**14.x — I013 status re-read.** INDEX.md still lists I013 as
MEDIUM/OPEN (`worker-worktree-cleanup-blocked-by-node-modules`).
Phase 10's `prePurgeDepDirs` rimraf'd the symptom and Phase 12's
sandbox cleanup further shrank the surface. Re-read the issue
file; if nothing's still un-fixed, move it to RESOLVED with a
pointer to Phase 10's fix + Phase 12's surface reduction. If yes,
scope a targeted patch.

**14.x — I012 — Telegram FIFO matcher.**
`packages/channels/src/telegram.ts` `maybeAnswerPendingQuestion`
matches inbound replies by chat-id LIKE prefix; can't disambiguate
when there are >1 open questions in the same chat. One-line guard:
when >1 open question, require `reply_to_message.message_id`
(Telegram already includes it in the inbound update payload).

**14.x — Stale pending_questions DB sweep.** 14 orphaned escalations
from older completed directives. One-shot SQL or a CLI surface
(`factory questions cleanup --orphaned --since <date>`).

**14.x — PowerShell em-dash README addendum.** One-paragraph note
in the project README pointing operators at
`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`. Free,
no-code change.

**14.5 — Phase close.** Tag
`phase-14-carry-forward-continuation-closed`. Author
`docs/Phase14_Progress.md`, prepend `docs/PROGRESS.md`. Likely no
`CompleteArchitecture.md` change (sweep phase). Scaffold Phase 15
by demand signal — Bash sandboxing if a real incident materialises
by then; otherwise continue paying down debt.

## Carry-forward (still non-blocking)

- **Stale-dist dev-loop gotcha** (overdue since Phase 9) — 14.x
  candidate.
- **I013** (MEDIUM, OPEN per INDEX, but likely paid down) — re-read
  candidate.
- **I012** (LOW, OPEN) — Telegram inbound FIFO matcher.
- **14 stale "open" pending_questions** (LOW) — DB sweep.
- **PowerShell em-dash mojibake** (LOW) — README addendum.
- **Phase 6 operator follow-ups** (out-of-band) — PAT revoke,
  `gh repo delete`, env var cleanup.

## Out of scope (still deferred)

- **Bash sandboxing** — Phase 12 + Phase 13 both deferred. 12.4
  produced zero deny lines; demand signal still absent. Revisit on
  a real incident.
- **Network egress scoping** — long-tail; wait for an egress-policy
  demand signal.
- **Telegram/Discord `/build` flag parsing** (e.g.
  `/build foo --max-usd 5`). Hypothesis from I009 fix discussion.
  The shared `resolveDirectiveLimits` accepts an `explicitFlags`
  slot; once the parser lands, wiring is one line. Defer until an
  operator asks.

Report back on wake-up with a status block in this shape:

```
Phase 14 — 0/5 closed; 14.1 first-bite carry-forward (stale-dist dev-loop gotcha most likely)
Last action: chore(phase-13) eb4ade3 (close + tag) on top of fix(13.4) 00682ef (architect auto-commit)
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-13-operator-experience-closed
Open blockers: 0 (all carry-forwards are non-blocking polish)
Proposed next action: 14.1 — pick stale-dist dev-loop gotcha (or another candidate if operator preference shifts)
Ready to proceed?
```
