# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-07 16:15 UTC by `/session-end` after phase-5 close (cursor at "no current phase — upgrade arc closed for the second time"; phase-close commit `eeb03ed` already bundled the STATE/journal/LOG/next.md transition, this session-end docs(state) commit only bumps the timestamp + last-commit reference + lag-by-1 counter; this is the **15th lag-by-1 occurrence** — STATE.md inside this commit references `eeb03ed` while HEAD will move to the session-end's sha)
**Current phase:** none — Tier 5 closed at `phase-5-agent-prompts-closed`. Upgrade arc complete (again). A Tier 6 candidate exists (skills review + rewrites — see Notes), but no plan is authored yet — operator decision required before Phase 6 can scaffold.
**Current step:** none — awaiting next Tier plan
**Status:** all phases complete. Phase 5 done-criteria 12/12 green at close. All four `pnpm` gates green throughout the phase.

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

**No active phase.** The upgrade arc has closed for the second time (Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 reopened the arc 2026-05-07 at `c0869d6`; Tier 5 closed at `phase-5-agent-prompts-closed` 2026-05-07 at this commit).

If the operator wants to continue, the natural next move is **Tier 6 (skills review + rewrites)**. All 12 skills in `skills/` are "ported from factory2/skills/" per `docs/SKILLS.md`. Tier 5's four prompt rewrites referenced six of those skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without surfacing hot-fix-worthy drift; an audit-only pass might confirm they're fine, or might surface drift that warrants rewrites. Sized as 1–2 sessions per `UPGRADE/plans/tier-5-agent-prompts.md` Out-of-scope section.

To kick off Phase 6:

1. Operator drafts `UPGRADE/plans/tier-6-skills-rewrites.md` with goal, sub-steps, acceptance.
2. Add a Phase 6 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 6 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-6-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps, or run `/phase-close` again to land a kickoff.

If the operator doesn't want a Tier 6, the project is in a clean post-arc parking state — there's no queued work in the upgrade arc.

---

## Git state

- **Branch:** main
- **Last commit:** `eeb03ed` — chore(phase-5): close phase 5 (this session-end docs(state) commit will move HEAD forward — lag-by-1 #15)
- **Uncommitted changes:** in flight at this session-end STATE refresh — timestamp + last-commit reference + lag-by-1 counter only; phase-close already bundled the substantive transition
- **Last phase tag:** `phase-5-agent-prompts-closed` (annotated at `eeb03ed`)

---

## Open blockers

- None

---

## In-flight work

No phase active. Phase 5 closed cleanly. No Phase 6 scaffolded.

**Carry-forward items outside any active phase scope** (none load-bearing; ordered by likelihood a demand signal surfaces):

- **Skills review + rewrites — Tier 6 candidate.** The 4 prompt rewrites in 5.4–5.7 referenced 6 skills without flagging hot-fix-worthy drift; a clean audit pass is the right entry point. Plan: `UPGRADE/plans/tier-6-skills-rewrites.md` (not yet authored).
- **`fixer→updateFindingStatus` parser path — Tier 6 candidate.** 5.5 confirmed the parser doesn't exist (no agent-output → status flip wired in `packages/brain/src/`). The fixer prompt documents the prose-only contract today; wiring the parser is Tier 6 work. The `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): ...` grammar is the lock-on shape if it lands.
- **U005** — `factory chat` REPL 120s timeout (still in `UPGRADE/ISSUES.md` Open). 5.3's commit body flagged the issue's resolution-text "Tier 2 or 4. Pair with the chat surface work." is now stale (both tiers shipped without addressing it). Re-tier candidate if Tier 6 happens; otherwise carry-forward.
- **§6.4 ONBOARDING.md "SPA's polling fetch" reference** — chat.astro consumes SSE for token-by-token reply rendering today (per 5.3's flag). Mildly stale, not load-bearing.
- **ADR 0027 §1 doesn't pin the POST `/api/v1/projects` route** — discovered in 5.3's check; the route exists at `packages/daemon/src/server.ts:923` but isn't in ADR 0027's pinned route table. ADR-amend candidate; doc-debt only.
- **ADR 0002 footnote stale.** `docs/decisions/0002-two-binary-split.md:49` mentions the unified `factory logs` view as a mitigation for two-log-streams; 5.8 retired the command. Per CLAUDE.md the ADR cannot be edited; supersede with a future ADR if anyone cares (over-engineering for this one footnote).
- **Pause primitive on directive detail** (Phase 3 carry-forward; cancel solved the primary "kill the build" pain). Defer-until-signal.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" unstyled-button issue + inline-style audit pass. Self-contained ~1 commit.
- **Brain-side `log.line` forwarder** — selective pino-stream tap filtered by `correlationId`; ADR 0029 future-work item.
- **Pre-3.5 baseline live-smoke chat-page click-test** — 30-second click-test deferred during Phase 3.10 close.
- **Smoke residue:** `node-sse-smoke` + `smoke-demo` projects at `C:\Users\Momo\factory5-workspace\<name>\`. `factory project delete --purge` is the right tool any time.
- **Filter-form Apply buttons + "Clear all defaults"** still render as user-agent default `<button>` on five sites — absorbed by deferred PageShell migration.
- **Inline `style=` attributes** scattered across web pages — same PageShell migration absorbs these.
- **Control framework 2.2.3 publish** at `G:\Projects\Small-Projects\Control` — operator owns the go.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 — now **15 occurrences** with this session-end commit (phase-close `eeb03ed` was the 14th). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

---

## Test / eval status

- **Last test run:** 2026-05-07 (during step 5.8) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package: state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 133, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1135 passing + 3 skipped** — held throughout Tier 5 (5.1–5.3 docs-only; 5.4–5.7 prompt-only; 5.8 retired one CLI command + its registration but the stub had no tests). This phase-close commit is docs/state-only — no test deltas.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029 still in promoted state.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05; promoted past gated state at Phase 3 close 2026-05-06)
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

**No new ADRs in Phase 5.** The 5.4 pre-write homework (reviewer findings advisory-vs-blocking) determined the runtime was unambiguous (`packages/wiki/src/findings.ts:130`'s `resolveAdvisory` auto-defaults `advisory: true` only for `source: 'verifier'`; every other source defaults to blocking). No ADR 0030 needed.

---

## Recently completed (last 5 steps)

- **Phase 5 close** — `chore(phase-5)`: close phase 5 (no Phase 6 plan; upgrade arc reopens to "all phases complete"). Tagged `phase-5-agent-prompts-closed`. Done-criteria verification: 12/12 green. — 2026-05-07 — `eeb03ed`
- **Step 5.8** — `chore(5.8)`: retire factory logs stub. Path B chosen via auto-mode default per plan §5.8 risks-and-decisions ("If undecided ... default to Path B (retire) — the stub status has been carrying ambiguity since Phase 1"). Deleted `packages/cli/src/commands/stubs.ts`, removed registration from `cli.ts`, dropped row from `packages/cli/README.md`, dropped `'logs'` from completion vocab. ADR 0002 footnote flagged but unedited (CLAUDE.md "do not edit accepted ADRs"). — 2026-05-07 — `59a684f`
- **Step 5.7** — `docs(5.7)`: prompts/agents/builder.md — flesh out factory5-native body. 185 lines after prettier. Stub marker removed; venv discipline section preserved byte-for-byte (verified via `git diff | grep ^-`: only 4 lines removed, all from old frontmatter description + stub marker). — 2026-05-07 — `005e75b`
- **Step 5.6** — `docs(5.6)`: prompts/agents/investigator.md — write factory5-native body. 140 lines. Read-only constraint with concrete OK/NOT-OK Bash examples; HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions, not parsed. — 2026-05-07 — `ae47147`
- **Step 5.5** — `docs(5.5)`: prompts/agents/fixer.md — write factory5-native body (branch 3, prose-only). 158 lines. Confirmed no agent-output → `updateFindingStatus` parser path; fixer emits `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` markers as operator-readable today; parser wiring deferred to Tier 6. — 2026-05-07 — `839c2c1`

---

## Attempts that didn't work (current step only)

None — no active step. Cleared at phase close.

**Worth recording from Phase 5 for future reference** (not load-bearing for any active step but notable):

- **Plan asserted markers the runtime didn't honour.** Earlier Tier 5 plan drafts framed `RESOLUTION` (fixer) and `HYPOTHESIS` (investigator) markers as parsed runtime contracts. Operator pushed back; runtime grep confirmed neither parser exists in `packages/brain/src/` or `packages/worker/src/`. Re-framed both as operator-readable conventions in the prompts (not runtime contracts). Both `fixer.md` (5.5) and `investigator.md` (5.6) explicit about this; future Tier 6 may wire parsers and lock onto these grammars verbatim.
- **`updateFindingStatus` API exists but has no agent-output parser.** `packages/wiki/src/findings.ts:196` exports the function; it's only invoked from tests. No CLI `factory findings mark <id>` command either. So fixer's "FIXED" output today flows as prose; the operator needs to manually edit `findings.json` or run a future CLI command. Tier 6 candidate.
- **ADR 0027 §1 doesn't pin `POST /api/v1/projects`.** Surfaced in 5.3 when describing `/app/projects/new`. The route exists at `packages/daemon/src/server.ts:923` but wasn't in ADR 0027's pinned route table. Doc-debt; not load-bearing.

**Worth recording from Phase 4 for future reference** (carried forward from prior STATE.md entries):

- **`helpInformation()` doesn't include `addHelpText` content** — discovered during 4.6's help-coverage test. Fix: capture `outputHelp()` output via `cmd.configureOutput({ writeOut, writeErr })`.
- **Sonic-boom isn't ready synchronously** — pino's default sonic-boom transport opens async. If `process.exit()` fires before the open completes, on-exit-leak-free's `flushSync()` throws "sonic boom is not ready yet". Fix in `apps/factory/src/main.ts`: argv-sniff for help/version paths and init logger with `noFile: true, noConsole: true`.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x, Commander 12.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running:** `factoryd` on `127.0.0.1:25295` (pid from 4.1's live smoke long since rolled over). Get live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321` not used.

---

## Notes for next session

**No active phase.** The upgrade arc closed at `phase-5-agent-prompts-closed`. To resume work, the operator can either:

1. **Author a Tier 6 plan** — likely candidate: skills review + rewrites. Tier 5's 5.4–5.7 prompt rewrites referenced 6 skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without surfacing hot-fix-worthy drift; an audit-only pass might confirm they're clean, or might surface drift that warrants rewrites. Sized as 1–2 sessions. To start: draft `UPGRADE/plans/tier-6-skills-rewrites.md`, add a Phase 6 row to `.control/architecture/phase-plan.md`, add a Tier 6 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-6-<name>/{README.md,steps.md}`.

2. **Promote a carry-forward item** — see `## In-flight work` above. Each item ships as ~1 commit when authored. Order-of-likelihood (most likely demand signal first):
   - **`fixer→updateFindingStatus` parser path** — wiring it up gives the operator/CLI a real "mark FIXED" verb without manual `findings.json` edits. Solid Tier 6 candidate, possibly a sibling to skills review.
   - **U005 chat 120s timeout re-tier** — affects channel-chat UX directly.
   - **PageShell + Dashboard `<style is:global>` migration** — absorbs filter-form Apply / "Clear all defaults" + inline-style audit; self-contained ~1 commit.

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all five tiers (Tier 5 entry just appended).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 5 in retrospect:** 8 work commits (5.1 → 5.8) plus this phase-close commit. Total session output ~1100 lines added across the codebase (most in 4 prompt files + ISSUES.md). All 4 `pnpm` gates green throughout. No new ADRs; pre-write homework for 5.4 + 5.5 confirmed runtime contracts that didn't need pinning. Tier 6 candidates surfaced (skills review, fixer→`updateFindingStatus` parser path, U005 re-tier).
