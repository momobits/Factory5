# Tier 5 — Agent prompt completion

**Goal**: every active agent prompt in `prompts/agents/` is substantive and factory5-native (built for the current architecture, not ported wholesale from factory2). Stale doc claims that conflict with what shipped through Tiers 1–4 are corrected. The single CLI stub-by-design (`factory logs`) is either implemented minimally or retired.

**Why this tier**: post-arc audit (2026-05-07) surfaced a structural inconsistency — `prompts/agents/README.md` lists all 9 agent prompts as "stub", but only 3 are pure stubs and 1 is a hybrid; the 5 substantive prompts (triage / architect / planner / scaffolder / verifier) are already factory5-native and carry the load. The 3 pure stubs (reviewer / fixer / investigator) plus the hybrid (builder) ship to the model on every directive, which means the brain is making decisions on a 10-line prompt for those roles. Two stale doc claims (prompts README + ONBOARDING §5.4) compound the discoverability problem. The user's directive: **build new for factory5, don't port from factory2.**

**Estimated effort**: 1 session.

**Issues addressed**: U024, U025 (both opened by step 5.1 of this tier).

**Scope explicitly excluded**: skills review and rewrites. Writing 5.4–5.7 will exercise the 6 skills referenced by the new prompts (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`); if any of those skills carry factory2-era assumptions that contradict current factory5 architecture, **flag for Tier 6**, do not inline-rewrite. Exception: a skill with a single one-line claim that's flatly wrong against current code can be hot-fixed in the same commit as the consuming prompt write, with a journal note.

---

## Pre-requisites

Read before starting:

- `prompts/agents/README.md` — current (and stale) status table.
- The 5 substantive prompts: `prompts/agents/triage.md`, `architect.md`, `planner.md`, `scaffolder.md`, `verifier.md`. These define the factory5-native shape the new prompts should match.
- The 3 pure stubs: `prompts/agents/reviewer.md`, `fixer.md`, `investigator.md` (10 lines each).
- The hybrid: `prompts/agents/builder.md` (~65 lines of real Python venv discipline + a `Phase 1 stub` marker still in place).
- `docs/AGENTS.md` — agent role catalog, default-skill mappings, model-category resolution.
- `packages/brain/src/agents/registry.ts` — runtime registration with prompt path + `defaultSkills` array.
- `packages/brain/src/prompts.ts` — `loadSkill(id)` and `buildAgentSystemPrompt(role)` (the loader; `FACTORY5_PROMPTS_ROOT` env var override).
- `docs/decisions/0018-verifier-advisory-only.md` (advisory-vs-blocking finding policy — verifier's framing is the model for reviewer).
- `docs/decisions/0024-worker-subprocess-ask-user.md` (mid-stream `ask_user` escalation — relevant for fixer / investigator).
- `docs/decisions/0028-worker-sandbox-contract.md` (worker sandbox path-prefix scoping — relevant for builder / fixer).
- `docs/CONTRACTS.md` — `Finding` / `Directive` / `OutboundMessage` shapes.
- `UPGRADE/ISSUES.md` — current issue numbering (next number is U024).

Verify all four gates pass before starting (`pnpm build && pnpm test && pnpm lint && pnpm format:check`).

---

## Sub-tasks

### 5.1 Open audit-surfaced issues

**Today**: agent-prompt audit results live only in conversation; the matching `UPGRADE/ISSUES.md` entries don't exist yet. (The Tier 5 phase scaffold — `phase-5-agent-prompts/{README.md,steps.md}`, `phase-plan.md` row + summary, `ROADMAP.md` Tier 5 section — was authored ahead of sub-step work, matching Tier 4 convention.)

**Wire**:

- Open `U024 — prompts/agents/README.md status table is stale` (Severity: low, Tier: 5, Area: docs / brain). 5 of 9 prompts are listed as "stub" but have substantive bodies (triage / architect / planner / scaffolder / verifier). Hypothesis: the README was authored before any prompt body was written and never updated as prompts matured.
- Open `U025 — docs/ONBOARDING.md §5.4 claims web detail pages are read-once` (Severity: medium, Tier: 5, Area: docs). Tier 3 step 3.1+3.2 (commit chain through `phase-3-web-ui-closed`) shipped SSE on `/api/v1/directives/:id/stream` and wired `directives/detail.astro` to consume it; the doc still lies. Hypothesis: ONBOARDING wasn't part of the Tier 3 doc-sweep boundary because Tier 1 (doc-sweep) ran before Tier 3 shipped the SSE work.

**Acceptance**:

- `UPGRADE/ISSUES.md` Open section grows by 2 entries (U024, U025); Resolved section unchanged.

**Commit**: `chore(5.1): open U024 + U025`

### 5.2 prompts/agents/README.md sweep

**Today**: status table claims all 9 prompts are "stub" — a transient state from Phase 1 that's never been updated. The "## Phase 1 work" section assumes wholesale porting from factory2, which Tier 5 supersedes. Once Tier 5 closes, every active prompt is substantive — a "status" column would carry no signal and would invite re-introducing the same stale-tracking problem the next time a prompt is in flight.

**Wire**:

- **Drop the status column entirely.** Replace the file table with `File | Role | Purpose` (one-line role description per row). Active prompts and the `legacy/` folder are differentiated by file path (the sub-folder), not by a transient status field.
- Drop the "## Phase 1 work" section.
- Drop "from factory2" provenance language in the legacy listing — the `legacy/` filename speaks for itself.
- Hot-reload note ("Prompts are read at the start of every directive…") stays — it's accurate and load-bearing.

**Acceptance**:

- Status column gone; new column set is `File | Role | Purpose`.
- No `stub`, `hybrid`, `factory2`, or `Phase 1 stub` terminology in the README's body.
- Legacy folder still listed but as reference, not via a status field.
- U024 marked Resolved with this commit's sha.

**Commit**: `docs(5.2): prompts/agents/README.md — drop stale stub-tracking column`

### 5.3 docs/ONBOARDING.md §5.4 sweep

**Today**: §5.4 ("Today's limitations") claims:

1. "The detail pages are **read-once**: they don't refresh as the brain progresses through tasks. Reload the page to see the latest state. Live updates via SSE land in Tier 3 of the upgrade…"
2. "The build form **refuses to create new projects** — the project must already exist on disk before its name shows up in the dropdown… ADR 0025 / Phase 11 charter put project creation explicitly out of scope for the SPA."

Claim (1) is stale (Tier 3 closed; SSE is live). Claim (2) is stale-on-the-flip-side: Tier 3 step 3.6 shipped `/app/projects/new` (the `factory init` analogue) — projects can be created from the SPA now.

**Wire**:

- Replace §5.4 with a "Current state" subsection that:
  - Confirms live updates work via SSE (briefly cites ADR 0029).
  - Confirms project creation is supported via `/app/projects/new` (Tier 3 step 3.6 / U007 family).
  - Notes the polling fallback for SSE-stripped proxies (per ADR 0029).
  - Drops or rewrites any "deferred" / "Tier 3" / "future" language pointing forward to work that's already shipped.
- Cross-check §5–§6 inline for other staleness while in there. Single pass; don't expand scope. If something else is stale, flag in the commit body for a follow-up.

**Acceptance**:

- §5.4 reflects what shipped in Tier 3 (U006 + U007 + U008).
- No "Tier 3 of the upgrade", "land in Tier", or "future" language anywhere in §5 that points at work already shipped.
- U025 marked Resolved with this commit's sha.

**Commit**: `docs(5.3): docs/ONBOARDING.md §5.4 — drop read-once claim post-Tier-3`

### 5.4 prompts/agents/reviewer.md — write from scratch

**Today**: 10-line stub.

**Goal**: a complete, factory5-native reviewer prompt at parity with verifier.md (97 lines) and architect.md (79 lines). The reviewer is **adversarial** — produces shadow tests + raises findings; never fixes (that's the fixer).

**Constraints + open questions to pin in the prompt body**:

- **Default skills** (per `docs/AGENTS.md`): `code-review`. The body should reference (not duplicate) the skill — the loader concatenates the skill body via `buildAgentSystemPrompt`.
- **Marker grammar** matches verifier: `FINDING [LOW|MEDIUM|HIGH|CRITICAL] <target>: <description>` (existing parsed contract — `pool.ts:111-132` propagates `finding.source` and `finding.advisory` as-set on insert). Verify (as part of the homework above) that the parser stamps `source: 'reviewer'` rather than `'verifier'` for reviewer-emitted findings, and pin the source-string in the prompt.
- **Findings policy — open question**: ADR 0018 makes verifier advisory-only. Reviewer's gate-contribution status is unstated in the ADRs. **Before writing**, read `packages/brain/src/findings/` (or wherever `findings_registry` is wired) and confirm whether reviewer findings flow with `advisory: true` or `advisory: false` (i.e. whether they contribute to `gate.verify`). Pin the answer in the prompt body so future sessions don't re-litigate. If the runtime currently treats reviewer as blocking, the prompt body says so + cites the file path that enforces it.
- **Output shape**: prose body with `FINDING [SEV] target: description` lines, same shape as verifier. Reviewer additionally emits **shadow tests** — code blocks the operator can run against the build to demonstrate the failure mode.
- **What it must NOT do**: never write to `BUILD.md` / `findings.json` / source files (it's read-only on the project tree). Never propose patches inline (that frames it as a fixer suggestion; reviewer raises findings, fixer fixes them).
- **Anti-noise gate**: same framing as verifier — "advisory findings still consume operator attention; raise one only when it adds information the assessor's output didn't surface". Severity gate: HIGH/CRITICAL claims require directly observable evidence in the context.

**Acceptance**:

- Comparable in depth to `verifier.md` (97 lines) or `architect.md` (79 lines); the substantive criteria above are the gate, not a line count.
- Frontmatter `role: reviewer` matches the `AgentRole` enum value in `packages/core/src/agent-roles.ts`.
- References the `code-review` skill by name.
- Pins the advisory-vs-blocking severity policy with an ADR ref or runtime-code citation.
- No `factory2` or `Phase 1 stub` references in the body.
- Marker grammar matches verifier.md exactly; source-string pinned (verified, not assumed).
- All four `pnpm` gates clean.

**Commit**: `docs(5.4): prompts/agents/reviewer.md — write factory5-native body`

### 5.5 prompts/agents/fixer.md — write from scratch

**Today**: 10-line stub.

**Goal**: a complete, factory5-native fixer prompt; targeted finding-resolution behavior, scoped to the named finding's target files only.

**Constraints**:

- **Default skills** (per `docs/AGENTS.md`): `error-recovery`, `tdd`, `ask-user`. Reference, don't duplicate.
- **Intake contract**: fixer reads a finding by ID from `findings_registry` (per ADR 0021's first-class project identity + `<project_id>/<finding_id>` addressing). The finding's `target` field defines the file-ownership scope.
- **Scope rule**: refuses to touch files outside the finding's `target` glob unless the operator explicitly extends scope via `ask_user`. If the fix genuinely needs to touch an adjacent file, escalate before changing — don't silently widen scope.
- **Output — verify runtime contract first**. `packages/wiki/src/findings.ts:189` exposes a real `markFinding` API (status → `FIXED` + optional `resolution` string + `resolvedAt` timestamp). Before writing 5.5, grep `packages/brain/src/` for any agent-output → `markFinding` parser path. Three branches:
  - **Existing parser found** — match its expected marker grammar in the prompt; document the marker.
  - **No parser, but a clean extension point exists** — re-scope 5.5 from `docs(5.5)` to `feat(5.5)` and add the parser as part of this step (one new function in `packages/brain/`, one test, one prompt edit).
  - **No parser, no clean extension point** — fixer emits prose only; the operator runs `factory findings show` then marks `FIXED` via the CLI / web UI after reviewing the fix. Note this in the journal as a Tier 6 candidate ("wire fixer→`markFinding` parser path"). Document the prose-only contract in the prompt body.

  Pin which branch ships in the commit message body and the prompt itself. Do not invent a marker the runtime doesn't honour.

- **Worker sandbox boundary** (ADR 0028): fixer is a tool-using agent; it runs in an isolated worktree per directive. Path-prefix access scoping per ADR 0028 §<exact-section> applies. Builder's BUILD.md prohibition applies equally (cross-sibling merge conflicts).
- **TDD discipline** (per `tdd` skill): write the regression test that demonstrates the finding _first_, watch it fail, then write the fix, watch it pass. The skill body has the full discipline; the prompt cites the skill and adds finding-specific framing.
- **Escalation** (per ADR 0024 + `ask-user` skill): when stuck — finding is ambiguous, the test it would produce is non-trivial, the fix scope balloons — fire `ask_user` rather than guess.

**Acceptance**:

- Comparable in depth to `verifier.md` / `architect.md`; the substantive criteria above are the gate, not a line count.
- Pins the finding-by-ID intake contract.
- Pins the file-ownership scope (target glob from the finding).
- Pins the output contract per the runtime-verification branch chosen above (no invented markers).
- References `tdd`, `error-recovery`, `ask-user` skills by name.
- Refuses BUILD.md writes (mirrors builder.md).
- All four `pnpm` gates clean.

**Commit**: `docs(5.5): prompts/agents/fixer.md — write factory5-native body` _or_ `feat(5.5): wire fixer→markFinding parser + write fixer.md` (per branch choice above).

### 5.6 prompts/agents/investigator.md — write from scratch

**Today**: 10-line stub.

**Goal**: a complete, factory5-native investigator prompt; **read-only** diagnosis with structured hypothesis output.

**Constraints**:

- **Default skills** (per `docs/AGENTS.md`): `error-recovery`, `ask-user`. Tools per registry: Read, Bash, Glob, Grep, ask_user. **No Write / Edit.**
- **Read-only is the load-bearing constraint.** The prompt makes this explicit with examples:
  - ✅ `cat`, `tail -f`, `git log`, `pnpm test --reporter=verbose`, `python -c "import foo"` (diagnostic imports).
  - ❌ `git commit`, `pip install`, `pnpm install`, `rm`, `mv`, `chmod`, `git checkout` (mutations to working tree or registry).
  - The fuzzy line: "running pytest" is OK (read state + observe output); "running pytest with `--lf` then `-x` then committing the green outcome" is not (mixes diagnostic with mutation).
- **Output structural conventions** (operator readability, _not_ a parser contract):
  - `HYPOTHESIS:` one paragraph; the investigator's best guess at the root cause.
  - `EVIDENCE:` cited file paths, log excerpts, command outputs.
  - `RECOMMENDED NEXT:` single line; either `fixer <project>/<finding-id>` (if a finding should be raised first), `architect` (if a redesign is needed), or `none — false alarm` if the symptom is actually expected behavior.

  These are conventions for the operator (or the next planner step) to read consistently. The brain has no parser for them today; if a parser is later wired, it can lock onto these markers verbatim. The prompt should describe them as conventions, not promise runtime persistence.

- **Bounded turns**: investigator runs at `reasoning` category, default 25 turns (per planner's table). Don't loop forever — emit `HYPOTHESIS:` even if uncertain (frame it as such), don't refuse to commit.
- **Escalation** (per ADR 0024 + `ask-user` skill): when the symptom requires operator context the investigator lacks (e.g. "this only fails after the 0.x→1.0 migration ran, did the migration actually run?"), `ask_user` rather than guess.

**Acceptance**:

- Comparable in depth to `verifier.md` / `architect.md`; the substantive criteria above are the gate, not a line count.
- Pins the read-only constraint with concrete examples (a handful each of OK and NOT-OK Bash invocations — enough to make the line clear).
- Specifies the `HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT` structural conventions and frames them as operator-readable, not parsed.
- References `error-recovery` + `ask-user` skills.
- All four `pnpm` gates clean.

**Commit**: `docs(5.6): prompts/agents/investigator.md — write factory5-native body`

### 5.7 prompts/agents/builder.md — flesh out

**Today**: hybrid — has a substantive Python venv discipline section (~65 lines, load-bearing for issue I007 host-pollution) but still flagged "Phase 1 stub. Body to be ported from factory2/skills/tdd.md".

**Goal**: builder.md is a complete, factory5-native prompt; the venv discipline preserved verbatim; TDD body added new (not ported); stub marker removed.

**Constraints**:

- **Default skills** (per `docs/AGENTS.md`): `tdd`, `progress-tracking`, `work-verification`, `ask-user`. Reference, don't inline (the loader concatenates).
- **Strict TDD** (per `tdd` skill): write tests first, watch fail, write minimal code, watch pass. The skill body has the discipline; the prompt adds builder-specific framing — file ownership per planner's `expectedOutputs.files[]`, signal emission via `expectedOutputs.signals[]` (e.g. `tests-green`).
- **Worktree boundary** (ADR 0028): each builder task runs in an isolated worktree. The merge-back is automatic. Builder MUST stay inside `expectedOutputs.files[]` to avoid file-ownership conflicts when merging back.
- **BUILD.md prohibition**: builder must NOT write to `BUILD.md` or `.factory/BUILD.md` — factory's own build log; concurrent worker writes cause cross-sibling merge conflicts at worktree cleanup. (Already in current builder.md; preserve.)
- **Finding marker grammar**: builder may _cite_ findings (e.g. "fixes F003: ...") in commits or BUILD.md if the planner scoped that into its inputs, but typically does not raise findings — that's the reviewer's job. Document this division.
- **Escalation** (per ADR 0024 + `ask-user` skill): when the spec is genuinely ambiguous (tied behaviour with two reasonable interpretations), `ask_user` before guessing.
- **Python venv section preserved**. This section prevents I007 host-site-packages pollution and has been incrementally hardened. Do NOT rewrite — copy verbatim, only adjust headings if needed for the new structure.

**Acceptance**:

- Existing venv discipline section (~65 lines) preserved verbatim; new TDD body added on top. Total depth comparable to `scaffolder.md` (178 lines) or `planner.md` (197 lines), but the venv content is the gate, not a line count.
- Stub marker (`> **Phase 1 stub.**`) removed.
- Venv discipline section unchanged at the byte level (don't break I007).
- References `tdd`, `progress-tracking`, `work-verification`, `ask-user` skills by name.
- All four `pnpm` gates clean.

**Commit**: `docs(5.7): prompts/agents/builder.md — flesh out factory5-native body`

### 5.8 factory logs decision

**Today**: `packages/cli/README.md` row 30 lists `factory logs` as a "stub — prints a hint pointing at `~/.factory5/logs/`". The actual command in `packages/cli/src/index.ts` (search for `logs`) prints a one-line hint and exits 0. Operators reaching for log inspection drop to `tail -f ~/.factory5/logs/*` directly.

**Two paths** — operator picks before this step starts:

- **Path A — implement minimal**:
  - New: `packages/cli/src/commands/logs.ts` reads `<instance>/logs/*.log` (cwd-walk-aware via the same path resolver other commands use).
  - Flags: `--component <name>` (filter to `<component>.log`), `--directive <id>` (filter lines whose JSON pino line carries `correlationId.directiveId` matching `<id>`), `--follow` (`tail -f` semantics; node `fs.watch` or chokidar).
  - Default tail-N: 100 lines.
  - Test pattern parallels `packages/cli/src/commands/spend.test.ts` (file-fixture, known input → known output).
  - Update `packages/cli/README.md` row 30 from "stub" to "done".
  - Commit: `feat(5.8): factory logs — minimal tail with --component/--directive/--follow`.

- **Path B — retire**:
  - Drop the `factory logs` row from `packages/cli/README.md`.
  - Remove the command registration from `packages/cli/src/index.ts` (and the stub handler if separate).
  - Update CLAUDE.md if it references the command anywhere (grep first).
  - Commit: `chore(5.8): retire factory logs stub`.

**Operator decision needed before this step starts.**

**Acceptance** (either path):

- No "stub" rows in `packages/cli/README.md`.
- All four `pnpm` gates clean.
- If Path A: at least one unit test in `packages/cli/src/commands/logs.test.ts` exercising each flag.

### 5.9 /phase-close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-5-agent-prompts-closed`. No Phase 6 plan exists today; the upgrade arc reopens at /phase-close and either closes again immediately (no Phase 6 in `phase-plan.md`) or scaffolds a Tier 6 if the operator authors one in advance (likely candidate: skills review + rewrites — see Risks below).

**Commit**: auto-generated by `/phase-close`, shape: `chore(phase-5): close phase 5` (+ kickoff if Phase 6 plan exists).

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass after every commit.
- `prompts/agents/README.md` accurately reflects every prompt's status at HEAD.
- All 4 deficient agent prompts (reviewer / fixer / investigator / builder) have factory5-native bodies with no `Phase 1 stub` markers and no `factory2` references in their bodies.
- `docs/ONBOARDING.md` §5.4 reflects post-Tier-3 SSE + project-creation reality.
- `factory logs` either works minimally (Path A) or is gone entirely (Path B) — no half-stub rows in CLI README.
- Issues U024 + U025 marked Resolved with commit refs.
- Tier 5 ROADMAP rows ticked.
- Append session entry to `UPGRADE/LOG.md` at session end.

---

## Risks + decisions

- **Skills review (defer to Tier 6).** Writing 5.4–5.7 means reading and depending on the existing skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`). All 12 skills in `skills/` are explicitly "ported from factory2/skills/" per `docs/SKILLS.md`. If any skill body carries a factory2-era claim that contradicts current factory5 architecture (e.g. references `BUILD.md` workflow that ADR 0021's `findings_registry` superseded; references GitHub flow that ADR 0019 retired; pre-pluggable-runtime defaults), **flag in the journal** as a Tier 6 candidate. Do NOT inline-rewrite the skill — that's a Tier 6 sub-step. **Exception**: a skill with a single one-line claim that's flatly wrong against current code (factual error, not philosophical drift) can be hot-fixed in the same commit as the consuming prompt write, with a journal note like "hot-fixed `skills/X.md` line N: <reason>; full skill review still owed in Tier 6".

- **Reviewer findings — advisory or blocking?** ADR 0018 makes verifier advisory-only. Reviewer's gate-contribution status is unstated in the ADRs. Before writing 5.4, read `packages/brain/src/findings/`-side code (or wherever `findings_registry.advisory` is set on insert) and confirm. Pin the answer in the prompt body so future sessions don't re-litigate. **If the runtime is ambiguous** (no clear precedent for reviewer-side findings), this is the right moment to write a new ADR (likely 0030) before 5.4's body lands.

- **factory logs path (5.8) — operator decision.** Path A (implement) and Path B (retire) are both short. Pick before 5.8 starts; the choice changes the commit type (`feat` vs `chore`) and adds a test file (Path A only). If undecided at 5.8 time, default to Path B (retire) — the "stub" status has been carrying ambiguity since Phase 1 and removing it removes a footgun.

- **No new ADR expected.** Tier 5 is doc + prompt rewriting against existing architecture. The exception is the reviewer-finding-severity policy (above) — if pinned via a new ADR, add it to the phase README's "ADRs decided in this phase" list and reference from `prompts/agents/reviewer.md`.

- **Single-session scope.** Tier 5 is sized for one session. If 5.4–5.7 expand because the operator wants more elaborate prompt bodies (e.g. detailed worked examples per role like planner.md has), split into a 5.4a/5.4b shape and let the session end at the natural break — better than rushing the close.

---

## Suggested commit shape

One commit per sub-task, in order, all in a single session unless 5.4–5.7 split (see above):

1. `chore(5.1): open U024 + U025`
2. `docs(5.2): prompts/agents/README.md — drop stale stub-tracking column`
3. `docs(5.3): docs/ONBOARDING.md §5.4 — drop read-once claim post-Tier-3`
4. `docs(5.4): prompts/agents/reviewer.md — write factory5-native body`
5. `docs(5.5): prompts/agents/fixer.md — write factory5-native body` _or_ `feat(5.5): wire fixer→markFinding parser + write fixer.md` (per branch choice)
6. `docs(5.6): prompts/agents/investigator.md — write factory5-native body`
7. `docs(5.7): prompts/agents/builder.md — flesh out factory5-native body`
8. `feat(5.8): factory logs — minimal tail` OR `chore(5.8): retire factory logs stub`
9. `chore(phase-5): close phase 5`

---

## Out of scope — Tier 6 candidate

If 5.4–5.7 surface skills with factory2-flavored claims that contradict factory5 architecture (likely candidates: `tdd`, `code-review`, `error-recovery`, `progress-tracking`), draft `UPGRADE/plans/tier-6-skills-rewrites.md` with a per-skill audit and rewrite plan. Sized as 1–2 sessions depending on how many skills actually need work; a single audit-only session may be enough if the existing skills are mostly fine.
