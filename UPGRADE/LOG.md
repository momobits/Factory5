# Upgrade log

Session-by-session handoff log. Append a new section at the **top** at session end. Most recent entry is what a new session reads first.

Each entry should answer: what was done, what was decided, what's next.

---

## 2026-05-16 — Phase 10 (resume-and-activity-feed) closed; upgrade arc complete (seventh time)

Tier 10 reopened the upgrade arc 2026-05-16 and closed the same day. Two operator-feels-blind gaps fixed: (1) no UI surface for `factory resume`; (2) directive-detail's activity panel silent on `build` directives because the brain only emitted one `log.line` SSE event today.

**Forcing function:** an `automl` build directive `01KRQ1RPE5SM6Q8AYSRHHAPG39` ran ~14 minutes on 2026-05-16 (architect ~3 min, planner ~10 min) and crashed on `ZodError: tasks Required` at `packages/brain/src/planner.ts:335` — silently in the UI. The operator saw the directive flip running→failed with no narrative and no recovery action. SSE plumbing from Phase 3 (ADR 0029) was already in place; only the _emission_ side was sparse.

**Eight commits this session:**

- `1ac1823` — `chore(phase-10)`: scaffold tier 10 resume + activity feed
- `0ce4590` — `chore(10.1)`: open U030
- `bb2bca9` — `docs(10.2)`: ADR 0031 — log-forwarder design
- `585f172` — `feat(10.3)`: brain emitLogLine narrative sites
- `e83c3c1` — `feat(10.4)`: POST /api/v1/directives/:id/resume
- `f100910` — `feat(10.5)`: UI resume button + projects-row resume link
- `9289aff` — `feat(10.6)`: UI activity panel level badges + empty state
- this phase-close

**Three workstreams shipped:**

1. **`POST /api/v1/directives/:id/resume`** — HTTP mirror of `factory resume` CLI. Bearer-auth + Zod-validated body (`autonomy?` optional override). 404 missing prior; 409 prior `running`/`pending`; 422 prior `projectPath` missing on disk. Mints child with `parentDirectiveId` + `payload.resumeFrom` + carried language / projectId / limits; doorbell emits so the brain serve loop picks up. 8 new integration tests in `packages/daemon/src/server.test.ts`. New IPC schemas `apiV1ResumeRequestSchema` + `apiV1ResumeResponseSchema`.

2. **Brain `emitLogLine` coverage** — extracted `emitLogLine` + `emitDirectiveCompleted` to a shared `packages/brain/src/emit.ts` to break the loop↔stage circular import; loop.ts re-exports for backward compat. Emit sites added at every brain stage entry / exit / error path per ADR 0031 §4: triage (after classification), architect (calling / no-JSON / Zod-fail / wiki-written / readiness), planner (calling / parse-fail / Zod-fail / plan-written), pool (dispatching / task-error / complete), loop (architect-skipped on resume, planner-reuse, terminal, budget-blocked), serve (uncaught-throw belt-and-suspenders that ALSO emits `directive.completed` — fixed a Phase-3-era silent-fail-in-UI gap discovered while wiring 10.3). Planner parse-fail and Zod-fail carry the first 500 chars of LLM response in `attrs.detail` + truncated Zod issues. 4 regression tests in `planner-emit.test.ts` lock the automl Zod-fail shape (`attrs.zodIssues[0].path === ['tasks']` is the canonical assertion).

3. **UI surfaces** — directive-detail renders a vermillion Resume pill when `effectiveStatus()` ∈ `failed | blocked | complete` AND `intent === 'build'`; mutex with Cancel (never both). Projects index gains a "Last build" column with the latest build directive's status (linked) + per-row Resume pill on terminal directives — one `/api/v1/directives?limit=100` fetch builds the projectId-to-latest map (no N+1). Activity panel renders level-badge pills (info acid green / warn amber / error halt red) using Tier 9 design tokens; "Waiting for the brain to narrate…" empty-state hint on running directives with zero events; silent on terminal directives with no events to avoid misleading post-mortem. Header renamed "Live log" → "Activity"; counter "lines" → "events" to match the SSE vocabulary.

**ADR 0031 — log-forwarder design.** Five-part decision: manual emit sites first-ship over pino-tap (auto-mirror deferred to Tier 11+); event shape is `level + component + msg + optional attrs` with dotted-hierarchy `component` like `brain.<stage>`; error events carry first 500 chars of any offending LLM output in `attrs.detail` (mirrors the existing `planner.ts:331` thrown-error prefix); guardrail mandates entry+exit+error emit per brain stage; `attrs.detail` is bounded at 500 chars (daemon log file is the full-transcript fallback). The ADR also documented Tier 11+ candidates explicitly: pino transport tap, hybrid, polling-based activity-log persistence.

**Two pre-existing bugs surfaced in passing.** (1) The `.cancel-btn` had been rendering as default browser button since Phase 3 — Astro scoped `<style>` rules attach a `[data-astro-cid-xyz]` attribute selector that JS-created elements never match. Fixed by lifting the entire log-tail + button style block to `Dashboard.astro` `<style is:global>`. (2) `brain.serve`'s uncaught-throw catch path flipped the directive to `failed` in the DB but never emitted `directive.completed` on SSE, so the FE relied on polling to discover terminal state. Added belt-and-suspenders emit so the UI sees the terminal flip immediately.

**Live browser smoke** (Playwright MCP, in-session) — restarted factoryd to pick up the new daemon route + emit sites, opened `/app/directives/detail?id=01KRQ1RPE5SM6Q8AYSRHHAPG39`, clicked the vermillion RESUME pill, child directive `01KRR9RGFN10YMDX5C16TXK91Y` minted, navigated to its detail page. Activity panel narrated 5 events live (triage: intent=resume confidence=0.95 → architect: calling claude-opus-4-7 → wrote 13 wiki pages → wiki readiness: all checks passed → planner: calling claude-sonnet-4-6). Cancel pill flipped to "CANCELLING", clicked it, daemon received the cancel at 11:56:54, directive marked failed in DB at $0.7241. Cancelled before Sonnet returned to keep smoke budget bounded.

**Interesting empirical finding.** The architect on the resume produced **13 wiki pages with a proper `modules/` directory split** — the original automl run wrote a single `modules.md` with `# Modules` h1 which the gate's `checkModules` regex rejects. Opus output is non-deterministic; the original gate-fail was a one-off. The carry-forward "loosen `checkModules` to accept h1" stays a valid Tier 11 candidate but is advisory-only.

**Workspace count:** 1182 + 3 skipped → 1194 + 3 skipped (+12 across planner-emit and resume-route).

**All four `pnpm` gates green throughout.**

**Next:** upgrade arc parks again. Tier 11 candidates from this tier's Deferred section: pino transport tap, per-directive log persistence (activity panel empty after reload on terminal directives), resume-after-edit, bulk resume, `checkModules` h1 acceptance. The longer-standing Phase 8 carry-forwards (U005 chat REPL cancel, per-project deadline override, `factory config get/set`, override-after-auto-answer) and the structural `/session-end` lag-by-1 fix (now 27 occurrences) remain available.

---

## 2026-05-15 — Phase 9 (Control Room redesign — factory-web editorial port) closed; upgrade arc complete (sixth time)

Reopened the upgrade arc post-Phase-8-close for a frontend aesthetic overhaul, closed in the same session. First tier in the arc that shipped visual-design work without an underlying contract change. Three commits this session: bundled redesign + `.control` recordkeeping (`397637c`), gitignore tweak for smoke artifacts (`307d79c`), and this phase-close.

**Browser smoke happened in-session via Playwright MCP** rather than being deferred to the operator. The Phase 9 README's "operator cannot open a browser" gate-text was stale (Playwright MCP became available); flipped the done-criteria checkbox and recorded the smoke results in the README parenthetical. All 8 sections rendered cleanly in both light and dark themes. Two false positives investigated and dismissed: (1) "02 Projects underlined on Build" was Playwright cursor hover-retention, not a real CSS bug — `[aria-current="page"]` rule at `Dashboard.astro:264` works correctly; (2) "low-contrast body copy in dark mode" was Chrome caching `currentColor` from pre-injection paint — production users get `prefers-color-scheme: dark` from the OS before page load so the cache never hits.

**Operator request at session start:** port the "Editorial Control Room" aesthetic from the sibling conductor project (`G:/Projects/Small-Projects/Harness/conductor`, Phase 19) to factory5's `apps/factory-web` dashboard, and record the work in the Control system. Conductor's port committed dark-only; factory5 already supports light + dark via `color-scheme: light dark` (`color-mix(currentColor)` everywhere) and Phase 3 frontend-design judgement calls in STATE.md argued for _"inherit-don't-invent"_, theme-independent status semantics, and native HTML over custom widgets. Operator chose **dual-theme** to preserve those values, **informal cadence** (single change set, no per-step commits, no ADR) to match the conductor session's tempo, and **fresh Tier 9 framing** over promoting the Phase 8 "PageShell + Dashboard `<style is:global>` migration" carry-forward verbatim.

**Why this tier was needed:** the current dashboard is functional but visually generic — system-font sans, `color-mix(currentColor)` chrome, GitHub-ish neutral surfaces. The conductor port demonstrated that editorial / mission-control aesthetics work for control-plane UIs without sacrificing readability or accessibility, and operator wanted the two control planes to share a visual identity. Additionally, Phase 8's Deferred section had been carrying _"PageShell + Dashboard `<style is:global>` migration — 11-page sweep absorbing filter-form Apply / 'Clear all defaults' + inline-style audit. Self-contained ~1 commit"_ since the upgrade arc's fifth close — Tier 9 absorbs that work _de facto_ and goes considerably further (aesthetic overhaul rather than structural deduplication).

**What landed in `apps/factory-web/`:**

- **`src/layouts/Dashboard.astro`** — full inline `<style is:global>` rewrite (~660 lines). New CSS custom-property token layer:
  - Type: `--f-display` (Fraunces, variable opsz 9..144), `--f-body` (Bricolage Grotesque, variable opsz 12..96), `--f-mono` (JetBrains Mono).
  - Accents (persist across themes): `--signal` `#ff4d1c` vermillion, `--signal-2` lighter for hover, `--amber`, `--acid`, `--halt`, `--cool`.
  - Surfaces / foreground (theme-switched): `--bg / --bg-2 / --surface / --surface-2 / --ink / --ink-2 / --mute / --mute-2 / --hairline / --hairline-2 / --grain-opacity`. Light: warm parchment `#f4ecd9` on `#fffaef` surfaces, ink `#1a1a1d`, hairline `#d8cdb0`. Dark: ink-black `#0c0c0e` on `#16161a` surfaces, parchment `#f3ece0`, hairline `#2b2b32`.
  - `@media (prefers-color-scheme: dark)` swaps the surface/ink/hairline block; type tokens + accents shared.
  - Status semantic colors (`#2a8b54 / #b87c1a / #c0263a` for connected / reconnecting / disconnected) held literal in the status-pip rules — theme-independent for at-a-glance recognition (Phase 3 frontend-design rule).
  - Markup re-laid: masthead-top row (brand: `§` mark + `factory5` + italic `/ Control Room` strapline; edition stamp on right with "Vol. V · {title}") → masthead-rule (double horizontal stroke à la magazine masthead) → masthead-meta row (numbered nav `01 OVERVIEW` … `08 FINDINGS` with monospaced numerals in vermillion; status pip; sign-out; hamburger drawer for ≤768px).
  - Page-title block (`.page-title` inside `main.shell`) — `h2` in italic Fraunces opsz 144 weight 700, clamped 1.7–2.4rem, `letter-spacing: -0.02em`, 36×2px vermillion underscore rule. Picks up every page's `title` prop without requiring page-side migration to `<PageShell>`.
  - Paper-grain atmosphere — `body::before` carries a 22×22 dot-grid (radial-gradient on `--ink` at 4% alpha) + a vermillion radial in the top-right + an amber radial in the bottom-left, all using `color-mix`. `body::after` overlays an SVG-data-URI fractal-noise grain at `--grain-opacity` with `mix-blend-mode: overlay`.
  - Pulse animation on the status-pip dot via `@keyframes pulse-pip` (2.2s ease-in-out shadow-expansion).
  - Connection heartbeat script, logout banner toggle, drawer-hamburger interaction — all preserved verbatim; only the surrounding chrome restyled. The "Connecting…" / "Connected" / "Reconnecting…" labels became "Tuning…" / "Live" / "Reconnecting…" / "Disconnected" / "Signed out" / "Session expired" to match the editorial tone.

- **`src/components/` — 8 primitives re-wired:**
  - `Card.astro` — scoped block dropped entirely. Letterpress border-left rule, vermillion hover state with translateY(-1px) + signal-coloured underscore growing from 2px → 3px, oversized Fraunces opsz 72 weight 900 numeral all live in Dashboard's global `.card` rules. Pages that hand-roll `<div class="card">` markup pick up the same look without changes.
  - `Table.astro` — scoped block trimmed to caption + custom `.empty-cell` (centered "Loading transmission…"). Editorial table chrome (uppercase monospaced thead, vermillion-tinted row hover via `color-mix(in srgb, var(--signal) 4%, transparent)`, amber link borders, monospaced 12px body) in global.
  - `Alert.astro` — scoped block dropped. Editorial `.alert` with italic Fraunces opsz 36 weight 700 `h4`; `.alert--success` h4 in `#2a8b54`, `.alert--conflict` h4 in `#c0263a`, `.alert--info` neutral.
  - `Field.astro / Form.astro / Submit.astro` — scoped blocks dropped. Form scaffolding in global: labels as monospaced 10px uppercase eyebrow; inputs with `--bg-2` background, vermillion focus ring; `.btn-primary` filled vermillion (`color: var(--bg)`) with hover transitioning to filled `--ink`; `.btn` neutral outline; `.btn-danger` red outline.
  - `EmptyState.astro` — scoped block rewritten editorially: monospaced "No records on file" eyebrow in vermillion above the title; italic Fraunces opsz 36 weight 700 title; 28×2px vermillion underscore rule; vermillion-filled CTA button transitioning to `--ink` on hover.
  - `PageShell.astro` — h2 → h3 (Dashboard's `.page-title` h2 owns the page heading now). Kept for pages that want a sub-section header + description block.

- **Pages untouched.** All 12 pages (Overview, Projects×3, Build, Spend, Directives×2, Findings, Questions×2, Chat) pick up the new aesthetic via the global stylesheet because they reference shared classes (`.card`, `.alert`, `.empty`, `.form-field`, `.btn`, table chrome) rather than carrying their own styles. The PageShell migration carry-forward is therefore absorbed _de facto_. Remaining inline `style=` attributes (e.g. `index.astro:15` `style="margin-top: 1.5rem;"`) are cosmetic-only and not load-bearing.

**Tier 9 in retrospect:** 0 commits this session — informal cadence at operator request. Total session output: ~660 lines of new CSS in `Dashboard.astro` + net-negative across the 8 component files (scoped blocks dropped, only `EmptyState`'s grew). The `.control` recordkeeping (this LOG entry + plan + phase folder + ROADMAP/phase-plan deltas + STATE.md flip + journal entry) is ~600 lines of doc — heavier than the code change because of the audit-trail discipline factory5 carries. All four `pnpm` gates green: build / test / lint / format:check. Workspace test counts unchanged at 1182 + 3 skipped (`.astro` style changes don't add tests). No new ADR — the dual-theme decision was a session-time judgement call following Phase 3's existing frontend rules, not a structural pinning. If a future tier wants to lean on the design tokens, ADR 0031 — Editorial Control Room aesthetic + dual-theme token contract — could formalize it retrospectively.

**Manual verification still owed:** assistant cannot open a browser from this environment. Operator should run `factoryd` + `factory ui-token`, open the URL, click through all 8 sections, toggle OS theme between light + dark, verify both render correctly. The four `pnpm` gates verified everything code-side; live pixel-verification is operator-owned.

**Next session:** operator-gated. Recommended sequence:

1. Browser verification.
2. Bundled commit of the working tree (suggested message in `UPGRADE/plans/tier-9-control-room-redesign.md` under "Commit message").
3. `/phase-close` to tag `phase-9-control-room-redesign-closed`; append the final entry to this LOG; transition STATE back to "all phases complete" unless a Tier 10 demand signal arrives.

**Tier 9 carry-forward candidates after close:**

- **Inline-style audit on the 12 pages** — handful of cosmetic-only `style="margin-top: …"` remaining. Self-contained ~30-min sweep.
- **ADR 0031 — Editorial Control Room aesthetic + dual-theme token contract** — formalizes the design decision retrospectively.
- All Phase 8-era carry-forwards remain intact (U005 chat REPL cancel, per-project deadline override, `factory config get/set`, override-after-auto-answer, etc.).

---

## 2026-05-08 — Phase 8 (`ask_user` deadline + LLM auto-answer) closed; upgrade arc complete (fifth time)

`/phase-close` ran on Phase 8. Eight commits shipped this session (scaffold + 8.1 → 8.7 + this 8.close). Tagged `phase-8-question-auto-answer-closed` (annotated) at the close commit. **No Phase 9 scaffolded** — `phase-plan.md` defines no Phase 9 entry; the upgrade arc closes again. STATE.md transitions back to "all phases complete" (fifth occurrence — Tier 4 original close, Tier 5 reopened post-prompt-audit, Tier 6 reopened post-skills-audit, Tier 7 reopened to ship operator-side parallel of 6.3's parser, Tier 8 reopened to unblock autonomous runs when the human is absent, this close is again terminal unless a Tier 9 demand signal arrives).

**Why this tier was needed:** the `ask_user` flow (ADR 0024) assumed a human always answers. Autonomous runs that hit an `ask_user` mid-stream (a builder finding the spec ambiguous, a reviewer needing more info, a planner finding a category overlap) waited indefinitely. The orphan sweep (`factory questions cleanup`) handled the unanswered case but only retroactively, after the parent directive had already terminated for some other reason — typically a budget exhaustion or manual `factory cancel`. The directive failed for the wrong reason: it stalled, not budgeted-out. Tier 8 added an active path: when an `ask_user` goes unanswered past its deadline, factory makes an LLM call with surrounding context, writes the answer back marked as agent-authored, and lets the directive proceed.

Operator chose this candidate at session start over the other Phase 7 carry-forwards (U005 chat timeout, `factory skills list/show`, etc.) — judgment was that the autonomous-run unblock has the highest leverage; the other items are speculative wishlist or twice-deferred UX nits.

**What shipped in Phase 8** (cumulative across the single session — 8 substantive commits):

- **Scaffold** — `chore(phase-8): scaffold tier 8 question-auto-answer` at `8453086`. `UPGRADE/plans/tier-8-question-auto-answer.md` (~270 lines, 7 work sub-tasks + close); phase-plan.md Phase 8 row + summary section + intro update; ROADMAP Tier 8 section + intro count "Seven tiers → Eight tiers" + dependency-table row + carry-forward updates (U005 → Tier 9 candidate); `.control/phases/phase-8-question-auto-answer/{README.md,steps.md}`; STATE.md cursor flip arc-complete → Phase 8 active at 8.1; regenerated next.md. Operator decisions baked in at scaffold time: provenance via new `answered_by` column (option A); 5-min default deadline configurable via `<dataDir>/config.json`; no override after auto-answer; U005 stays parked.
- **8.1** — Opened U029 (unanswered `ask_user` blocks directive; no auto-answer fallback) at `93a7c9a`. Severity medium; Tier 8; Area brain. Hypothesis line traced the full Tier 8 design (migration 009 + ADR 0030 + loadConfig + brain stamp + dispatcher + sweep + surface updates). U005 entry refreshed with Tier 9 candidate annotation + path (a+) hypothesis shape from the conversation that scoped Tier 8.
- **8.2** — Migration 009 + `pending_questions.answered_by` column at `cd08976`. ADD COLUMN with CHECK constraint over the four-value enum (`'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`); NULL bypasses CHECK so unanswered rows stay legal. Backfill is split: pre-existing answers matching `[orphaned by factory questions cleanup at %` get `'orphan-sweep'`; every other answered row gets `'user'`; unanswered rows stay NULL. Idempotent via `WHERE answered_by IS NULL`. `pendingQuestionSchema` (in `@factory5/core`) gains optional `answeredBy` field. `pendingQuestions.answer(...)` extends to a fifth optional `answeredBy` parameter (default `'user'` for existing CLI / channel / web call sites) and is now race-loser-safe via `WHERE answered_by IS NULL` — a concurrent agent claim no-ops the human's write rather than overwriting the agent's answer. `markOrphanAnswered` updated to set `answered_by = 'orphan-sweep'`. 6 new migration-shape tests + 3 pre-existing migration tests (003 / 004 / 006) had their hard-coded applied-id arrays grown by 9. Workspace state +6 tests at this step.
- **8.3** — ADR 0030 — pending-question auto-answer contract at `8365b6a`. Six-part decision: (1) `answered_by` enum semantics; (2) 5-min default deadline, daemon-wide via `<dataDir>/config.json`; (3) LLM dispatcher in `packages/brain/src/auto-answer.ts`, retry-once-then-synthetic; (4) race mitigation via sentinel claim before LLM call; (5) spend recorded under category `system/auto-answer` on success only against the parent directive; (6) no override after auto-answer. Cross-references ADR 0024 (worker-subprocess `ask_user`) which Tier 8 extends rather than supersedes. `INDEX.md` updated. ADR 0024 not edited per CLAUDE.md "do not edit accepted ADRs" — 0030 references 0024 in its own header instead.
- **8.4** — `loadConfig()` / `writeConfig()` reader+writer at `d894aaa`. Schema + `DEFAULT_ASK_USER_DEADLINE_MS = 300_000` exported from `@factory5/core` (pure types/schemas); the actual reader/writer I/O lives in `packages/state/src/config.ts` since state already imports `@factory5/logger/paths` for `dataDir()` and hosts the existing `defaultDbPath()`. Plan-deviation: state vs core for I/O — keeps core free of fs operations without changing the public surface (FactoryConfig + DEFAULT\_\* re-exported through state). `loadConfig` returns defaults on missing file/empty file/missing key; throws on invalid JSON or schema mismatch. `writeConfig` merges with existing keys, validates the merged result before persisting (no invalid file ever lands on disk), atomic via tmp + rename. 11 unit tests.
- **8.5** — Brain stamps `ask_user` `deadline_at` from config at `dd25d78`. Audit found a single production call site (`packages/brain/src/ask-user.ts:213`); the daemon-side `askUser({...})` invocation at `packages/daemon/src/index.ts:605` flows through it. Caller-provided `opts.deadlineAt` still wins; absent → auto-stamped from cached config (`resetDeadlineCache()` exposed for tests). Logged-fallback on corrupt config so the brain doesn't crash on every emission. New `AskUserOptions` fields: `now` (clock injection) + `configDataDir` (config root override) — both production-omitted, test-only. 3 new tests (auto-stamp from a per-test config dir asserting expected deadline; default fallback when config file is absent; caller-provided `deadlineAt` wins over the config default).
- **8.6** — Brain auto-answer dispatcher + deadline sweep at `89f58c8`. Three new query helpers in `packages/state/src/queries/pending-questions.ts`: `findOpenPastDeadline(db, now, limit=10)` JOINs directives and filters answered_at IS NULL + answered_by IS NULL + deadline_at < now + parent-directive not in terminal status (sorted deadline_at ASC); `claimForAutoAnswer(db, id, when)` sentinel UPDATE that writes `answered_by='agent'` + `answer='[in flight]'` atomically with `WHERE answered_by IS NULL` (returns true if won); `finalizeAutoAnswer(db, id, answer, when, 'agent'|'agent-failed')` for the post-LLM finalize. New `packages/brain/src/auto-answer.ts`: `runAutoAnswerSweep(deps)` scans + dispatches batch-bounded via `Promise.allSettled`; `autoAnswerOne(q, deps)` handles one question through the four paths (success, retry-then-success, double-failure, claim-lost no-op); `buildAutoAnswerPrompt(q, directive, pastQA)` assembles a generic prompt covering question + options + parent directive intent/autonomy/payload + up-to-10 past Q&A pairs in this directive. Plan-deviation: dropped CLAUDE.md/task_log/findings from prompt context for first ship per ADR 0030's "alternatives considered" — generic prompt sufficient until quality data shows it's not. Provider call uses category `'quick'` (ADR 0030 §6 spend taxonomy); spend recorded via existing `recordUsage` path on success only. Empty/whitespace-only completions treated as failures (retry once, then `'agent-failed'`). Wired into `runServe` loop with `AUTO_ANSWER_SWEEP_INTERVAL_MS = 5000ms` throttle so the 250 ms tick doesn't burn cycles on the unchanged-state case; sweep errors caught + logged so they never break the directive claim path. 10 tests in `auto-answer.test.ts` covering all four auto-answer paths + sweep ordering + terminal-directive skip + no-rows no-op + 2 prompt-shape tests.
- **8.7** — Web UI surfaces the answerer at `992affa`. `apps/factory-web/src/pages/questions/index.astro`: adds "Answered by" column rendering 'human' / 'agent (auto)' / 'agent (LLM failed)' / 'orphan sweep'; empty cell on open rows. `apps/factory-web/src/pages/questions/detail.astro`: adds "Answered by" meta row (only on answered rows) using a more verbose form ('agent (auto-answered after deadline)', etc.) since the detail page has more space. The IPC schemas reuse `pendingQuestionSchema` from core, so `answeredBy` flows through automatically. Plan-deviation: CLI `factory questions list / show <id>` deferred — those subcommands don't exist today; only `factory questions cleanup` is wired and operates on orphan rows where `answered_by IS NULL` until the sweep claims them. Adding list/show is its own tier; not load-bearing for ADR 0030. U029 marked Resolved with full implementation summary.

**Tier 8 in retrospect:** 8 commits this session (scaffold + 8.1–8.7 + this 8.close). Total session output: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped — broken down: +6 in state from migration 009 tests; +11 in state from config tests; +3 in brain from ask-user deadline tests; +10 in brain from auto-answer tests. New ADR (0030) — Tier 8 had real structural decisions (provenance shape, config home, race mitigation, no-override) that needed pinning, unlike Tier 7 which was pure composition. Two intentional plan deviations both noted in commit bodies + this LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A (CLAUDE.md / task_log / findings dropped) for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms.

**Manual smoke verification:** the auto-answer dispatcher tests use a `ScriptedProvider` stub that returns canned responses or throws on demand, so the four auto-answer paths (success, retry-then-success, double-failure, claim-lost) and the spend-recorded-only-on-success rule are exercised end-to-end at the dispatcher level against a real SQLite (`:memory:`) with real migration 009 applied. The serve-loop wire-in is verified by inspection — the existing serve.test.ts continues to pass with the new sweep call inserted, and the throttled sweep doesn't fire in the test's short windows. Future operator can run a live autonomous build that emits an ask_user, walk away, and verify the auto-answer fires after 5 minutes; not gating this close.

**Observations worth recording:**

- **The `deadline_at` column existed since the original schema but was honoured nowhere.** ADR 0024 reserved the slot but neither the brain's polling code nor any other consumer read it. Tier 8 is the first consumer; the schema column was load-bearing in retrospect.
- **The race between human reply and dispatcher is real but graceful.** The sentinel-claim pattern means the loser (whichever side) is a no-op rather than a corruption. A human typing `factory answer` while the dispatcher is mid-LLM-call sees their input silently dropped — logged at warn but no UI indication. If this becomes common in practice, surface a CLI message like "an agent answered this question while you were typing"; out of scope for v1.
- **The "category" string in spend is just TEXT — adding `system/auto-answer` didn't require any enum or schema change.** Reporting tools that filter on category should add the new value to allow-lists if they have one; the default `factory spend` rolls up by directive regardless of category, so the default report is unaffected.
- **The brain's tick loop now does double duty.** Pre-Tier-8 it was directive-claim-only; post-Tier-8 it also drives the auto-answer sweep. The 5s throttle bound keeps the sweep from spamming the DB at the 250ms tick rate. No race on `lastAutoAnswerSweepAt` because the loop is single-threaded JS.

**Carry-forward into the post-arc parking state** (none load-bearing for any active phase, all from Phase 8's "Deferred to Phase 9" section + retained items from prior phases):

- **U005** — `factory chat` REPL 120 s timeout (still in `UPGRADE/ISSUES.md` Open). Tier 9 candidate; carry-forward from Phase 2's Tier-2-or-4 designation, twice-deferred. Path (a+) sketched in Phase 8 conversation: bump REPL daemon-reply timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt.
- **Per-project deadline override** — CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata.askUserDeadlineMs`. Non-breaking to add atop Tier 8's daemon-wide config; deferred until demand signal that different projects need different deadlines.
- **`factory config get / set <key>` CLI** — operator surface for editing `<dataDir>/config.json` without hand-editing the JSON. Add when other config keys justify it.
- **Override after auto-answer** — `factory questions answer --force <id>` superseding an `answered_by != 'user'` row. Pin via ADR if it ships; Tier 8 holds the simpler immutable-after-auto-answer invariant.
- **Channel-side `answered_by` badge** — Discord/Telegram historic embed rendering. Low value; defer.
- **Bulk auto-answer perf** — parallelizing the sweep when many deadlines fire simultaneously. Defer until profiles show the serial sweep is a bottleneck.
- **Agent-class-specialized prompts** — per-emitting-agent prompt templates (verifier-flavoured, fixer-flavoured, etc.). Defer until quality data shows the generic prompt underperforms.
- **`factory questions list / show <id>` CLI** — subcommands don't exist today; only `factory questions cleanup` is wired. Adding list/show is its own composition-style tier.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface; carry-forward; no demand signal.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit.
- **Structural `/session-end` lag-by-1 fix** — now **20 occurrences** with this Phase 8 close. Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit. Real engineering work.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5. Doc-debt; not load-bearing.

---

## 2026-05-08 — Phase 7 (findings-mark CLI) closed; upgrade arc complete (fourth time)

`/phase-close` ran on Phase 7. The drift-fix + 3 work commits (scaffold + 7.1 + 7.2) shipped this session, plus this 7.close. Tagged `phase-7-findings-mark-closed` (annotated) at the close commit. **No Phase 8 scaffolded** — `phase-plan.md` defines no Phase 8 entry; the upgrade arc closes again. STATE.md transitions back to "all phases complete" (fourth occurrence — Tier 4 was the original close, Tier 5 reopened post-prompt-audit, Tier 6 reopened post-skills-audit, Tier 7 reopened to ship the operator-side parallel of Tier 6's agent-side parser, this close is again terminal unless a Tier 8 demand signal arrives).

**Why this tier was needed:** Phase 6's "Deferred to Phase 7" section flagged `factory findings mark <id> <status>` as the most-likely demand-signal candidate, paralleling the agent-side `RESOLUTION` parser shipped in 6.3. The agent path was already wired (fixer emits `RESOLUTION F001 (FIXED): ...` → `parse-resolutions.ts` → `updateFindingStatus`), but operators had no symmetric verb — when a fixer agent didn't run (or the operator wanted to mark something `WONTFIX` directly), the only path was hand-editing `<workspace>/<project>/.factory/findings.json`. Tier 7 closed that gap with composition over the existing API.

Operator chose this candidate at session start over the other Phase 6 carry-forwards (U005 chat timeout, PageShell migration, etc.) — judgment was that the agent+operator marker-flip surface is a natural pairing and shipping the operator side completes the loop.

**What shipped in Phase 7** (cumulative across the single session):

- **Drift-fix** — `docs(state): bump last-commit pointer to a5c23ab (drift-fix)` at `436887a`. Caught STATE.md up to HEAD after the prior session's session-end lag-by-1 (#18). Pure session-start reconciliation; no phase work. The next phase-close reintroduces the lag at #19 — structural fix for the `/session-end` skill is still pending (Tier 8+ candidate).
- **Scaffold** — `chore(phase-7): scaffold tier 7 findings-mark CLI` at `ee970e8`. `UPGRADE/plans/tier-7-findings-mark.md` (~150 lines, 3 sub-tasks); phase-plan.md Phase 7 row + summary; ROADMAP Tier 7 section + intro count "Six tiers → Seven tiers"; `.control/phases/phase-7-findings-mark/{README.md,steps.md}`; STATE.md cursor flip arc-complete → Phase 7 active at 7.1; regenerated next.md.
- **7.1** — Opened U028 (`factory findings mark <id> <status>` CLI verb missing) in `UPGRADE/ISSUES.md` Open section. Severity low; Tier 7; Area cli. Hypothesis line points at the composition path: handler wraps `updateFindingStatus`, disambiguation copies `runFindingsShow`, no new dependencies or ADRs. Commit: `chore(7.1): open U028` at `b1dd5d6`.
- **7.2** — Implemented the verb. New `runFindingsMark(db, rawId, rawStatus, opts)` handler in `packages/cli/src/commands/findings.ts` (pure async; returns `{ stdout, exitCode }`). Status normalization is case-insensitive on input; output renders upper-case (`OPEN → FIXED` shape). Bare-id ambiguity reuses the exact same `renderAmbiguity` block `runFindingsShow` emits — operators see one consistent disambiguation pattern across read and write surfaces. `--note <prose>` populates `resolution` via `updateFindingStatus`'s 4th param; `FindingRegistryBinding` is constructed from the resolved entry's `projectId` so per-project `findings.json` AND the cross-project registry both stay current. Idempotent re-flip succeeds (`resolvedAt` set on first transition to a terminal state and preserved across subsequent flips per the existing API contract). Commander wiring adds `group.command('mark <id> <status>')` with `--note <prose>` + `addHelpText('after', ...)` worked examples + `Exit codes:` line. 8 unit tests in `findings.test.ts` against real `mkdtemp` workspaces with on-disk `.factory/findings.json` (bare-id happy path / `<project>/<id>` form when bare would be ambiguous / ambiguous bare-id rejection / invalid status / not-found in both forms / `--note` persistence / case-insensitive input / idempotent re-flip preserves resolvedAt). `packages/cli/src/commands/completion.ts` `NESTED_SUBCOMMANDS.findings` grew by `'mark'` (bash/zsh/pwsh tab completion now offers it). `packages/cli/README.md` findings table row + section text describe the new verb. Top-of-file doc block in `findings.ts` adds the mark subcommand and cross-references Tier 6 step 6.3. Sweep of `prompts/agents/fixer.md` (and `skills/`) for stale "no operator CLI" / "must hand-edit findings.json" phrasing came up empty — Tier 6 had already removed those when 6.3 wired the parser. CLI package: 133 → 141 tests; workspace total 1144 → 1152 + 3 skipped. Closes U028. Commit: `feat(7.2): factory findings mark <id> <status> CLI command` at `0d27925`.

**Tier 7 in retrospect:** 5 commits this session including drift-fix and phase-close (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925` + this 7.close). Total session output: ~370 lines added across the codebase (most in 7.2's handler + tests + README updates). All 4 `pnpm` gates green throughout. No new ADRs — Tier 7 is composition over an existing API; no structural ambiguity to pin. Pre-write homework for 7.2 was minimal (re-read `runFindingsShow` for disambiguation pattern; confirm `updateFindingStatus`'s `registry?` parameter semantics; copy the test seeding pattern from `runFindingsBackfill`). One minor friction: prettier reformatted 3 files (`README.md`, `findings.ts`, `findings.test.ts`) on first format-check run after editing — same pattern as Tier 6's deviations, just author-draft → prettier-normalize. Ran `pnpm prettier --write` once and gates passed clean.

**Manual smoke verification:** done-criteria 4–6 specified mark-verb end-to-end against a seeded registry. The 8 unit tests use `mkdtemp` to create real workspace dirs with `.factory/findings.json` files and verify both registry rows AND on-disk JSON flip through the actual `updateFindingStatus` API — that's end-to-end at the handler level. Commander wrapper layer verified manually via `factory findings mark --help` rendering all 3 worked examples and `factory completion bash` showing `list show backfill mark` in the findings vocab. Future operator can run a live mark against a real workspace as a confidence check; not gating this close.

**Carry-forward into the post-arc parking state** (none load-bearing for any active phase, all from Phase 7's "Deferred to Phase 8" section + retained items from prior phases):

- **U005** — `factory chat` REPL 120 s timeout (still in `UPGRADE/ISSUES.md` Open). Tier 8 candidate; carry-forward from Phase 2's Tier-2-or-4 designation. Highest-impact channel-chat UX gap remaining.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface; composition-style ~1 commit if narrowly scoped (CLI wraps `loadSkill(id)` from `packages/brain/src/prompts.ts`). Tier 8 candidate.
- **Bulk findings-mark surface** — Tier 7 was single-id by design; bulk-mark only worth building if an audit-cleanup workflow needs it. Defer-until-signal.
- **Findings history surface** — first-class who/when/why log per finding; current `resolution` + `updatedAt` cover the common case. Defer-until-signal.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit.
- **Structural `/session-end` lag-by-1 fix** — 19 occurrences accumulated. Two structural options: track "last work commit" rather than HEAD, or amend STATE.md post-commit. Real engineering work, not a one-liner.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5. Doc-debt; not load-bearing.

---

## 2026-05-07 — Phase 6 (skills-rewrites + fixer parser path) closed; upgrade arc complete (third time)

`/phase-close` ran on Phase 6. All 11 sub-step commits shipped (scaffold + 6.1 → 6.last in this session, plus the 6.close kickoff). Tagged `phase-6-skills-rewrites-closed` (annotated) at the close commit. **No Phase 7 scaffolded** — `phase-plan.md` defines no Phase 7 entry; the upgrade arc closes again. STATE.md transitions back to "all phases complete" (third occurrence — Tier 4 was the original close, Tier 5 reopened post-prompt-audit, Tier 6 reopens post-skills-audit, this close is again terminal unless a Tier 7 demand signal arrives).

**Why this tier was needed:** post-Tier-5 retro flagged two compounding gaps:

1. **All 12 skills in `skills/` were "ported from factory2/skills/"** per `docs/SKILLS.md` line 7 with no audit pass against factory5 architecture. Tier 5 5.4–5.7 prompt rewrites had referenced 6 of them by name (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without deep-reading their bodies — reference-only inspection misses body-level drift.
2. **`prompts/agents/fixer.md` documented the `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` marker grammar but no code parsed agent output for those markers.** `packages/wiki/src/findings.ts:196` exported `updateFindingStatus` but it was only invoked from tests. When the fixer agent declared a finding fixed, the operator had to hand-edit `findings.json`.

Operator chose Path 4 (Tier 6 + fixer parser as 6.x) over Path 1 (skills-only) at session start — bundling closes both loops in one tier rather than two scattered workstreams.

**What shipped in Phase 6** (cumulative across the single session):

- **Scaffold** — `chore(phase-6): scaffold tier 6 skills audit + fixer parser` at `542f99a`. `UPGRADE/plans/tier-6-skills-rewrites.md` (~250 lines, 6 sub-tasks); phase-plan.md Phase 6 row + summary; ROADMAP Tier 6 section + intro count "Four → Six tiers"; `.control/phases/phase-6-skills-rewrites/{README.md,steps.md}`; STATE.md cursor flip arc-complete → Phase 6 active at 6.1; regenerated next.md.
- **6.1** — Opened U026 (`skills/* — 12 ported-from-factory2 skills with no factory5 audit`) + U027 (`Fixer agent output → updateFindingStatus has no parser path`) in `UPGRADE/ISSUES.md`. Both with hypothesis lines pointing at planned remediation. Commit: `chore(6.1): open U026 + U027` at `0817547`.
- **6.2** — Skills audit pass. Read all 12 skill bodies, classified as 4 clean (`architect`, `ask-user`, `documentation`, `tdd`), 2 hot-fix (`brainstorming`, `integration-testing`), 6 rewrite (`code-review`, `dependency-install`, `error-recovery`, `progress-tracking`, `scaffolding`, `work-verification`). 6 rewrites moved Tier 6 from "1 session if 0–2 rewrites" to "2-session territory" per the plan's pacing. Plan + steps.md updated with explicit per-skill rewrite rows in 6.4..6.9 alphabetical. Commit: `docs(6.2): skills audit verdicts + plan/steps refinement` at `97c8e45`.
- **6.3** — Wired the fixer parser path. Pre-write homework re-grep confirmed Tier 5 5.5's "no parser today" finding still held, AND surfaced that the verifier `FINDING` parser model lives at `packages/worker/src/parse-findings.ts` (worker-side, not brain-side as the issue text assumed). New `packages/worker/src/parse-resolutions.ts` mirrors `parse-findings`'s shape: line-anchored strict regex `/^RESOLUTION\s+(F\d+)\s+\((FIXED|VERIFIED|WONTFIX)\):\s*(.*)$/im` with multi-line description capture. New `persistResolutions()` in `run-worker.ts` (parallel to `persistFindings`) iterates parsed markers, dispatches `updateFindingStatus`, catches throw-on-unknown-id and logs WARN + skips (no task failure). Wired into both run-worker call-sites (inline-no-tooling at L350; tool-using at L521), sequenced AFTER `persistFindings` to avoid the read-modify-write race on `findings.json`. 9 unit tests in `parse-resolutions.test.ts`: empty / single FIXED / VERIFIED + WONTFIX / case-insensitive / multi-line / malformed rejection (no parens, wrong status, missing F prefix, no colon) / mid-line anti-prose / whitespace tolerance / back-to-back. `prompts/agents/fixer.md` updated: section heading dropped "(prose-only today)"; "Operational caveat (Tier 5 reality)" + "wiring is a Tier 6 candidate" paragraphs replaced with confirmation that the parser is wired (cites worker + wiki paths) plus the strictness rules. Worker package: 38 → 47 tests. Workspace total: 1135 → 1144 + 3 skipped. Closes U027. Commit: `feat(6.3): wire fixer→updateFindingStatus parser` at `65729cf`.
- **6.4 → 6.9** — Six per-skill factory5-native rewrites in alphabetical order. Common drift addressed across the cluster: `BUILD.md` as the canonical persistence surface (replaced with `findings_registry` per ADR 0021); `CRITICAL/WARNING/INFO` severity terminology (replaced with `FINDING [LOW|MEDIUM|HIGH|CRITICAL]` grammar); `--break-system-packages` antipattern (replaced with venv discipline); `FACTORY_COMPLETE` legacy token (replaced with FINDING-as-output + ADR 0018 advisory framing); `npm` vs `pnpm` defaulting; sparse TypeScript sections (expanded to factory5-equal depth). Per-skill commits at `1ea2d82` / `1e5a67e` / `d7a9b7e` / `7b409ac` / `f1e1075` / `a4b51e6`. One per-skill verbatim-rule deviation (frontmatter description for `progress-tracking.md` was rewritten because the original "BUILD.md is the single source of truth" was factually wrong against ADR 0021); a second deviation in 6.last for `scaffolding.md`'s description for the same reason (BUILD.md as project-state signal isn't a factory5 trigger).
- **6.last** — Final cleanup. Hot-fixes for the 2 audit-flagged skills: `brainstorming.md` line 14's source list dropped BUILD.md and added findings_registry reference; `integration-testing.md` line 94's BUILD.md completion-marker convention replaced with `tests-green` signal + FINDING [HIGH] tests pattern. Provenance scrub: `docs/SKILLS.md:7` replaced with "Skills are factory5-native"; `docs/SKILLS.md:45` "analog of factory2/src/factory/skills.py" replaced with the actual factory5 surface (`packages/brain/src/prompts.ts`'s `loadSkill(id)`); `scaffolding.md` frontmatter description updated. Final state grep-verified: zero `factory2` references in `skills/` or `docs/SKILLS.md`; BUILD.md mentions remain only in instructive-negative form ("you don't write a BUILD.md" — load-bearing factory5-native framings, not factory2-era prescriptions). Closes U026. Commit: `docs(phase-6): drop factory2 provenance + apply skill hot-fixes (6.last)` at `e942ec7` (commit-msg hook required `phase-N` scope since "last" isn't numeric).

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + this 6.close). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout — workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs (the 6.3 attach-point homework found a clean precedent in parse-findings; no structural ambiguity to pin). Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in commit body but README left as historical scaffold.

**Manual verification gap (acknowledged):** the 6.3 acceptance allowed "Manual or integration-test verification of the marker → flip path". The parser is unit-tested (9 fixtures); `persistResolutions` is a tight wrapper around well-tested `updateFindingStatus`; the integration mirrors `persistFindings` (which is similarly tested only at the parser level). End-to-end manual verification on a live fixer directive is the natural next operator-side check. Not blocking close per the criterion's "or" language.

**Carry-forward into the post-arc parking state** (none load-bearing for any active phase, all from Phase 6's "Deferred to Phase 7" section):

- **U005** — `factory chat` REPL 120 s timeout (still in `UPGRADE/ISSUES.md` Open). Carry-forward from Phase 2's Tier-2-or-4 designation; both shipped without addressing it. Tier 7 candidate if demand signal arrives.
- **`factory findings mark <id> <status>` CLI command** — operator-side parallel to 6.3's agent-side parser. Now that the agent-side flow is wired (RESOLUTION markers cause auto-flips), an operator-side CLI verb is the next composition. Tier 7 candidate.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface. Tier 8 candidate.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit.
- **ADR 0027 §1 missing route pin** (POST `/api/v1/projects`) and **ADR 0002 footnote stale post-Tier-5** — doc-debt amends; not load-bearing.

**Read first** when the next session picks up: this entry, `STATE.md`, `journal.md`. Phase 6 sealed; the upgrade arc rests at "all phases complete" again.

---

## 2026-05-07 — Phase 5 (agent-prompts) closed; upgrade arc complete (again, post-Tier-5 audit pass)

`/phase-close` ran on the Phase 5 work. All nine sub-steps shipped (5.1 → 5.8 in this session, plus the 5.9 close). Tagged `phase-5-agent-prompts-closed` (annotated) at the close commit. **No Phase 6 scaffolded** — `phase-plan.md` defines no Phase 6 entry; the upgrade arc is complete (again) post Tier 5's audit-driven addendum. STATE.md transitions back to "all phases complete".

**Why a Tier 5 was needed at all:** post-Tier-4 audit (2026-05-07) surfaced three categories of staleness in the codebase:

1. **Three pure stub agent prompts ship to the model on every directive** — `prompts/agents/reviewer.md`, `fixer.md`, `investigator.md` were 10-line files with `> **Phase 1 stub. Body to be ported from factory2…**` markers. The brain dispatched the agent's role on a 10-line prompt; the deficient roles do real work in some directive shapes (multi-builder fix passes, novel-problem investigations).
2. **One hybrid lied about itself** — `builder.md` had substantive Python venv discipline (load-bearing for I007 host-pollution prevention) but still flagged itself as a "Phase 1 stub". A reader hit the marker and assumed the file was empty.
3. **Two stale doc claims compounded discoverability** — `prompts/agents/README.md` falsely flagged all 9 prompts as "stub" (5 are substantive); `docs/ONBOARDING.md` §5.4 claimed detail pages are read-once + projects can't be created from the SPA — both shipped past in Tier 3 (SSE on `/api/v1/directives/:id/stream`; `/app/projects/new` route).

Plus one carry-over: `factory logs` had shipped as a "stub that prints a hint" since Phase 1 of the original arc.

User directive at session start: **"build new for factory5, don't port from factory2."**

**What shipped in Phase 5** (cumulative across the single-session arc):

- **5.1** — Opened U024 (`prompts/agents/README.md` status table is stale) + U025 (`docs/ONBOARDING.md` §5.4 read-once + project-creation-out-of-scope claims are stale post-Tier-3) in `UPGRADE/ISSUES.md`. Both had Hypothesis lines pointing at the planned remediation. Commit: `chore(5.1): open U024 + U025` at `8fb3b29`.
- **5.2** — Dropped the stale Status column from `prompts/agents/README.md`; replaced with `File | Role | Purpose` (one-line role descriptions sourced verbatim from `docs/AGENTS.md` so the two docs can't drift). Dropped the "Phase 1 work" trailer. Folded legacy/ rows into a single explanatory paragraph below the table. Closes U024. Commit: `docs(5.2): prompts/agents/README.md — drop stale stub-tracking column` at `e08f062`.
- **5.3** — Re-titled `docs/ONBOARDING.md` §5.4 from "Today's limitations" to "Live updates + write-mode" (the section now describes capability rather than gaps). Confirmed SSE live updates with the 15s `:keepalive` heartbeat + connect-time backfill + polling fallback (cites ADR 0029). Confirmed full write-mode (build / projects/new / projects/detail budget edit / questions/detail answer / chat) with ADR 0027 reference. Added missing rows to §5.3's page tour table (`/app/chat/`, `/app/projects/new/`); tagged `directives/detail` as SSE-live. Three follow-up flags surfaced (§6.4 polling-fetch reference; §6.1 stale Tier-2-or-4 hint about U005; ADR 0027 §1 doesn't pin POST `/api/v1/projects`). Closes U025. Commit: `docs(5.3): docs/ONBOARDING.md §5.4 — drop read-once claim post-Tier-3` at `27dc6c7`.
- **5.4** — Wrote `prompts/agents/reviewer.md` from scratch (factory5-native, ~156 lines after prettier). Pre-write homework verified the runtime contract: reviewer findings flow as **blocking** by default per `packages/wiki/src/findings.ts:130`'s `resolveAdvisory` (auto-defaults `advisory: true` only for `source: 'verifier'`). Operational caveat captured: brain's `hadFailures` (`packages/brain/src/loop.ts:435-438`) is gated on assessor `gate.verify` + task exit codes, not finding count, so "blocking" is operator-visibility distinction rather than auto-stop. Adversarial framing + shadow-test affordance + anti-noise gate + severity-evidence-floor table all pinned. Runtime contract pins: marker grammar via `packages/worker/src/parse-findings.ts`; source-string auto-stamped at `run-worker.ts:203`. Tools envelope pinned (Read/Write/Glob/Grep — no Edit, no Bash). No ADR 0030 needed. Commit: `docs(5.4): prompts/agents/reviewer.md — write factory5-native body` at `21bf980`.
- **5.5** — Wrote `prompts/agents/fixer.md` from scratch (factory5-native, ~158 lines after prettier). Pre-write homework grep-verified that **no agent-output → `updateFindingStatus` parser path exists** anywhere in `packages/brain/src/` or `packages/worker/src/`. Wiki API exists at `findings.ts:196` (only invoked from tests); no CLI `factory findings mark` command. Branch 3 chosen (prose-only); commit type stayed `docs(5.5)`. `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` marker grammar pinned as future-parser lock-on shape (Tier 6 candidate). Finding-by-ID intake contract pinned (cites ADR 0021 cross-project addressing); file-ownership scope rule pinned (target glob is the boundary; `ask_user` required to widen). Commit: `docs(5.5): prompts/agents/fixer.md — write factory5-native body (branch 3, prose-only)` at `839c2c1`.
- **5.6** — Wrote `prompts/agents/investigator.md` from scratch (factory5-native, ~140 lines after prettier). Read-only constraint pinned with concrete OK / NOT-OK Bash example lists (the load-bearing sections of the prompt). HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions (not parsed); the brain has no parser today, but the marker grammar is what a future parser would lock onto. RECOMMENDED NEXT vocabulary pinned (`fixer <project>/<finding-id>` / `architect` / `none — false alarm` / `more investigation needed`). Tools envelope pinned (Read/Glob/Grep/Bash + ask_user; no Write/Edit). Commit: `docs(5.6): prompts/agents/investigator.md — write factory5-native body` at `ae47147`.
- **5.7** — Fleshed out `prompts/agents/builder.md` (factory5-native, ~185 lines after prettier; comparable to scaffolder 178 / planner 197). **CRITICAL preservation**: the existing Python venv discipline section (load-bearing for I007 host-pollution defence) preserved byte-for-byte, verified via `git diff | grep ^-` showing only 4 removed lines (3 from old frontmatter description + the stub marker). New TDD body added on top (six-step Red-Green-Refactor cycle with builder-specific framing); file ownership scope pinned (planner's `expectedOutputs.files[]` as boundary, `expectedOutputs.signals[]` as done-criterion); BUILD.md prohibition preserved verbatim; "Findings — you cite, you do not raise" rule explicit (builder has Write but shouldn't use it for finding emission). Commit: `docs(5.7): prompts/agents/builder.md — flesh out factory5-native body` at `005e75b`.
- **5.8** — Path B (retire) chosen for `factory logs` per plan default + auto-mode "make reasonable assumptions". Deleted `packages/cli/src/commands/stubs.ts` (single-purpose file containing only the logs stub). Removed `registerStubCommands` import + call from `packages/cli/src/cli.ts`. Dropped the row from `packages/cli/README.md` (the table now contains zero stub rows). Dropped `'logs'` from `packages/cli/src/commands/completion.ts`'s top-level command vocab. ADR 0002 footnote about `factory logs` (Consequences §) flagged but unedited (CLAUDE.md "do not edit accepted ADRs in `docs/decisions/` — supersede with a new one"; superseding for one footnote is over-engineering). All four `pnpm` gates green post-deletion (build / test 13 packages all passing / lint / format:check). The help-coverage test (`packages/cli/src/help-coverage.test.ts`) walks the Commander tree dynamically and shrunk by one leaf without changes. Commit: `chore(5.8): retire factory logs stub` at `59a684f`.
- **5.9** — `/phase-close` (this commit's structural close).

**ADRs decided in Phase 5:** none. Pre-write homework for 5.4 (reviewer findings policy) + 5.5 (fixer parser path) both confirmed unambiguous runtime contracts — no ADR 0030 was needed. Cumulative ADR count for the upgrade arc remains **three** (0027 / 0028 / 0029 — all decided in Phase 3).

**Issues closed in Phase 5:** U024 + U025 (both opened by 5.1, closed by 5.2 + 5.3 respectively). Sha-backfill for both resolution lines landed in this phase-close commit (per Tier 5 plan §5.2/§5.3 acceptance: "marked Resolved with this commit's sha"; the lag-by-1 self-reference convention deferred sha backfill from the work commits to /phase-close).

**Test-count delta across Phase 5:** workspace held at **1135 + 3 skipped** throughout. 5.1–5.3 were doc-only; 5.4–5.7 were markdown-only (no test files); 5.8 deleted untested code (the stub command had no tests of its own).

**Cumulative across the upgrade arc** (Tiers 1 → 5):

- **Twenty-five issues moved Open → Resolved** — Tier 1 (U001-U003, U014-U017); Tier 2 (U004, U011-U013, U023); Tier 3 (U006-U010, U022); Tier 4 (U018-U021); Tier 5 (U024, U025). UPGRADE/ISSUES.md "Open" now contains only **U005** again (`factory chat` REPL turn timeout 120s — out-of-arc; the resolution-text "Tier 2 or 4. Pair with the chat surface work." is now stale since both shipped without addressing it; re-tier candidate for Tier 6).
- **Three new ADRs across the arc:** 0027 / 0028 / 0029 (all from Phase 3). Phase 4 and Phase 5 added zero — the runtime contracts in question were already pinned by 0001-0026 + the three Phase 3 ADRs.
- **All nine active agent prompts factory5-native:** triage, architect, planner, scaffolder, verifier (substantive pre-Tier-5); reviewer, fixer, investigator (written from scratch in 5.4–5.6); builder (fleshed out in 5.7 with venv preservation). The `prompts/agents/README.md` table now reflects reality.
- **One CLI command retired** as part of the audit-driven cleanup (`factory logs`, Tier 5 step 5.8). The CLI README's stub column is gone.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (1135 passing + 3 skipped; 13 packages green; per-package counts unchanged from end-of-Phase-4)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- All four `pnpm` gates re-verified at /phase-close.

**What's next:**

The upgrade arc is complete (again). Operator's options:

1. **Open Tier 6 — skills review + rewrites** (the strongest candidate). All 12 skills in `skills/` are explicitly "ported from factory2/skills/" per `docs/SKILLS.md`. Tier 5's 5.4–5.7 prompt rewrites referenced 6 of those skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without surfacing hot-fix-worthy drift; an audit-only pass might confirm they're clean, or might surface drift that warrants rewrites. Sized as 1–2 sessions per `UPGRADE/plans/tier-5-agent-prompts.md` Out-of-scope section. Companion candidate: wire the `fixer→updateFindingStatus` parser path that Tier 5's 5.5 confirmed doesn't exist.
2. **Promote a carry-forward item** — see `STATE.md` "In-flight work" + the carry-forward list below.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Carry-forward at arc-end** (none load-bearing, none gating any current work):

- **`fixer→updateFindingStatus` parser path** — Tier 6 companion to skills review; would give the operator/CLI a real "mark FIXED" verb without manual `findings.json` edits.
- **U005 chat 120s timeout re-tier** — affects channel-chat UX directly; "Tier 2 or 4" resolution text is now stale.
- **§6.4 ONBOARDING.md "SPA's polling fetch" reference** — chat.astro consumes SSE today; mildly stale, not load-bearing.
- **ADR 0027 §1 doesn't pin POST `/api/v1/projects`** — ADR-amend candidate; doc-debt only.
- **ADR 0002 footnote about `factory logs`** — supersede-with-new-ADR candidate; over-engineering for one footnote.
- **Pause primitive on directive detail** — defer-until-signal.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep; ~1 commit when authored.
- **Brain-side `log.line` forwarder** — selective pino-stream tap; ADR 0029 future-work.
- **Pre-3.5 baseline live-smoke chat-page click-test** — 30s click-test deferred during Phase 3.10 close.
- **Smoke residue:** `node-sse-smoke` + `smoke-demo` projects in workspace.
- **Filter-form Apply buttons + "Clear all defaults"** — absorbed by deferred PageShell migration.
- **Inline `style=` attributes** scattered across web pages — same migration absorbs these.
- **Control framework 2.2.3 publish** at `G:\Projects\Small-Projects\Control` — operator owns the go.
- **`/session-end` skill structural fix** for the lag-by-1 — now **14 occurrences** with this phase-close commit. Two structural options unchanged.

**Tier 5 in retrospect:** clean execution of an audit-driven addendum to a "complete" arc. 8 work commits in one session + 1 phase-close commit. ~1100 lines added. All 4 `pnpm` gates green throughout. Pre-write homework saved 1–2 ADRs by confirming runtime contracts were already unambiguous. The "build new for factory5, don't port from factory2" directive held — every prompt cites current ADRs (0018, 0021, 0024, 0027, 0028, 0029) + skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) by name; no factory2 references in any prompt body. The audit pattern itself is reusable: post-arc audits will likely surface similar staleness in any future tier closure, so a periodic Tier-N+1 audit-driven cleanup is a defensible cadence.

---

## 2026-05-06 — Phase 4 (cli-completion) closed; **factory5 first-class upgrade arc complete**

`/phase-close` ran on the Phase 4 work. All nine sub-steps shipped (4.1 → 4.8 in this and the prior session, plus this 4.9 close). Tagged `phase-4-cli-completion-closed` (annotated) at `28c0188`. **No Phase 5 scaffolded — `phase-plan.md` defines only four phases (doc-sweep / channel-parity / web-ui / cli-completion); the upgrade arc is complete.** STATE.md transitions to "all phases complete".

**What shipped in Phase 4** (cumulative across sessions, summarized for the upgrade-side narrative):

- **4.1** — Verified `factory cancel <directive-id>` end-to-end against a live factoryd (Phase 2.4's plumbing already shipped). Live smoke confirmed the 4-code exit surface (0 OK / 1 generic / 2 not-found / 3 already-terminal) — more granular than the 3-code shape originally sketched in the tier-4 plan; matches `factory ui-token`'s shape. Tightened steps.md + tier-4 plan to the live 4-code surface.
- **4.2** — `factory budget set <project> --max-usd <n> [--max-steps <n>]`. New `packages/cli/src/commands/budget.ts` reusing `@factory5/wiki`'s `updateProjectMetadata` — same code path as the daemon's `PUT /api/v1/projects/:id/budget` route (ADR 0027). **Per-field merge** is the distinguishing CLI semantic: passing only `--max-steps` preserves an existing `maxUsd` (web UI's PUT remains full-document replacement; divergence intentional and called out in the README). 15 unit tests.
- **4.3** — `factory project list / show <name> / delete <name>`. Three pure handlers + Commander wiring. `list` enriches each registry row with on-disk language + most-recent build; `show` resolves a project ref (name-first / full-ULID-second; ambiguous names error) and pretty-prints registry + on-disk metadata + last build; `delete` defaults to non-destructive `y/N`-prompted unregister; `--force` skips the prompt; `--purge` adds a typed-name second confirm and `rm -rf`s the workspace dir (order: registry-first-then-rm so a failed rm leaves a clean registry). New `packages/state/src/queries/projects.ts:remove`. 22 unit tests via injectable `prompt` fn.
- **4.4** — `factory ask "<question>"`. Single-shot chat — mints one chat directive, awaits the brain's reply, prints, exits. `--json` emits `{ directive, reply, status[, directiveStatus] }`. Refactored chat.ts to extract `submitOneDirective` helper (mint + notify + reply-poll cycle) — chat REPL loops over the helper, ask calls it once. 7 tests via the notify-injection trick (the test's notify hook either enqueues an outbound row or flips the directive's status — avoids race conditions in the polling loop).
- **4.5** — Tab completion for bash / zsh / pwsh via `factory completion <shell>`. Static surface — 19 top-level commands + 7 nested groups. Single source of truth (`TOP_LEVEL_COMMANDS` + `NESTED_SUBCOMMANDS`) drives all three template generators. Dynamic completion (project names, directive ids) intentionally deferred — would require running `factory` inside the completion script. 9 unit tests pin the structural invariants.
- **4.6** — Rich `--help` examples on every command via `addHelpText('after', ...)`. Top-level `factory --help` `addHelpText('afterAll', ...)` points at `docs/WORKFLOWS.md`. New help-coverage gate at `packages/cli/src/help-coverage.test.ts` (2 tests) walks the Commander tree via `cmd.outputHelp()` with a captured writer (since `helpInformation()` alone misses event-driven addHelpText content). **Sonic-boom-on-help flush race fixed** in `apps/factory/src/main.ts` via argv-sniff: help/version paths skip the async logger init so synchronous `process.exit` doesn't lose the buffered transport bind.
- **4.7** — `packages/cli/README.md` refresh: five new rows in the subcommand table (cancel, ask, budget set, project, completion) + dedicated sections for each + a top-level Tab completion section with bash/zsh/pwsh install one-liners. Top-level intro now points at `docs/WORKFLOWS.md`.
- **4.8** — U018 / U019 / U020 / U021 moved Open → Resolved with full Resolution lines pointing at this arc's commits. Tier 4 ROADMAP rows already ticked in per-step work commits.
- **4.9** — `/phase-close` (this commit's structural close).

**ADRs decided in Phase 4:** none. Tier 4 plan flagged three likely candidates — each landed as a sane-default decision matching the plan; recorded inline in commit bodies (4.5 static-only completion; 4.3 default-non-destructive delete with `--force`/`--purge`; 4.4 JSON shape `{directive, reply, status[, directiveStatus]}`). The relative scarcity of new ADRs across the whole arc (only 0027 / 0028 / 0029, all in Phase 3) reflects how much the 0001-0026 prior corpus already pinned.

**Issues closed in Phase 4:** U018 (rich --help), U019 (tab completion), U020 (project commands), U021 (budget set). All moved Open → Resolved with full Resolution lines pointing at the per-step close commits.

**Test-count delta across Phase 4:** workspace 1080 → **1135 + 3 skipped** (+55 across the phase: +15 budget, +22 project, +7 ask, +9 completion, +2 help-coverage). CLI package alone: 78 → 133.

**Cumulative across the upgrade arc** (Tiers 1 → 4):

- **Twenty-three issues moved Open → Resolved** — Tier 1 (U001-U003, U014-U017); Tier 2 (U004, U011-U013, U023); Tier 3 (U006-U010, U022); Tier 4 (U018-U021). UPGRADE/ISSUES.md "Open" now contains only **U005** (`factory chat` REPL turn timeout 120s — out of upgrade-arc scope; sized as future Tier 2/4 follow-up if a demand signal surfaces).
- **Three new ADRs:** 0027 (web-ui-mutation-surface), 0028 (worker-sandbox-contract), 0029 (directive-stream-protocol — promoted past gated state at Phase 3 close).
- **Four operator surfaces at parity for the eight-intent vocabulary:** CLI, Discord, Telegram, web dashboard. Each can build / chat / status / spend / findings / resume / cancel / budget. Live SSE wiring on the web side; tab completion + rich `--help` on the CLI side.
- **One Astro component library** (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`, `<PageShell>`); all 10 web pages converted to use it; `el()` / `loadInto()` retired from `lib/api.ts`.
- **One shared chat protocol:** `command-handlers.ts` is the single dispatcher routing slash-prefixed reads (status / spend / findings) across Discord, Telegram, and web-chat — surfaces never drift.
- **`/phase-close` housekeeping (this commit)** at `28c0188`: U018-U021 already moved to Resolved in 4.8; ROADMAP already ticked per-step; steps.md `[x] 4.9`; STATE.md → "all phases complete"; journal entry; carry-forward "Deferred to Phase 5" section uses the `<item>` placeholder verbatim, so no carry-forward bullets get seeded into a non-existent Phase 5 README. Annotated tag `phase-4-cli-completion-closed` at the close commit.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli **133**, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. Total **1135 passing + 3 skipped**.)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- All four `pnpm` gates green at `/phase-close` verification.

**What's next:**

The upgrade arc is complete. Operator's options:

1. **Open a new arc** — author a fresh `UPGRADE/plans/tier-5-<name>.md`, add a Phase 5 row to `.control/architecture/phase-plan.md`, then scaffold `.control/phases/phase-5-<name>/{README.md,steps.md}` from `.control/templates/`.
2. **Promote a carry-forward item to a Tier-5+ ROADMAP entry** — see "Carry-forward" below; each ships as ~1 commit when authored.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Carry-forward at arc-end** (none load-bearing, none gating any current work):

- **Pause primitive on directive detail** — defer until a real workflow signal surfaces; cancel solved the primary "kill the build" pain. Two design options unchanged.
- **PageShell adoption + Dashboard `<style is:global>` migration** — 11-page sweep absorbing the unstyled "Clear all defaults" + 4× filter-form Apply buttons + inline-style audit. Self-contained ~1 commit.
- **Brain-side `log.line` forwarder** — selective pino-stream tap; ADR 0029 future-work item.
- **Chat-page click-test** — 30-second smoke; final piece of Phase 3.5's pre-existing baseline.
- **U005** — `factory chat` 120 s turn timeout (extend or replace with streaming).
- **Control framework 2.2.3 publish** at `G:\Projects\Small-Projects\Control` — operator owns the go.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift (now **11 occurrences**).

**Auto-mode session shape worth recording.** This session ran in auto mode after one initial "proceed" — three steps closed in sequence (4.7 README + 4.8 issues + /phase-close) including the destructive-feeling annotated tag. The runbook clarity made it safe: each step had explicit acceptance criteria, the gates were re-verified at the right boundaries, and the close commit's done-criteria check was 11/11 before tagging. The pattern works for end-of-arc steps where the cursor is mechanical; it would not have been right for any step that needed operator judgement (a new ADR, a UX call, a destructive cleanup). Documented for future arc finales.

---

## 2026-05-06 — Phase 3 (web-ui) closed; Phase 4 (cli-completion) kicked off

`/phase-close` ran on the Phase 3 work. All ten sub-steps shipped across the prior multi-session arc (3.1 → 3.10); 3.11 was `/phase-close` itself. Tagged `phase-3-web-ui-closed` (annotated) at the close commit. Phase 4 (cli-completion) scaffolded.

**What shipped in Phase 3** (cumulative across sessions, summarized for the upgrade-side narrative):

- **3.1 / 3.2** — SSE on `GET /api/v1/directives/:id/stream` (six event types, per-directive `DirectiveStreamHub` subscription map, 15 s `:keepalive` heartbeats, backfill burst on connect); `directives/detail.astro` consumes via `EventSource` with `?t=` token accommodation; polling fallback for SSE-stripped proxies. Pinned by ADR 0029.
- **3.3 / 3.4** — Astro component library (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`, `<PageShell>`); all 10 pages converted; `el()` and `loadInto()` retired from `lib/api.ts`. Slot-content CSS-scoping discovery captured in `apps/factory-web/src/components/README.md`.
- **3.5** — `/app/chat` page mirrors `factory chat` end-to-end against a real factoryd; new `POST /api/v1/chat/messages` route mints `intent=chat` directives; page subscribes to the same SSE stream for token-by-token reply rendering; slash-prefixed reads route through Phase 2's shared `command-handlers.ts` so Discord, Telegram, and web-chat never drift.
- **3.6** — Cancel button on directive detail page; `POST /api/v1/directives/:id/cancel` (SPA-namespace alias of Phase 2's CLI route, gated by `requireUiAuth`); operator clicks Cancel, daemon mutates `directives.status`, brain emits `directive.completed`, hub forwards to the open SSE client, FE re-renders within ~2 s end-to-end (live-smoke verified). Pause primitive deferred — operator workflow signal not yet present.
- **3.7** — `/app/projects/new` page mirrors `factory init <project>` for a single project; `wiki.createProject` extraction + `POST /api/v1/projects` daemon route; `apiV1CreateProjectRequestSchema` in `@factory5/ipc`. Live smoke against `node-sse-smoke` build also confirmed `finding.created` end-to-end (F001 emitted live by the assessor), closing ADR 0029's live-verification gap.
- **3.8** — Spend page charts: per-project sparkline (240×28 SVG, last 14 days, discrete segments + dots so zero-spend days render as visible gaps not connecting through zero) + 30-day stacked bar (720×180 SVG, native `<title>` tooltips, per-day invisible hover targets, deterministic-hue palette per `projectId` hash). New `spend.perDayPerProject(db, filter?)` rollup helper; +5 tests.
- **3.9** — Mobile-responsive nav: `<details>`-based hamburger drawer at ≤768px (zero JS, native a11y, 44×44 px tap target); `@media (max-width: 640px)` form-row stacking; `Table.astro` `.table-wrap` overflow-x for wide data tables. Plan-vs-steps.md numbering offset surfaced and documented (steps.md is the cursor).
- **3.10** — Explicit logout + connection-status pip in header: layout-level 30 s heartbeat on `/api/v1/status` drives a colored pip (green Connected / amber Reconnecting / red Disconnected/Signed out); theme-independent traffic-light colors; logged-out banner; stale-token (401) short-circuit names `factory ui-token` as the recovery command in the hover tooltip. The 401 short-circuit was a follow-up fix surfaced in operator smoke — the lesson recorded was "error-class differentiation matters when recovery paths differ."

**ADRs decided in Phase 3:**

- **ADR 0027** — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`).
- **ADR 0028** — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn).
- **ADR 0029** — directive-stream-protocol — promoted past gated state at this `/phase-close` (Live verification table now ✅ for all six event types; unit-test-only carve-out retired).

**Issues closed at /phase-close:** U006 (no live updates), U007 (no chat surface), U008 (DOM-builder pattern), U009 (no mobile design), U010 (sessionStorage UX), U022 (`el()` setAttribute escaping). All moved from Open to Resolved with full Resolution lines pointing at the per-step close commits.

**Test-count delta across Phase 3:** workspace 1063 → 1080 + 3 skipped (+17 cumulative; +5 in 3.7's wiki + daemon, +5 in 3.8's `perDayPerProject` state coverage; the rest from 3.1-3.6's per-step adds; 3.9 + 3.10 were layout-only with zero test deltas).

**`/phase-close` housekeeping (this commit):**

- Six issues moved Open → Resolved in `UPGRADE/ISSUES.md`.
- ADR 0029 amended: Live verification table updated, `finding.created` caveat paragraph removed, Negative-consequence bullet removed, Implementation-status future-work list trimmed.
- Phase 3 README's `## ADRs decided in this phase` populated (0027 / 0028 / 0029); `## Deferred to Phase 4 (or later)` populated with three carry-forward items (Pause primitive; PageShell + `<style is:global>` migration; brain-side `log.line` forwarder).
- Phase 3 `steps.md` 3.11 → `[x]`.
- Phase 4 scaffolded at `.control/phases/phase-4-cli-completion/{README.md,steps.md}` from templates + `phase-plan.md` Phase 4 entry + `tier-4-cli-completion.md` plan; carry-forward block auto-seeded into Phase 4 README's `## Why this phase exists`.
- STATE.md → Phase 4, step 4.1.
- Tier 3 ROADMAP boxes were already fully ticked through step-3.10 close — no remaining work.
- Annotated tag `phase-3-web-ui-closed` at the close commit.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 78, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. Total **1080 passing + 3 skipped**.)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- `apps/factory-web` builds clean.
- All four `pnpm` gates green at `/phase-close` verification.

**What's next (Phase 4):**

1. **Operator pre-kickoff edits to Phase 4 README** — fill `## Where we were, end of Phase 3` (terse summary of the 10-step Phase 3 arc) and the operator-motivation paragraph in `## Why this phase exists` (above the auto-seeded carry-forward block).
2. **Step 4.1** — Verify `factory cancel <directive-id>` end-to-end. Phase 2's plumbing already shipped; this is a smoke-only verification commit (or a small fix if needed).
3. **Step 4.2** — `factory budget set <project>` (the first feature step). Reuses `packages/wiki/src/project-metadata.ts`; same code path as the web UI's `PUT /api/v1/projects/:id/budget`.

Phase 4 estimate: ~1 session. Most of the heavy lifting (cancel plumbing) shipped in Tier 2; Phase 4 is feature-completion + polish.

**Carry-forward items captured in the new Phase 4 README's `## Why this phase exists`** (none block any 4.x step):

- Pause primitive on directive detail (defer-until-signal).
- PageShell adoption + Dashboard `<style is:global>` migration (1-commit sweep, available any time).
- Brain-side `log.line` forwarder (ADR 0029 future-work item).

**Other carry-forward not specifically deferred from Phase 3:**

- Pre-3.5 baseline live-smoke (chat-page click-test) — Phase 3's chat page passes its 3.5 unit + integration coverage and ADR 0029's live-verification is closed, so this is no longer a Phase 3 acceptance gate. Natural fit during Phase 4 if the operator wants a visual check while testing CLI commands.
- Smoke residue cleanup — Phase 4's `factory project delete --purge` (step 4.3) will be the right tool once it ships.
- `/session-end` skill structural fix for the "Last commit" lag-by-1 drift (8 occurrences).
- Control framework repo 2.2.3 publish (operator's go).

---

## 2026-05-05 — Phase 3 step 3.7 code-complete (createProject extraction → POST route → /app/projects/new page)

Step 3.7 ships its three code commits this session, plus a session-start drift reconcile. The `/app/projects/new` page closes the SPA's last hand-rolled-in-CLI gap from ADR 0027 §3.7 — operators can scaffold a project from the dashboard end-to-end without a terminal. Behaviour-preserving for `factory init <name>` (CLI thin-wrapped over the same `wiki.createProject` extraction).

**Commits (4 in this session, post-`1c6eeaf`):**

- `317d94b` `docs(state): reconcile STATE.md last-commit pointer to current HEAD` (sixth occurrence of the post-session-end self-reference drift after `cce7065` / `db61baf` / `54c0f20` / `d7a366c` / `288603e`; STATE.md "Last commit" caught up from `79474b1` (ADR 0029) to `1c6eeaf` (prior session-end docs); same `288603e`-shape — accepts the steady-state lag-by-1 the runbook documents).
- `d118e1c` `refactor(3.7): extract createProject into @factory5/wiki` — new `wiki.createProject({projectPath, name, language, claudeMd?}) → {id, path, claudeMdPath}` containing `runProjectInit`'s body (refuse-overwrite + mkdir + writeFile + loadOrCreateProjectMetadata); new `CreateProjectAlreadyExistsError` with reason union for CLI exit-2 / daemon 409 fan-out; `scaffoldClaudeMd` relocated to wiki (single source of truth); CLI's `runProjectInit` thin-wrapper rewrite (~30 LOC); init.test.ts deleted, its 4 scaffold tests reproduced in wiki + 6 new createProject tests added. Wiki 64 → 74, CLI 82 → 78.
- `50e8b33` `feat(3.7): POST /api/v1/projects route + schemas` — `apiV1CreateProject{Request,Response}Schema` in `@factory5/ipc`; daemon route gated by `requireUiAuth` mirrors the 3.6 cancel-route auth pattern; pipeline parses → joins workspace + name → wiki.createProject (maps already-exists → 409) → upserts registry row; new `IpcServerOptions.workspace?` opt for test override + future config-driven prod use; +6 route tests covering 401/503/400-missing-name/400-bad-language/happy-path/409-already-exists. Daemon 167 → 173.
- `53e4e98` `feat(3.7): /app/projects/new page` — `apps/factory-web/src/pages/projects/new.astro` modeled on `build.astro`'s `<Form>+<Field>+<Submit>` shape; fields are name (required) + language (required, python default) + optional CLAUDE.md textarea; on 200 redirects to `/app/projects/detail?id=<id>`; hidden-`<Alert>`-placeholder pattern surfaces inline errors (ALREADY_EXISTS / SCHEMA_VALIDATION_FAILED / UI_AUTH_REQUIRED / UI_DISABLED). `+ New project` affordance added to `projects/index.astro`; empty-state copy updated. Frontend-design skill invoked per saved feedback. Top nav left at 8 items intentionally — `+ New project` on the projects list page covers discoverability without crowding the global nav (intentional deviation from plan's nav-link recommendation, in the lighter direction).

**Design discoveries (recorded in this session's commit bodies + STATE.md notes):**

- **Daemon route cleanly accepts a test-override workspace.** `IpcServerOptions.workspace?` enables tests to scope filesystem side effects via `mkdtemp`. Production factoryd doesn't currently pass it (POST /api/v1/builds has the same gap — `defaultWorkspace()` direct call); the wiring of `cfg.general.workspace` through to IpcServerOptions can land any time and would be picked up by both routes simultaneously. Filed as deferred prod-config wiring; not blocking any 3.x step.
- **The CLI's existing absolute / relative / workspace-rooted path resolution is CLI-only.** The daemon route doesn't honour absolute / relative paths in `name` — operators on the web flow trust the daemon's workspace config and can't sidestep it. Documented in the request schema's TSDoc.
- **`readProjectMetadata` swallow-corruption-as-undefined is preserved in the wiki API.** `runProjectInit`'s `.catch(() => undefined)` semantics carry into `wiki.createProject` for behaviour parity. The `ProjectMetadataCorruptError` then re-surfaces from `loadOrCreateProjectMetadata` further down — slightly different error path but operator-equivalent. Tightening this is filed as latent ergonomic work.

**Decisions / judgement calls during 3.7 worth recording (no new ADR):**

- **Budget fields excluded from `apiV1CreateProjectRequestSchema`.** The plan speculatively included `maxUsd?` / `maxSteps?`; on closer read, the existing `PUT /api/v1/projects/:id/budget` route is the canonical surface for budget defaults (it has full RFC-9110 PUT semantics already). Keeping create minimal mirrors the CLI's two-step flow (`factory init` then `factory build --max-usd …`) and reduces test surface for this commit. Operators can chain create-then-set-budget client-side if a one-form UX wins later.
- **No nav link addition for `/app/projects/new`.** Plan recommended adding "New project" between "Projects" and "Build" in the dashboard nav. On reflection, that would push to 9 nav items (already 8) and a creation flow is contextually accessed from the projects list — the `+ New project` affordance on `projects/index.astro` plus the deep-link from the empty-state alert covers discoverability without nav clutter. Lighter direction.
- **3.7 close commit deferred** (matches the multi-commit-step pattern set by `dfd1a07` (3.4 close) and `0f5775a` (3.6 close)). The `- [ ] 3.7` checkbox flip + ROADMAP tick land in a separate `refactor(3.7): close step 3.7` commit alongside the live-smoke acceptance — keeps the close commit's diff aligned with the acceptance evidence.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 152, channels 175, daemon **173**, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki **74**, cli **78**, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. Total **1075 passing**, +12 from 1063 baseline.)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- Phase 3 progress: 3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 3.6 closed; 3.7 code-complete (steps.md checkbox not yet flipped); 3.8 / 3.9 / 3.10 / 3.11 still open. Phase 3 tag (`phase-3-web-ui-closed`) goes on at step 3.11 after acceptance.

**What's next:**

1. **Live-smoke step 3.7** against a restarted factoryd (the long-running daemon on `127.0.0.1:25295` is the pre-3.7 build and 404s the new POST /api/v1/projects route — confirmed via curl). `factory daemon stop && factory daemon start` to pick up commit (b)'s route. Open `/app/projects/new`, submit a real project (recommend a non-trivial one that produces verifier findings — the prior session's `add(a, b)` smoke produced none, missing the `finding.created` live-verification gap pinned in ADR 0029). Verify scaffolded files + redirect + project visibility at `/app/projects/`. Kick a build at `/app/build`; watch `directives/detail` SSE for `finding.created` events.
2. **Close commit** `refactor(3.7): close step 3.7` flips `- [ ] 3.7` → `- [x] 3.7` in `phase-3-web-ui/steps.md` and ticks the matching item in `UPGRADE/ROADMAP.md`. Same shape as `dfd1a07` / `0f5775a`.
3. **Step 3.8** — Spend page charts (sparkline per project + 30-day stacked bar, vanilla SVG) per `plans/tier-3-web-ui-live-and-complete.md` §3.8.

Carry-forward bugs / cleanup (not blocking 3.7 close or 3.8): Submit-button-invisible `.btn-primary { color: Canvas }` will repro on the new form (one-line CSS or fold into the `<style is:global>` migration follow-up); Control framework repo uncommitted edits at `G:\Projects\Small-Projects\Control` (operator's go for 2.2.3 publish); smoke residue cleanup from prior session.

---

## 2026-05-03 — Phase 3 step 3.4 closed (all 10 pages → component library; el() retired)

Step 3.4 shipped this session run — the longest sub-step in Phase 3. Every page in `apps/factory-web/src/pages/` now consumes the Astro component library shipped in 3.3 (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`); `el()` and `loadInto()` retired from `lib/api.ts`. Tier 3 ROADMAP item flipped.

**Commits (8 in this session, post-`4466078`):**

- `54c0f20` `docs(state): reconcile STATE.md last-commit pointer to current HEAD` (third occurrence of the post-session-end self-reference drift; first attempt to self-reference via `git commit --amend` reproduced the drift because amend changes the SHA — soft-reset and recommitted following the established `db61baf` shape that points "Last commit" at the session-end commit and the "State reconcile" entry at the prior reconcile)
- `32bdfb6` `refactor(3.4): convert index.astro to <Card> components` (introduces the `id?` extension on Card for the runtime-fetch placeholder pattern)
- `d55c41d` `refactor(3.4): convert findings list page to <Table>; extend Table with id?/loading?` (Table extension: `loading={true}` renders chrome + colspan'd "Loading…" row instead of falling through to the empty-message branch — realises the components/README.md's "render with `rows={[]}` server-side and append `<tr>` rows from the script" pattern that Table couldn't actually do pre-3.4)
- `a876608` `refactor(3.4): convert projects/questions/spend list pages to <Table> + <Alert>` (projects empty-state hits dedicated `<Alert kind="info">` per migration map; spend page's four sub-tables share a per-page `fillTable<T>` helper)
- `e849aa7` `refactor(3.4): convert directives list + project/question detail pages` (introduces the hidden-Alert-placeholder pattern for dynamic conflict/success swapping; conditional answer-form-wrapper for questions/detail)
- `58d4584` `refactor(3.4): convert build.astro to <Form> + <Field> + <Submit>` (the primary form use case; project select `options={[]}` server-side + script appends one `<option>` per fetched project + rewrites the placeholder hint)
- `a405556` `refactor(3.4): inline el() helper into directives/detail.astro` (the live SSE render path's per-page DOM helper exception per the migration map's "or a per-page helper if the page genuinely needs a wrapper" clause)
- `dfd1a07` `refactor(3.4): retire el() + loadInto() from lib/api.ts; close step 3.4` (flips `[ ] 3.4` → `[x] 3.4` in steps.md and ROADMAP.md; documents the Dashboard-CSS scoping discovery and the deferred PageShell decision in components/README.md)

**Design discoveries (recorded in `apps/factory-web/src/components/README.md`):**

- **Astro scoped CSS does not propagate to slot content.** Dashboard's class-based rules (`.cards`, `.card`, `.empty`, `.err`, `.btn*`, `.alert*`, `.form-*`, `table`/`th`/`td`) survive 3.4 intentionally — they only ever matched elements rendered directly inside Dashboard's own template (the `<header class="shell">` chrome and inner `<h2>`), so they were already inert for slot content. Pruning would not visually regress anything; leaving them in place keeps the door open for a future `<style is:global>` adoption that would let the layout actually style slot-level elements without per-page repetition.
- **`<PageShell>` adoption deferred.** Optional structural sugar; not required by §3.4 acceptance. Wiring it across all 10 pages couples to removing Dashboard's inner `<h2>` (otherwise pages get double `<h2>`s), which would land cleanest in the same focused follow-up step that adopts `<style is:global>` for the Dashboard primitives. Filed as 3.x backlog.
- **`<Card>` and `<Table>` `id?` / `loading?` extensions** were the load-bearing pattern for runtime-fetched data. Server-render with placeholder values + stable `id`; script populates inner cells (`#card-X .value`) or replaces tbody (`#tbl-X tbody`) on `apiFetch` resolution. Empty results from the fetch render a single colspan'd `<tr><td class="empty">` row inside the table so column headers stay visible. Both extensions are non-breaking and documented in components/README.md alongside their static-data counterparts.

**Decisions / judgement calls during 3.4 worth recording (no new ADR):**

- **Filter forms (`<form class="filter-form">`)** stay as inline HTML — they're a horizontal toolbar, not the heavy `<Form>` grid layout. Per the migration map, only `<form class="form">` converts to `<Form>` + `<Field>`.
- **Hidden-Alert-placeholder pattern** for dynamic alerts (conflict/success swapping inside detail pages and the build form): server-render a `<Alert>` with empty `title=""` `body=""` inside a `<div hidden>`; the script reveals via `hidden=false` and writes textContent into the inner `<h4>`/`<p>`. Avoids dynamic class manipulation (which wouldn't pick up Astro's scoped `.alert--conflict[data-astro-cid-X]` selector anyway) and keeps the script free of `<div class="alert alert--conflict">` building.
- **`<Submit>` is type=submit by design.** The projects/detail "Clear all defaults" button stays a raw `<button type="button" class="btn btn-danger">` because it has its own click handler distinct from form submit. Dashboard's global `.btn*` rules survive the prune partly because of this — though see the scoping discovery above; the rules are nominally "global" but in practice scoped, so the visual fate of raw buttons is one of the questions the future `<style is:global>` follow-up answers.
- **`loadInto()` retirement** (not in the migration map; called out here because it was unused after the conversion). The new pattern is direct `apiFetch` + `then`/`catch` with a server-rendered `<p id="error" class="err" hidden>` region above the content; `loadInto` no longer fit because it expected a single mount element to wipe and refill, and the new pages have a distributed mount (table tbody + error region + count paragraph + form fields).

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 152, channels 175, daemon 152, brain 93, worker 38, worker-sandbox 86+3 skipped, assessor 79, wiki 64, cli 82, providers 39, ipc 28, events 3 — baseline holds; 3.4 added zero test files)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- Phase 3 progress: 3.1 / 3.2 / 3.3 / 3.4 closed; 3.5 / 3.6 / 3.7 / 3.8 / 3.9 / 3.10 still open. Phase 3 tag (`phase-3-web-ui-closed`) goes on at step 3.11 once acceptance criteria for the remaining steps are met.

**What's next:**

Step **3.5** = `/app/chat` page (browser mirror of `factory chat`) per [`plans/tier-3-web-ui-live-and-complete.md`](plans/tier-3-web-ui-live-and-complete.md) §3.5. Three new surfaces: `apps/factory-web/src/pages/chat.astro` (history + composer + markdown-rendered replies + auto-scroll-with-pause); `POST /api/v1/chat/messages` route in `packages/daemon/src/server.ts` minting an `intent=chat` directive whose SSE stream the page subscribes to; request/response shapes in `packages/ipc/src/schemas.ts`. Reuses Phase 2's `command-handlers.ts` for the optional `/cmd` shortcut path (web-typed `/status` / `/spend` / `/findings` hit the same handler set Discord/Telegram chat does). Carries the Step 2.6 `factory chat` per-turn timeout fix implicitly (streaming partial daemon-side progress eliminates the 120 s false-timeout for chat the same way it did for builds in 3.2).

Pre-requisite: the deferred `log.line` brain emission from Step 3.1 needs to land for 3.5 to render replies (one bubble per agent message). Either pin as part of 3.5's scope or a 3.5-prerequisite mini-step.

---

## 2026-05-03 — Phase 2 (channel-parity) closed; Phase 3 (web-ui) kicked off

Phase 2 shipped end-to-end this session run. Steps 2.3 (pending-question button affordances), 2.4 (`factory cancel` kills workers), 2.5 (8-intent triage + channel re-routing) all landed; 2.6 deferred to Phase 3 (folded into the SSE work). Plus an out-of-step fix that caught a UX gap once channels went live: `/status` output across CLI, Discord, and Telegram now includes a project column so operators can tell which directive belongs to which project.

**Live-smoke run (this session):**

- Discord `/factory status / spend / findings` — embeds render correctly with new project column.
- Telegram `/status / spend / findings` — HTML replies render correctly with new project column.
- Discord chat re-routing — `@Factory what's running right now?` classifies as `intent=status` (confidence 0.98), dispatches to status command. Message-handler gate (require @-mention or in-thread) is correct Discord etiquette and does not block phase close.
- Telegram chat re-routing — free-form text in private chat classifies as `intent=status` (confidence 0.98), dispatches to status command.
- `factory cancel` IPC route paths (NOT_FOUND 404 / ALREADY_TERMINAL 409 / OK 200) verified via synthetic running-directive in DB; CLI exit codes 0/2/3 verified end-to-end.
- Discord registers `/factory` slash guild-scoped at `1495163534433325171` (bot `Factory#5957`).
- Telegram registers `setMyCommands` with 7 entries (bot `Factory5_bot`).
- Build/test/lint/format all green.

**Skipped (intentionally — no live build available):**

- Pending-question button affordances live-smoke. Covered by 18 Discord + 19 Telegram unit tests.
- `factory cancel` killing a real worker subprocess. Covered by 30 unit tests across pool / registry / state / daemon / CLI.

**Issues closed:** U004, U011, U012, U013, U023.

**Notable artifacts produced:**

- Tag `phase-2-channel-parity-closed` (annotated, on `081b832`) with full shipping summary.
- Phase 3 scaffold: `.control/phases/phase-3-web-ui/{README.md, steps.md}`. Carry-forward for Step 2.6 lands in Phase 3's "Why this phase exists" section.
- Phase 2's `command-handlers.ts` is the cross-surface reuse anchor — Phase 3's `/app/chat` page can call into it for read-side dispatch.

**Decisions / judgement calls during Phase 2 worth recording (no new ADR):**

- `OutboundMessage.metadata.questionId` (option A) chosen over inferred lookup by directiveId (option B) for Step 2.3 — explicit signal beats inferred.
- Per-directive `AbortController` registry in `packages/brain/src/cancellation.ts` for Step 2.4 — bridges parent abort + operator cancel into a single combined signal.
- SIGTERM-then-SIGKILL with 5 s grace via `softKill` helper (Step 2.4) — preferable to immediate SIGKILL for clean Claude subprocess shutdown.
- Intent enum kept at 8 (not extended) — avoids a SQLite CHECK-constraint migration; channel-side keyword sub-router picks spend vs findings within `intent=status`.

**What's next:**

Phase 3 (web-ui). Step 3.1 = SSE on `/api/v1/directives/:id/stream` per [`plans/tier-3-web-ui-live-and-complete.md`](plans/tier-3-web-ui-live-and-complete.md) §3.1. Carries the 2.6 streaming benefit for `factory chat` along with it.

---

## 2026-05-02 — Tier 2 session 2a — Discord slash + Telegram setMyCommands

Closed Phase 2 steps 2.1 and 2.2 — the "structural" half of channel parity. Both Discord and Telegram now expose the brain's eight-intent vocabulary as a native chat surface (slash commands on Discord, `/` autocomplete + `/<cmd>` parser on Telegram); the two transports dispatch through a shared `command-handlers.ts` so future tweaks land in one place.

**Commits this session:**

- `8ea8e4a` feat(2.1): wire Discord slash commands
- `22e0e54` feat(2.2): wire Telegram setMyCommands + extract command-handlers.ts
- `(this commit)` docs(state): session end for step 2.2

**Decisions (judgement calls; no ADRs):**

- **`setProjectBudget` as a `ChannelContext` callback** (not a `@factory5/wiki` import in `@factory5/channels`). Symmetry with `resolveProjectPath` / `resolveBuildLimits`; daemon binds the callback over `wiki.updateProjectMetadata`. Channel plugins stay free of wiki coupling. `SetProjectBudgetError` sentinel with stable codes (`NOT_FOUND` / `AMBIGUOUS` / `PATH_UNREADABLE` / `METADATA_CORRUPT`) so handlers return structured failures rather than throwing.
- **Cancel for 2.1 = `markBlocked`-only.** Step 2.4 will swap in real `AbortController` plumbing + worker SIGTERM/SIGKILL discipline. The slash-command UX-message explicitly notes "2.1 marks the row blocked. Step 2.4 will additionally kill running workers within 10 s." so an operator running a long build during the gap window isn't surprised.
- **Telegram `/build` migrated to the shared `runBuild` handler** (i.e. the legacy `parseBuildPayload` is gone). The directive shape is preserved (project + spec + projectPath + language + limits) — just `payload.text` is dropped (no consumer reads it; one roundtrip-test assertion updated). Unifies the message-driven `/build` path with the `command-handlers.ts` contract.
- **`buildPrefix` config** preserved in the schema for backward compat but no longer load-bearing. Operators who customised it (e.g. `buildPrefix = '!build'`) lose that customisation; canonical trigger is `/build` going forward. Documented in the schema comment.
- **Telegram reply formatting:** HTML mode with `<pre>` blocks for tabular reads (`status` / `spend` / `findings`); plain text for state-changing commands (`build` / `resume` / `cancel` / `budget`). Avoids MarkdownV2's escape-character footgun.
- **Slash-command channelRef shape** for Discord (`discord-slash-<timestamp>`) is acknowledged as not routable for brain outbound replies — known gap, mostly cosmetic for 2.1's confirmation-only UX. Telegram-side uses the existing `<chatId>#<messageId>` shape and reaches the user normally. Revisit when 2.3 lands button affordances and the brain might want to send progress updates back.
- **`payload.text` on chat directives stays.** Only build directives drop it (the brain's chat-intent flow does read `payload.text`).

**Minor fixes:** `.claude/hooks/regenerate-next-md.ps1` UTF-8 round-trip fix landed during the 2.2-2.3 idle window — `Get-Content -Encoding utf8` + `WriteAllText` with a no-BOM `UTF8Encoding $false`. The mojibake on em-dashes (`—` → `â€"`) and section signs (`§` → `Â§`) that the prior session-end worked around manually is now fixed at source.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (938 passed, 3 skipped — Windows/Linux-only worker-sandbox branches; channels package: 103/103)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- Phase 2 progress: 2.1 + 2.2 closed; 2.3 / 2.4 / 2.5 still open. Phase 2 tag (`phase-2-channel-parity-closed`) goes on at step 2.7 once live-smoke acceptance is met.

**Next session pointer:**

- Step **2.3** = pending-question button affordances on Discord + Telegram. Discord: `ActionRowBuilder` with Answer / Skip / Escalate buttons; Answer opens a `ModalBuilder`. Telegram: inline keyboard via `reply_markup`; poll loop expanded to handle `callback_query` updates. Outbound message schema needs a `metadata: { questionId }` field so the channel `send()` can decide to attach buttons. Existing thread-reply / reply-to-bot path stays as the fallback.
- Sessions remaining for Phase 2: 2.3 (this) + a session for 2.4 + 2.5 + phase-close.

---

## 2026-05-02 — Tier 1 (doc-sweep) shipped end-to-end; Tier 2 scaffolded

Closed Tier 1 in a single session. All seven Tier-1 issues (U001-U003 stale READMEs, U014-U015 missing onboarding sections, U016 missing workflows doc, U017 missing CLAUDE.md authoring guide) resolved. Tier 2 (channel parity) scaffolded under `.control/phases/phase-2-channel-parity/`; ready to begin step 2.1 (Discord slash commands) next session.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (876 passed, 3 skipped — Windows/Linux-only worker-sandbox branches)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- 16 issues remain Open across Tiers 2-4

**Recent commits on `main` leading into and through this session:**

- `1384ae8` — `chore(phase-1): close phase 1, kick off phase 2` (tag `phase-1-doc-sweep-closed` on `10e400a`)
- `10e400a` — `docs(1.8): tier-1 acceptance prep — mark U001-003/U014-017 resolved + fix orphan factory-inspect ref`
- `e75b5dd` — `docs(1.7): reconcile SKILLS.md + AGENTS.md against current code`
- `b813037` — `docs(1.6): write docs/WORKFLOWS.md — four canonical loops + decision matrix + CLAUDE.md authoring guide`
- `010843b` — `docs(1.5): add §"Chat — CLI / Discord / Telegram" to ONBOARDING.md`
- `0ffdd8d` — `docs(1.4): add §"Web dashboard" to ONBOARDING.md`
- `30293ff` — `docs(1.3): refresh apps/factory-web/README.md — drop phase-number scaffolding, add page index`
- `c53f8d9` — `docs(1.2): refresh packages/channels/README.md — Telegram and web no longer "future"`
- `d33635a` — `docs(1.1): refresh packages/cli/README.md — drop Phase column, add spend/findings/questions cleanup`
- `91541a9` — `docs(state): reconcile STATE.md + Phase 1 README to actual git state`

**Decisions made this session:**

- Section renumbering in `docs/ONBOARDING.md` (Web-dashboard insertion at §5 + Chat insertion at §6 each bumped subsequent sections by +1) handled with a full Write rather than ~20 surgical Edits — cleaner to read and verify.
- `WORKFLOWS.md` cross-referenced from all four anchor docs (README, CLAUDE, ARCHITECTURE, ONBOARDING), exceeding the Phase 1 done-criterion's 3-doc threshold.
- The query-string-`detail.astro` convention in `apps/factory-web` documented as a deliberate choice (not a TODO) — keeps prod build static so `@fastify/static` mounts without route-rewrite logic.
- `factory inspect` permanently retired from `packages/cli/README.md` and `packages/logger/README.md` (was never shipped, isn't on any tier roadmap). `factory push` permanently retired per ADR 0019.
- Phase tag set on the last work commit (`10e400a`), not on the close commit (`1384ae8`) — tag marks where Phase 1 ends, close commit is administrative.

**What's next:**

Pick **Tier 2 step 2.1** — wire Discord slash commands per [`plans/tier-2-channel-parity.md`](plans/tier-2-channel-parity.md) §2.1. New file `packages/channels/src/discord-commands.ts`; edit `packages/channels/src/discord.ts` to call `client.application.commands.set()` on `Events.ClientReady` and register an `interactionCreate` listener. Embed-formatted responses; **no LLM** for read commands (`status`/`spend`/`findings`).

Phase 2 is the first phase that touches code — confirm Discord + Telegram test bots are configured (`factory doctor`) before starting. Tier-2 plan recommends splitting into 2a (steps 2.1-2.3, slash commands + buttons) and 2b (steps 2.4-2.5, `factory cancel` + 8-intent triage).

---

## 2026-05-02 — Audit + roadmap captured

Frozen the audit and the four-tier upgrade roadmap into this `UPGRADE/` directory. No code changes this session beyond the doc cleanup commits below; the roadmap is the deliverable.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (876 passed, 3 skipped)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- 15 packages, 3 apps, 28 ADRs, ~35.6k LOC of source

**Recent commits on `main` leading into this session:**

- `de17274` — `docs: consolidate to single ARCHITECTURE.md, drop build journal and resolved-issue tracker`
- `f6fb28c` — `chore: remove Control framework workflow`
- `fe5f770` — `chore(phase-15): close phase 15 still-quiet (no sub-steps shipped)` (last pre-cleanup commit)

**Decisions made this session:**

- Keep `docs/decisions/` (ADRs are load-bearing, cited from 150+ inline source comments).
- Removed `docs/issues/` (all 15 RESOLVED; bug-history is in git; design implications are captured in ADRs). Upgrade-time issues now live in [`ISSUES.md`](ISSUES.md).
- This `UPGRADE/` directory is not a Control-framework recreation — no hooks, no auto-snapshots, no slash commands. Just a workspace.
- Tier order: docs → channel parity → web UI → CLI completion. See [`ROADMAP.md`](ROADMAP.md).

**What's next:**

Pick **Tier 1** — the doc sweep. See [`plans/tier-1-doc-sweep.md`](plans/tier-1-doc-sweep.md). It's the shortest, least controversial, and the doc fixes will be cited from later tiers (especially Tier 2's channel responses, which should link to `docs/WORKFLOWS.md`).
