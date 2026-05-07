# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-07 by `chore(phase-6)` kickoff bundle (Phase 6 scaffolded ahead of sub-step 6.1; this kickoff commit bundles the scaffold + STATE.md cursor + regenerated next.md, creating the **16th lag-by-1 self-reference occurrence** — STATE.md references previous HEAD `1cd0c9a` while this commit will move HEAD forward)
**Current phase:** phase-6-skills-rewrites (kicked off 2026-05-07; closes the agent-prompts arc Tier 5 opened — skills audit + rewrites + fixer parser path)
**Current step:** 6.1 — open U026 + U027
**Status:** in flight (Phase 6 scaffold landed; sub-step 6.1 about to start; all four `pnpm` gates green pre-kickoff at `1cd0c9a`; workspace test count 1135 passing + 3 skipped — no test deltas in scaffold-only commit)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Run sub-step **6.1**: open two issues in `UPGRADE/ISSUES.md` per Tier 6 plan §6.1.

- `U026 — skills/* — 12 ported-from-factory2 skills with no factory5 audit` (Severity: low, Tier: 6, Area: docs / skills). All 12 skills in `skills/` are explicitly "ported from factory2/skills/" per `docs/SKILLS.md` line 7. Tier 5 5.4–5.7 referenced 6 of them by name without deep-reading their bodies; this is the audit they didn't do.
- `U027 — Fixer agent output → updateFindingStatus has no parser path` (Severity: medium, Tier: 6, Area: brain). `packages/wiki/src/findings.ts:196` exports the API but it's only invoked from tests; no `packages/brain/src/` code parses agent output for `RESOLUTION <FID>` markers. Tier 5 5.5 confirmed the gap; the fixer prompt documents the prose-only contract today. Resolution wiring promotes the prompt's marker grammar into a runtime contract.

Each issue follows the existing `### UNNN — Short title` template (severity / tier / area / description / hypothesis). Append to the Open section. Then commit `chore(6.1): open U026 + U027`.

After 6.1 lands, proceed to **6.2** (skills audit pass — read each of the 12 skill bodies, classify each as `clean` / `hot-fix` / `rewrite`; commit body documents 12-line per-skill verdict; this plan + steps.md updated with explicit per-skill rewrite rows in the 6.4..6.N range).

**One pre-write homework item lurking** for 6.3 (re-verify on entry, don't assume):

- **6.3 fixer parser attach point** — re-grep `packages/brain/src/` for any agent-output → `updateFindingStatus` parser path (Tier 5 5.5 confirmed none; verify on entry to catch any sibling work that may have landed). Find where verifier's `FINDING` markers get parsed today — that's the model. Read `packages/wiki/src/findings.ts` around the `updateFindingStatus` export to confirm signature + idempotency. If no clean attach point exists, surface and split into refactor (6.3a) + parser (6.3b) — don't paper over a structural gap with a one-off hook.

Full Tier 6 plan: [`../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../UPGRADE/plans/tier-6-skills-rewrites.md). Phase scaffold: [`../phases/phase-6-skills-rewrites/{README.md,steps.md}`](../phases/phase-6-skills-rewrites/).

---

## Git state

- **Branch:** main
- **Last commit:** `1cd0c9a` — docs(state): session end after phase-5 close (the kickoff commit being prepared right now will move HEAD forward — lag-by-1 #16)
- **Uncommitted changes:** in flight at this STATE.md update — five Tier-6 scaffold artifacts (Tier 6 plan, ROADMAP Tier 6 section + intro count + Out-of-scope refresh, phase-plan.md row + summary, phase-6 directory with README + steps), this STATE.md, regenerated next.md
- **Last phase tag:** `phase-5-agent-prompts-closed` (annotated at `eeb03ed`; Phase 6 is in flight, no tag yet — the next phase tag will be `phase-6-skills-rewrites-closed`)

---

## Open blockers

- None

---

## In-flight work

Phase 6 scaffolded, sub-step 6.1 pending. Two of the prior carry-forward items (skills review + fixer parser path) are now in-scope as Tier 6 sub-tasks (6.2 audit + 6.3 parser); both will be opened as U026 + U027 in 6.1.

**Carry-forward items outside Phase 6 scope** (none load-bearing; ordered by likelihood a demand signal surfaces):

- **U005** — `factory chat` REPL 120s timeout (still in `UPGRADE/ISSUES.md` Open). 5.3's commit body flagged the issue's resolution-text "Tier 2 or 4. Pair with the chat surface work." is now stale (both tiers shipped without addressing it). Tier 7 candidate; explicitly excluded from Tier 6 scope per the plan.
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

- **Last test run:** 2026-05-07 (during step 5.8) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package: state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 133, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1135 passing + 3 skipped** — held through Phase 5 close + this Phase 6 scaffold commit (docs/markdown only — no test deltas).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029 still in promoted state. Phase 6 6.3 will add at least one unit test for the new fixer-marker parser.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05; promoted past gated state at Phase 3 close 2026-05-06)
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

**No new ADRs in Phase 5.** The 5.4 pre-write homework (reviewer findings advisory-vs-blocking) determined the runtime was unambiguous (`packages/wiki/src/findings.ts:130`'s `resolveAdvisory` auto-defaults `advisory: true` only for `source: 'verifier'`; every other source defaults to blocking). No ADR 0030 needed.

---

## Recently completed (last 5 steps)

- **Phase 6 scaffold** — `chore(phase-6)`: scaffold tier 6 skills audit + fixer parser. Bootstrap of UPGRADE/plans/tier-6-skills-rewrites.md (~250 lines, 6 sub-tasks with file pointers, acceptance criteria, runtime-contract verification branches, suggested commit shapes); phase-plan.md Phase 6 row + per-phase summary; ROADMAP.md Tier 6 section (5 deliverables) + intro count "Four → Six tiers" + Out-of-scope refresh; .control/phases/phase-6-skills-rewrites/{README.md,steps.md}; STATE.md cursor flip from arc-complete to Phase 6 active; regenerated next.md. Path 4 chosen (Tier 6 + fixer parser as 6.x) over Path 1 (skills-only). All four `pnpm` gates green pre-commit. — 2026-05-07 — `[this commit's sha]`
- **Phase 5 close** — `chore(phase-5)`: close phase 5 (no Phase 6 plan; upgrade arc reopens to "all phases complete"). Tagged `phase-5-agent-prompts-closed`. Done-criteria verification: 12/12 green. — 2026-05-07 — `eeb03ed`
- **Step 5.8** — `chore(5.8)`: retire factory logs stub. Path B chosen via auto-mode default per plan §5.8 risks-and-decisions ("If undecided ... default to Path B (retire) — the stub status has been carrying ambiguity since Phase 1"). Deleted `packages/cli/src/commands/stubs.ts`, removed registration from `cli.ts`, dropped row from `packages/cli/README.md`, dropped `'logs'` from completion vocab. ADR 0002 footnote flagged but unedited (CLAUDE.md "do not edit accepted ADRs"). — 2026-05-07 — `59a684f`
- **Step 5.7** — `docs(5.7)`: prompts/agents/builder.md — flesh out factory5-native body. 185 lines after prettier. Stub marker removed; venv discipline section preserved byte-for-byte (verified via `git diff | grep ^-`: only 4 lines removed, all from old frontmatter description + stub marker). — 2026-05-07 — `005e75b`
- **Step 5.6** — `docs(5.6)`: prompts/agents/investigator.md — write factory5-native body. 140 lines. Read-only constraint with concrete OK/NOT-OK Bash examples; HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions, not parsed. — 2026-05-07 — `ae47147`
- **Step 5.5** — `docs(5.5)`: prompts/agents/fixer.md — write factory5-native body (branch 3, prose-only). 158 lines. Confirmed no agent-output → `updateFindingStatus` parser path; fixer emits `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` markers as operator-readable today; parser wiring deferred to Tier 6. — 2026-05-07 — `839c2c1`

---

## Attempts that didn't work (current step only)

None — Phase 6 6.1 hasn't started yet. Will be populated as sub-steps run into surprises.

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

**Phase 6 active at 6.1.** Open U026 + U027 in `UPGRADE/ISSUES.md` per Tier 6 plan §6.1. After landing as `chore(6.1): open U026 + U027`, proceed to 6.2 (skills audit pass — 12 bodies read, classified `clean` / `hot-fix` / `rewrite`; verdicts in commit body; plan + steps.md updated with explicit per-skill rewrite rows in 6.4..6.N).

**Read first** when next session resumes:

- [`UPGRADE/plans/tier-6-skills-rewrites.md`](../../UPGRADE/plans/tier-6-skills-rewrites.md) — full Tier 6 plan with file pointers, acceptance criteria, verification branches.
- [`.control/phases/phase-6-skills-rewrites/README.md`](../phases/phase-6-skills-rewrites/README.md) + [`steps.md`](../phases/phase-6-skills-rewrites/steps.md) — phase kickoff + checklist.
- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all five tiers (Tier 6 entry added at session end).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**6.3 pre-write homework** (read before writing the parser):

- Re-grep `packages/brain/src/` for any agent-output → `updateFindingStatus` parser path. Tier 5 5.5 confirmed none; verify on entry to catch any sibling work that landed in the meantime.
- Find where verifier's `FINDING` markers get parsed today — that's the model for the new `RESOLUTION` parser.
- Read `packages/wiki/src/findings.ts` around the `updateFindingStatus` export to confirm signature + idempotency.
- If no clean attach point exists, surface and split into refactor (6.3a) + parser (6.3b). Don't paper over a structural gap with a one-off hook.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for Phase 6 but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 5 in retrospect:** 8 work commits (5.1 → 5.8) plus the phase-close commit. Total session output ~1100 lines added across the codebase (most in 4 prompt files + ISSUES.md). All 4 `pnpm` gates green throughout. No new ADRs; pre-write homework for 5.4 + 5.5 confirmed runtime contracts that didn't need pinning. Two of the Tier-6-candidates surfaced in Tier 5 are now in scope here (skills audit, fixer parser path); U005 stays carry-forward.
