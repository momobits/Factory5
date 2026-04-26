# Phase 13 — Operator experience polish + carry-forward sweep

**Dependencies:** Phase 12 closed (tag `phase-12-worker-fs-scoping-closed`)
**Estimated duration:** 2–3 sessions
**Status:** 🟢 active — opens with this commit

## Goal

Pay down the friction the operator hits in day-to-day use of factory5. Phase 12's live validation surfaced two new operator-blockers (the file-sink logger silently failing; the `factory ui-token` CLI command still missing despite being on the carry-forward list since Phase 7) on top of two pre-existing carry-forwards from Phases 10/11 (I009 budget-tier inheritance, I014 architect-on-resume dirty tree). All four are scoped — TS work, no live-LLM spend except optional smoke runs.

The phase is deliberately a **sweep**: each sub-step closes a single concrete issue, with a regression test where it makes sense to add one. No new architectural seams, no new ADRs (unless one of the fixes uncovers a design decision worth pinning).

## Charter

Four fixes, in priority order:

1. **File-sink logger fix** (13.1) — MAJOR. Discovered during 12.4: `<dataDir>/logs/factoryd-*.log` does not materialise on disk despite `mkdirSync(logsDir, { recursive: true })` running during `initLogger`. Pretty-printed stdout works (so multistream construction succeeds); only the file sink is broken. Pre-fix: operator has no on-disk log feed; debugging is limited to terminal scrollback. Post-fix: every log line lands in `<dataDir>/logs/factoryd-<YYYY-MM-DD>.log` as Pino NDJSON. Open as a major issue under `docs/issues/`, write a regression test, then fix.
2. **`factory ui-token` CLI command** (13.2) — ADR 0025 §2 carry-forward, on the list since Phase 7. Operator closes terminal → loses dashboard URL; per-startup token rotation means every restart loses session tabs. The fix: a small CLI subcommand that reads the live daemon's currently active `FACTORY5_UI_TOKEN` (via the existing IPC `/status` route extended, or a new `/ui-token` route — pick at sub-step open) and prints the full UI URL. Operator types `factory ui-token` at any time and gets a fresh URL.
3. **I009 fix — extract `resolveDirectiveLimits` helper** (13.3). After Phase 11.4 the Telegram/Discord inbound `/build` paths skip two budget tiers (project + config) instead of one. The right shape is one shared helper called from every directive-creation path: `factory build` (CLI), `POST /api/v1/builds` (daemon), `inbound: build` (Telegram + Discord channel handlers). Lives in `@factory5/brain` or `@factory5/wiki` (decide at sub-step open based on the existing import graph).
4. **I014 fix — architect commits wiki on resume** (13.4). When the architect re-runs on an existing project (typical for `factory resume`), its modifications to tracked `docs/knowledge/*.md` files stay uncommitted in main and dirty-trip `gate.verify`. Targeted fix: stage + commit at the end of `runArchitect` if a git repo exists. Manual workaround was used in 10.5; this turns the workaround into an automatic step.

Phase close (13.5) tags + scaffolds Phase 14.

Out of scope:

- **Bash sandboxing** — Phase 12 deferred this; 12.4 produced zero deny lines, so demand signal is currently absent. Revisit if a real incident materialises.
- **`allowSymlinks: true` with target-prefix recheck** — only worth tackling if a Node-fixture build actually bites on the default `pnpm install` symlink farm. 12.4 was Python; not exercised.
- **14 stale "open" pending_questions** — cleanup chore, not blocking. One-shot DB sweep when convenient.
- **PowerShell em-dash mojibake** — operator-side console codepage fix, not factory5 code.
- **I012** (LOW) — Telegram inbound FIFO matcher. Carries forward.

## Sub-step schedule (preliminary — refined at each sub-step open)

| Step | Subject                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 13.1 | File-sink logger bug — file issue + regression test + fix. Pino destination is silently failing.                             |
| 13.2 | `factory ui-token` CLI command — IPC route + CLI subcommand. ADR 0025 §2 carry-forward.                                      |
| 13.3 | I009 — extract shared `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)` helper; rewire CLI / daemon / inbound paths. |
| 13.4 | I014 — architect commits wiki edits on resume; stage + commit at end of `runArchitect` if `isGitRepo`.                       |
| 13.5 | Phase close — tag `phase-13-operator-experience-closed`, scaffold Phase 14.                                                  |

Single-charter phase. Sub-letter split possible (13a logger / 13b ergonomics) only if 13.1's investigation reveals the logger bug needs an ADR-level discussion (e.g. whether to switch from Pino destination to a direct `fs.createWriteStream` sink).

## Done criteria

- [ ] All sub-steps checked off with commit references
- [ ] `pnpm build` clean; `pnpm test` green (regression tests included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] 13.1 — operator can `tail -f .factory/logs/factoryd-$(date +%Y-%m-%d).log` and see live events
- [ ] 13.2 — operator can `factory ui-token` and get a working dashboard URL without restarting factoryd
- [ ] 13.3 — Telegram inbound `/build` resolves the same three-tier limits as CLI / daemon paths (regression test exercises Telegram path)
- [ ] 13.4 — `factory build` followed by `factory resume` produces a clean tree (no architect-uncommitted wiki edits)
- [ ] `docs/PROGRESS.md` entry; `docs/Phase13_Progress.md` charter created
- [ ] `CompleteArchitecture.md` extension if any sub-step warrants one (likely not — sweep phase)
- [ ] Working tree clean
- [ ] Tag `phase-13-operator-experience-closed`

## Rollback plan

`git reset --hard phase-12-worker-fs-scoping-closed`. Each sub-step is a small, isolated fix; reverting one doesn't affect the others.

## Forward queue (after Phase 13)

- **Bash sandboxing** — only if a real incident surfaces. OS-level (chroot / Linux namespace / Job Object / sandbox-exec). Cross-platform sandbox-exec is non-trivial.
- **Network egress scoping** — wait for an egress-policy demand signal.
- **I012** — Telegram inbound FIFO matcher. Low priority; carries forward.
- **`allowSymlinks: true` + target-prefix recheck** — flip when a Node fixture surfaces the friction.
- **Stale-pending-questions DB sweep** — one-shot chore.
- **Stale-dist dev-loop gotcha** — long-standing carry-forward; needs design (conditional exports + `--conditions=development`).
- **Phase 6 operator follow-ups** — PAT revoke, env var cleanup; out-of-band.

Order is durable — only re-pick if a HALT event reveals a different priority.
