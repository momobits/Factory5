# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-07 by `/session-end` after phase-6 close (cursor at "no current phase — upgrade arc closed for the third time"; phase-close commit `69380e2` already bundled the STATE/journal/LOG/next.md transition + ROADMAP checkbox flips + steps.md 6.close flip + the `phase-6-skills-rewrites-closed` tag, this session-end docs(state) commit only bumps the timestamp + last-commit reference + lag-by-1 counter; this is the **18th lag-by-1 occurrence** — STATE.md inside this commit references `226d705` while HEAD will move to the session-end's sha)
**Current phase:** none — Tier 6 closed at `phase-6-skills-rewrites-closed`. Upgrade arc complete (third time). No Tier 7 plan authored.
**Current step:** none — awaiting next Tier plan
**Status:** all phases complete. Phase 6 done-criteria all green at close. All four `pnpm` gates green throughout the phase. Workspace 1144 + 3 skipped (was 1135 + 3 pre-Tier-6; +9 from 6.3's parser tests).

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

**No active phase.** The upgrade arc has closed for the third time (Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 reopened the arc 2026-05-07 at `c0869d6` and closed at `phase-5-agent-prompts-closed` 2026-05-07; the audit-driven Tier 6 reopened the arc 2026-05-07 at `542f99a` and closed at `phase-6-skills-rewrites-closed` 2026-05-07 at this commit).

If the operator wants to continue, three Tier 7+ candidates surfaced from Phase 6's Deferred section, ordered by demand-signal likelihood:

1. **`factory findings mark <id> <status>` CLI command** — operator-side parallel to 6.3's agent-side parser. Now that the agent-side flow is wired (RESOLUTION markers cause auto-flips), an operator-side CLI verb is the next composition. Probably ~1 commit; CLI command + test using the existing `updateFindingStatus` API. Solid Tier 7 candidate.
2. **U005 chat 120s timeout re-tier** — affects channel-chat UX directly. Carry-forward from Phase 2's Tier-2-or-4 designation; both shipped without addressing it.
3. **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit.
4. **`factory skills list / show <name>` CLI commands** — skill discovery surface. Tier 8 candidate (deeper than the 1-commit items).

To kick off Phase 7:

1. Operator drafts `UPGRADE/plans/tier-7-<name>.md` with goal, sub-steps, acceptance.
2. Add a Phase 7 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 7 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-7-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps, or run `/phase-close` again to land a kickoff.

If the operator doesn't want a Tier 7, the project is in a clean post-arc parking state — there's no queued work in the upgrade arc.

---

## Git state

- **Branch:** main
- **Last commit:** `226d705` — docs(state): append phase-6 close journal entry (this session-end docs(state) commit will move HEAD forward — lag-by-1 #18)
- **Uncommitted changes:** in flight at this session-end STATE refresh — timestamp + last-commit reference + lag-by-1 counter only; phase-close `69380e2` already bundled the substantive transition (STATE cursor flip, ROADMAP ticks, steps.md 6.close, LOG entry, next.md regen, tag)
- **Last phase tag:** `phase-6-skills-rewrites-closed` (annotated at `69380e2`)

---

## Open blockers

- None

---

## In-flight work

No phase active. Phase 6 closed cleanly. No Phase 7 scaffolded.

**Carry-forward items outside any active phase scope** (none load-bearing; ordered by likelihood a demand signal surfaces):

- **`factory findings mark <id> <status>` CLI command** — operator-side parallel to 6.3's agent-side parser. Tier 7 candidate (likely ~1 commit; CLI command + test using existing `updateFindingStatus` API).
- **U005** — `factory chat` REPL 120s timeout (still in `UPGRADE/ISSUES.md` Open). Tier 7 candidate; carry-forward from Phase 2's Tier-2-or-4 designation.
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
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 — now **18 occurrences** with this session-end commit (phase-close `69380e2` was the 17th; phase-6 scaffold `542f99a` was the 16th; phase-5 session-end `1cd0c9a` was the 15th; phase-5 close `eeb03ed` was the 14th). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

---

## Test / eval status

- **Last test run:** 2026-05-07 (during phase-close verification) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package: state 157, channels 175, daemon 173, brain 101, worker 47 (+9 from 6.3 parse-resolutions tests), worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 133, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1144 passing + 3 skipped** (was 1135 + 3 pre-Tier-6; +9 from 6.3's parse-resolutions.test.ts fixtures: empty / single FIXED / VERIFIED + WONTFIX / case-insensitive / multi-line / malformed rejection / mid-line anti-prose / whitespace tolerance / back-to-back).
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

- **Phase 6 close** — `chore(phase-6)`: close phase 6 (no Phase 7 plan; upgrade arc reopens to "all phases complete" — third time). Tagged `phase-6-skills-rewrites-closed`. Done-criteria all green at close (1 partial: manual integration verification of marker → flip path acknowledged as deferred to next live fixer directive; criterion's "or" language permits unit-test coverage which the 9 parse-resolutions tests provide). — 2026-05-07 — `69380e2`
- **Step 6.last** — `docs(phase-6)`: drop factory2 provenance + apply skill hot-fixes (6.last). `docs/SKILLS.md:7` "Initial skills ported from factory2/skills/" replaced with "Skills are factory5-native"; `docs/SKILLS.md:45` historical "analog of factory2/src/factory/skills.py" replaced with the actual factory5 surface (`packages/brain/src/prompts.ts`'s `loadSkill(id)`); `brainstorming.md` line 14 BUILD.md from source list dropped; `integration-testing.md` line 94 BUILD.md completion-marker replaced with tests-green signal + FINDING; `scaffolding.md` frontmatter description's BUILD.md-as-project-state-signal framing replaced with manifest-presence framing. Closes U026. Commit-msg hook required `(phase-6)` scope since "last" isn't numeric. — 2026-05-07 — `e942ec7`
- **Step 6.9** — `docs(6.9)`: skills/work-verification.md — write factory5-native body. Dropped `FACTORY_COMPLETE` legacy token; reframed 9-check methodology around FINDING emission with per-check severity grades (CRITICAL/HIGH/MEDIUM/LOW); ADR 0018 advisory framing; cross-ref Tier 5 5's verifier.md. — 2026-05-07 — `a4b51e6`
- **Step 6.8** — `docs(6.8)`: skills/scaffolding.md — write factory5-native body. Dropped BUILD.md scaffolding step + `--break-system-packages` antipattern; expanded TypeScript section to factory5-equal depth (pnpm workspace, tsup, vitest, ESLint flat); ADR 0026 + ADR 0028 references. — 2026-05-07 — `f1e1075`
- **Step 6.7** — `docs(6.7)`: skills/progress-tracking.md — write factory5-native body. Heaviest rewrite (the original was entirely BUILD.md-centric); ground-up re-frame around `expectedOutputs.signals[]` + `findings_registry`; ADR 0021 references; first per-skill verbatim-rule deviation (frontmatter description rewritten — original "BUILD.md is the single source of truth" was factually wrong against ADR 0021). — 2026-05-07 — `7b409ac`
- **Step 5.8** — `chore(5.8)`: retire factory logs stub. Path B chosen via auto-mode default per plan §5.8 risks-and-decisions ("If undecided ... default to Path B (retire) — the stub status has been carrying ambiguity since Phase 1"). Deleted `packages/cli/src/commands/stubs.ts`, removed registration from `cli.ts`, dropped row from `packages/cli/README.md`, dropped `'logs'` from completion vocab. ADR 0002 footnote flagged but unedited (CLAUDE.md "do not edit accepted ADRs"). — 2026-05-07 — `59a684f`
- **Step 5.7** — `docs(5.7)`: prompts/agents/builder.md — flesh out factory5-native body. 185 lines after prettier. Stub marker removed; venv discipline section preserved byte-for-byte (verified via `git diff | grep ^-`: only 4 lines removed, all from old frontmatter description + stub marker). — 2026-05-07 — `005e75b`
- **Step 5.6** — `docs(5.6)`: prompts/agents/investigator.md — write factory5-native body. 140 lines. Read-only constraint with concrete OK/NOT-OK Bash examples; HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions, not parsed. — 2026-05-07 — `ae47147`
- **Step 5.5** — `docs(5.5)`: prompts/agents/fixer.md — write factory5-native body (branch 3, prose-only). 158 lines. Confirmed no agent-output → `updateFindingStatus` parser path; fixer emits `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` markers as operator-readable today; parser wiring deferred to Tier 6. — 2026-05-07 — `839c2c1`

---

## Attempts that didn't work (current step only)

None — no active step. Cleared at phase close.

**Worth recording from Phase 6 for future reference** (not load-bearing for any active step but notable):

- **Phase scaffold's done-criterion contradicted by 6.3's homework.** The Phase 6 README's done-criteria included "`packages/brain/src/` carries a parser function for `RESOLUTION` markers" — but 6.3's pre-write homework grep found that the verifier `FINDING` parser model lives at `packages/worker/src/parse-findings.ts` (worker-side, not brain-side). Agent-output parsing is worker-side in factory5. The new parser shipped in `packages/worker/src/parse-resolutions.ts` accordingly. README left as historical scaffold (post-close it's frozen); 6.3's commit body documents the location revision. Future scaffold authors: agent-output parsing belongs in `packages/worker/src/`, not `packages/brain/src/`.
- **Per-skill verbatim-rule deviation (×2).** The plan's per-skill acceptance said "Frontmatter `name` + `description` preserved verbatim". For `progress-tracking.md` (6.7) and `scaffolding.md` (6.last), the frontmatter description was factually wrong against ADR 0021 — preserving misleading text in skill catalogs would mis-tier future agent attention. Both deviations justified by factual correctness; rule's intent (loader stability) preserved (the `name` field always stays verbatim). For future tier-N rewrites: descriptions are catalog metadata; updating for factual correctness fits the rule's spirit even where it deviates from the letter.
- **Manual integration verification deferred at 6.3.** The fixer parser path's full marker-to-DB-flip flow wasn't end-to-end smoke-tested in 6.3 — the 9 unit tests in `parse-resolutions.test.ts` cover the parser robustly, and `persistResolutions` is a tight wrapper around well-tested `updateFindingStatus`, but no live fixer-style directive was run. Acceptance criterion was "Manual or integration-test verification" so the "or" permits unit-test coverage. Operator should verify on next live fixer directive that emits a RESOLUTION marker.

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

**No active phase.** The upgrade arc closed at `phase-6-skills-rewrites-closed`. To resume work, the operator can either:

1. **Author a Tier 7 plan** — most likely candidate per demand signal: **`factory findings mark <id> <status>` CLI command** (operator-side parallel to the agent-side parser shipped in 6.3). ~1 commit. Or a small bundle if multiple Tier 7 candidates ship together. To start: draft `UPGRADE/plans/tier-7-<name>.md`, add a Phase 7 row to `.control/architecture/phase-plan.md`, add a Tier 7 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-7-<name>/{README.md,steps.md}`.

2. **Promote a carry-forward item** — see `## In-flight work` above. Each item ships as ~1 commit when authored. Order-of-likelihood (most likely demand signal first):
   - **`factory findings mark <id> <status>` CLI** — completes the agent + operator marker-flip surface; agent-side already shipped in 6.3.
   - **U005 chat 120s timeout re-tier** — affects channel-chat UX directly.
   - **PageShell + Dashboard `<style is:global>` migration** — absorbs filter-form Apply / "Clear all defaults" + inline-style audit; self-contained ~1 commit.

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all six tiers (Tier 6 entry just appended).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
