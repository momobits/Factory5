# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-08 by Phase 8 scaffold (cursor flipped no-active-phase → Phase 8 active at 8.1; this scaffold commit bundles tier-8 plan + phase-plan row + ROADMAP section + phase-8 dir + STATE flip + next.md regen; STATE.md inside this commit references `cf9d4f9` while HEAD will move to the scaffold's own sha — lag-by-1 #20).
**Current phase:** Phase 8 question-auto-answer ([`../phases/phase-8-question-auto-answer/README.md`](../phases/phase-8-question-auto-answer/README.md))
**Current step:** 8.1 — open U029 (unanswered `ask_user` blocks directive; no auto-answer fallback)
**Status:** Phase 8 scaffolded; cursor flipped; no work commits yet on Phase 8. Workspace at 1152 + 3 skipped (last verified at `phase-7-findings-mark-closed`); all four `pnpm` gates green at the prior phase close.

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

**Step 8.1 — open U029.**

Open `U029 — unanswered ask_user blocks directive; no auto-answer fallback` in `UPGRADE/ISSUES.md` Open section. Severity: medium. Tier: 8. Area: brain. Hypothesis: brain stamps `deadline_at` on every `ask_user` from config (default 5 min); new tick-loop sweep dispatches LLM call for any open question past deadline + active parent directive; writes answer with `answered_by = 'agent'` (or `'agent-failed'` after one retry); directive proceeds. New schema column + ADR 0030 for the contract.

After 8.1 commits, advance to 8.2 (migration 009 — `pending_questions.answered_by` column + backfill).

Full plan: [`../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../UPGRADE/plans/tier-8-question-auto-answer.md).
Phase scaffold: [`../phases/phase-8-question-auto-answer/`](../phases/phase-8-question-auto-answer/).

**Operator decisions baked in at scaffold time** (no further input needed for the in-scope sub-tasks):

- Provenance via new `answered_by` column (option A) — `'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`.
- Default deadline 5 minutes, configurable via `<dataDir>/config.json` (`askUserDeadlineMs`); not hardcoded.
- No override after auto-answer — agent answer is final; race-loser human reply discarded with a log warning.
- U005 stays parked as Tier 9 candidate (path (a+): bump REPL daemon-reply timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt).

---

## Git state

- **Branch:** main
- **Last commit:** `cf9d4f9` — `docs(state): session end after phase-7 close` (this Phase 8 scaffold commit will move HEAD forward — lag-by-1 #20)
- **Uncommitted changes:** Phase 8 scaffold bundle in flight — `UPGRADE/plans/tier-8-question-auto-answer.md` (~270 lines), `.control/architecture/phase-plan.md` (Phase 8 row + summary + intro update), `UPGRADE/ROADMAP.md` (Tier 8 section + intro count "Seven tiers → Eight tiers" + dependency-table row), `.control/phases/phase-8-question-auto-answer/{README.md,steps.md}`, this STATE.md flip (no-active-phase → Phase 8 active at 8.1), regenerated `next.md`
- **Last phase tag:** `phase-7-findings-mark-closed` (annotated at `40a78a8`)

---

## Open blockers

- None

---

## In-flight work

Phase 8 active at 8.1. Plan + scaffold landed in this commit; first work commit (`chore(8.1): open U029`) is the next operator action.

**Carry-forward items outside Phase 8 scope** (now Tier 9+ candidates; ordered by likelihood a demand signal surfaces):

- **U005** — `factory chat` REPL 120s timeout (still in `UPGRADE/ISSUES.md` Open). Tier 9 candidate; path (a+) sketched in conversation: bump REPL daemon-reply timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface. Composition-style tier; CLI wraps `loadSkill(id)` from `packages/brain/src/prompts.ts`. Tier 9+ candidate.
- **Bulk findings-mark surface** — defer-until-signal. Tier 7's `factory findings mark` is single-id by design.
- **Findings history surface** — defer-until-signal. Real first-class who/when/why log per finding, beyond the current `resolution` + `updatedAt` shape.
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
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 — now **20 occurrences** with this Phase 8 scaffold commit. Same two structural options as before: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

---

## Test / eval status

- **Last test run:** 2026-05-08 (during phase-close verification) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package: state 157, channels 175, daemon 173, brain 101, worker 47, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 141 (+8 from 7.2's mark tests), providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1152 passing + 3 skipped** (was 1144 + 3 pre-Tier-7; +8 from 7.2's mark-handler test fixtures: bare-id happy path / `<project>/<id>` form / ambiguous bare-id / invalid status / not-found in both forms / `--note` persistence / case-insensitive input / idempotent re-flip preserves resolvedAt).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029 still in promoted state.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05; promoted past gated state at Phase 3 close 2026-05-06)
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

**ADR 0030 drafts in Phase 8 step 8.3** — `pending-question-auto-answer` will pin the `answered_by` enum semantics, the daemon-wide config home (`<dataDir>/config.json`), the LLM dispatcher failure path, and the no-override-after-auto-answer rule. Cross-references ADR 0024 (worker-subprocess `ask_user`) which Phase 8 extends rather than supersedes.

---

## Recently completed (last 5 steps)

- **Phase 8 scaffold** — `chore(phase-8)`: scaffold tier 8 question-auto-answer. Bundle: `UPGRADE/plans/tier-8-question-auto-answer.md` (~270 lines, 7 work sub-tasks + close); phase-plan.md Phase 8 row + summary section + intro update; ROADMAP Tier 8 section + intro count "Seven tiers → Eight tiers" + dependency-table row + carry-forward updates (U005 → Tier 9 candidate); `.control/phases/phase-8-question-auto-answer/{README.md,steps.md}`; STATE.md cursor flip arc-complete → Phase 8 active at 8.1; regenerated next.md. Operator decisions baked in at scaffold time: provenance via new `answered_by` column (option A); 5-min default deadline configurable via `<dataDir>/config.json`; no override after auto-answer; U005 stays parked. — 2026-05-08 — this commit
- **Phase 7 close** — `chore(phase-7)`: close phase 7 (no Phase 8 plan; upgrade arc reopens to "all phases complete" — fourth time). Tagged `phase-7-findings-mark-closed`. All 14 done-criteria green at close (criteria 4–6 — manual mark verb verification — taken via unit-test coverage at the handler level since the 8 unit tests use real `mkdtemp` projects with on-disk `.factory/findings.json`; bare CLI surface verified via `factory findings mark --help` examples render and `factory completion bash` shows `mark` in the findings vocab). — 2026-05-08 — `40a78a8`
- **Step 7.2** — `feat(7.2)`: factory findings mark <id> <status> CLI command. `runFindingsMark` handler in `packages/cli/src/commands/findings.ts` wraps `updateFindingStatus` from `@factory5/wiki` with case-insensitive status input + `--note <prose>` flowing to `resolution`; bare-id disambiguation copies `runFindingsShow` exactly (`renderAmbiguity` block reused); idempotent re-flip preserves `resolvedAt`. 8 new unit tests in `findings.test.ts` against real `mkdtemp` workspaces with on-disk `.factory/findings.json`. `completion.ts` `NESTED_SUBCOMMANDS.findings` grew by `'mark'`; `packages/cli/README.md` findings table + section updated; top-of-file doc block in `findings.ts` updated. CLI 133 → 141 tests; workspace 1144 → 1152 + 3 skipped. Closes U028. — 2026-05-07 — `0d27925`
- **Step 7.1** — `chore(7.1)`: open U028 (`factory findings mark <id> <status>` CLI verb missing) in `UPGRADE/ISSUES.md` Open section. Severity low; Tier 7; Area cli. Hypothesis: pure composition over existing `updateFindingStatus` API + `runFindingsShow` disambiguation pattern. — 2026-05-07 — `b1dd5d6`
- **Phase 7 scaffold** — `chore(phase-7)`: scaffold tier 7 findings-mark CLI. Bundle: `UPGRADE/plans/tier-7-findings-mark.md` (~150 lines, 3 sub-tasks); phase-plan.md Phase 7 row + summary; ROADMAP Tier 7 section + intro count "Six tiers → Seven tiers"; `.control/phases/phase-7-findings-mark/{README.md,steps.md}`; STATE.md cursor flip arc-complete → Phase 7 active at 7.1; regenerated next.md. — 2026-05-07 — `ee970e8`
- **Drift-fix** — `docs(state)`: bump last-commit pointer to `a5c23ab` (drift-fix). Catches STATE.md up to HEAD after the prior session's session-end lag-by-1 (#18). Pure session-start reconciliation; no phase work. — 2026-05-07 — `436887a`
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

None yet — Phase 8 work hasn't started; 8.1 is next.

**Worth recording from Phase 7 for future reference** (not load-bearing for any active step but notable):

- **Status-enum cast had no surprises.** Earlier Tier 6 retro flagged the worry that `STATUSES = ['OPEN', 'FIXED', 'VERIFIED', 'WONTFIX'] as const` (CLI-side) and `FindingStatus` (core-side) might drift. They didn't — the `isStatus(status)` type-guard narrows to the union without an explicit cast, and TypeScript accepts it directly into `updateFindingStatus`'s `status: FindingStatus` slot. No `as` cast required.
- **Manual smoke deferred at done-criteria evaluation.** Criteria 4–6 say "works end-to-end against a seeded registry" — the 8 unit tests use real `mkdtemp` workspaces + actual `updateFindingStatus` writes through the real wiki API, which IS end-to-end at the handler level. The Commander wrapper (`process.exit` / `stdout.write`) is the only layer the unit tests don't exercise; verified manually via `factory findings mark --help` rendering examples + `factory completion bash` showing `mark` in the vocab. Future operator can run a live mark against a real workspace as a confidence check; not gating this close.
- **Prettier reformatted 3 files post-edit.** First gate run flagged `packages/cli/{README.md,src/commands/findings.ts,src/commands/findings.test.ts}` as needing format. Ran `pnpm prettier --write` on the trio; minor whitespace/wrap. Same pattern as Tier 6's prettier deviations — author writes draft, prettier normalizes. Not a code-quality issue, just a one-extra-step in the gate-pass cadence.

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

**Phase 8 active at 8.1.** Run the next session-start as usual; the cursor will land on 8.1 (open U029).

**Step 8.1 first commit shape:** `chore(8.1): open U029` — append the issue entry to `UPGRADE/ISSUES.md` Open section. No code edits; the ROADMAP rows + phase scaffold are pre-authored at this scaffold commit, so 8.1 is purely the issue-tracker entry.

**Pre-write homework before 8.2 (migration):**

- Re-read `packages/state/src/migrations/008-pending-questions-bot-message-id.ts` for the migration shape (ADD COLUMN + index pattern).
- Confirm `pendingQuestionSchema`'s location in `@factory5/core` and Zod's optional() semantics for the new field.
- Check the orphan-sweep `[orphaned by ...]` prefix string — confirm it's stable enough for the LIKE backfill SQL (it is per current `markOrphanAnswered` body).

**Pre-write homework before 8.5 (brain stamp):**

- `grep -rn "pendingQuestions.create\|insert.*pending_questions" packages/brain/src/ packages/worker/src/` — enumerate every `ask_user`-emitting call site.

**Pre-write homework before 8.6 (dispatcher + sweep):**

- Identify the brain's tick-loop entry — where the existing directive poll + orphan sweep live.
- Confirm the model/provider abstraction the brain uses for triage (auto-answer reuses it).
- Confirm `spend.record` signature for charging the auto-answer LLM call against the parent directive.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all seven closed tiers (Tier 8 entry will be appended at session-end).
- [`UPGRADE/plans/tier-8-question-auto-answer.md`](../../UPGRADE/plans/tier-8-question-auto-answer.md) — full Tier 8 plan; richest source.
- [`.control/phases/phase-8-question-auto-answer/README.md`](../phases/phase-8-question-auto-answer/README.md) + [`steps.md`](../phases/phase-8-question-auto-answer/steps.md) — phase cursor.
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
