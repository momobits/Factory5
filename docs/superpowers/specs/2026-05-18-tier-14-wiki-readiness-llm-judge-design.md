# Tier 14 — Wiki-readiness LLM judge design

**Status:** Draft (pending operator review before plan-write)
**Author:** Brainstorming session 2026-05-18
**Replaces:** `packages/wiki/src/readiness.ts`'s regex-based `wikiReadiness()` gate

---

## 1. Context

Today every build runs a regex-based wiki-readiness gate after the architect stage (`packages/wiki/src/readiness.ts`, called from `packages/brain/src/architect.ts:250`). Four checks: `overview-exists`, `modules-documented`, `testing-documented`, `minimum-content`. On failure the brain logs `wiki readiness: failed (<checks>) — continuing per Phase 1 policy` and proceeds to the planner (advisory, not blocking).

The `modules-documented` check fires on most projects because its regex is over-literal: it requires either a `modules/` subdirectory of wiki pages OR a literal `\n## Modules` H2 header. The architect (Opus) frequently produces `# Modules` H1, `## Components`, scattered headings, or other shapes that the regex misses. The Phase 11 retrospective characterized the warn as "Opus non-determinism, not a load-bearing gate bug" and parked a fix as a carry-forward.

Operator-felt problem: the warn fires on most projects, creating noise that operators learn to ignore. When the warn IS load-bearing (genuinely thin wiki) the noise mixes it into the chaff. The advisory contract is right in principle; the regex implementation is wrong in practice.

## 2. Decision summary

Tier 14 replaces the regex checks with an LLM judge that evaluates the wiki against the directive's intent + the project's CLAUDE.md + the wiki pages. The judge produces a structured critique. On failure the architect re-runs with the critique as feedback. Up to N attempts (default 3, operator-configurable); on exhaustion the brain files an `askUser` for operator decision.

The architect's default model category flips from `reasoning` (Opus) to `planning` (Sonnet) as part of the change. The critic defaults to `reasoning` (Opus). Both are configurable via a new `[agents.*]` table in `.factory/config.toml`.

| Choice               | Resolution                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Judge contract       | Directive-intent broad: "does this wiki satisfy what the operator asked for"                                         |
| Judge output         | Rich critique: `{passes, severity, findings[], summary}`                                                             |
| Retry feedback       | Critique-only; architect rewrites                                                                                    |
| Budget axis          | `maxWikiReadinessAttempts` count, default 3 — 8th `BUDGET_DEFAULTS` axis                                             |
| Exhaustion           | `askUser` with `[continue/abort/extend-N]`; auto-answer defaults to `continue`                                       |
| Existing regex       | Removed entirely; `wikiReadiness` deleted                                                                            |
| Models               | Architect → `planning` (Sonnet, was `reasoning`); critic → `reasoning` (Opus); both overridable via `[agents.*]`     |
| Agent role           | New generic `critic` role added to `AGENT_ROLES`                                                                     |
| Implementation shape | Wrapper module `architect-loop.ts` orchestrates; `runArchitect` and `runWikiCritic` stay sharp single-pass functions |

**Intentional scope expansion:** flipping the architect's default category from Opus to Sonnet changes existing behavior across all builds (cheaper, faster architect; planner reads whatever Sonnet writes). Defensible: cheap fast author + thorough expensive critic can net lower spend than today's expensive author with no critic. Called out here so the change is a known intentional outcome of Tier 14, not a side effect. Operators can flip it back via `[agents].architect = "reasoning"` in their config.

## 3. Architecture

### 3.1 New modules

- **`packages/brain/src/critic.ts`** (~180 lines). `runWikiCritic({ registry, projectPath, directiveBody, claudeMd, pages, db?, directiveId?, emit? })`. Single LLM call against the resolved `critic` agent category (Opus by default). Reads the directive body, the project's CLAUDE.md, and all wiki pages on disk; returns a `WikiCritique`. No retry logic — that's the wrapper's job. Emits `brain.critic` log lines per ADR 0031.
- **`packages/brain/src/architect-loop.ts`** (~200 lines). `runArchitectWithCritique(opts)` orchestrates the architect→critic→architect retry loop. Owns the `maxWikiReadinessAttempts` budget check, the `askUser` exhaustion path, and per-iteration `emitLogLine` narration. Returns `ArchitectLoopResult { architectResult, critique, attempts, exhausted }`.

### 3.2 Modified modules

- **`packages/brain/src/architect.ts`** — `runArchitect` grows an optional `priorCritique?: WikiCritique` parameter. When present the user prompt gets a `--- PREVIOUS ATTEMPT FAILED ---` section appended carrying the summary + findings. Architect's category becomes a runtime-resolved value (was hardcoded `'reasoning'`) read via `resolveAgentCategory(config, 'architect')`.
- **`packages/brain/src/loop.ts`** — the `// -------- ARCHITECT --------` block at `loop.ts:262-296` swaps `runArchitect(...)` for `runArchitectWithCritique(...)`. The "skip when wiki already ready" check stays — on resume the critic shouldn't re-evaluate a wiki that already passed.
- **`packages/wiki/src/readiness.ts`** — `wikiReadiness()` and its four helpers deleted. `ReadinessCheck` / `ReadinessReport` types deleted (no deprecated aliases — anything still importing them is broken code worth surfacing).
- **`packages/core/src/constants.ts`** — `AGENT_ROLES` gains `'critic'` (10 roles total).
- **`packages/core/src/schemas.ts`** — adds `wikiCritiqueSchema` (and helpers); extends `budgetsSchema` with `maxWikiReadinessAttempts`.
- **`packages/core/src/budget-defaults.ts`** — `BUDGET_DEFAULTS` gains the 8th axis.
- **`packages/state/src/config.ts`** — adds `agentsConfigSchema` + `resolveAgentCategory` helper. Exports `DEFAULT_AGENT_CATEGORIES`.

### 3.3 Call graph

```
loop.ts::runServe
  └── runArchitectWithCritique  (NEW wrapper)
        ├── runArchitect(opts)                          ← writes wiki pages
        ├── runWikiCritic(opts)                         ← evaluates
        ├── [iterate up to maxWikiReadinessAttempts]
        │     ├── runArchitect(opts + priorCritique)
        │     └── runWikiCritic(opts)
        └── [on exhaustion] askUser([continue/abort/extend-N])
```

Mirrors Phase 12's `budget-escalation.ts` orchestration shape: one wrapper, two leaf calls, optional askUser path.

## 4. Data flow

### 4.1 Happy path (critic passes on attempt 1)

1. `loop.ts` calls `runArchitectWithCritique({...})` with directive, projectPath, limits, emit
2. Wrapper resolves `agents.architect` → `planning` (default) and calls `runArchitect(opts)`. Sonnet writes the wiki; `brain.architect` emits `wrote N pages`
3. Wrapper resolves `agents.critic` → `reasoning` (default) and calls `runWikiCritic({ projectPath, directiveBody, claudeMd, pages, ... })`. Opus reads everything; emits `brain.critic` log line `evaluating wiki (attempt 1/3)`; returns `WikiCritique { passes: true, severity: 'pass', findings: [], summary: '...' }`
4. Wrapper emits info-level `critic: passed on attempt 1 — '<summary>'`
5. Returns `{ architectResult, critique, attempts: 1, exhausted: false }` to `loop.ts`
6. Loop proceeds to planner — same code path as today

### 4.2 Retry path (critic fails on attempt 1, passes on attempt 2)

1. Steps 1-3 as above, but critique returns `passes: false, severity: 'major', findings: [...]`
2. Wrapper emits warn-level `critic: failed (major) on attempt 1 — <summary>` with findings in `attrs`
3. Wrapper checks `attempts (1) < maxWikiReadinessAttempts (3)` → continue
4. Wrapper calls `runArchitect(opts + { priorCritique: critique })`. Architect re-runs; user prompt contains the appended `PREVIOUS ATTEMPT FAILED` block; rewrites all pages
5. Wrapper calls `runWikiCritic(...)` again — returns `passes: true`
6. Wrapper emits `critic: passed on attempt 2 — '<summary>'`
7. Returns `{ ..., attempts: 2, exhausted: false }`

### 4.3 Exhaustion path (critic fails all 3 attempts)

1. Attempts 1-3 all return `passes: false`; each emits a warn log line
2. After attempt 3, wrapper detects exhaustion: `attempts === maxWikiReadinessAttempts`
3. Wrapper emits warn-level `critic: exhausted (3/3 attempts) — escalating to operator`
4. Wrapper calls the existing `askUser` surface with prompt = rendered critique (summary + findings) and options `['continue', 'abort', 'extend-3']`. The prompt carries the `[CRITIC]` marker for auto-answer dispatcher recognition
5. Pending question filed via the existing ask-user.ts surface
6. Auto-answer dispatcher (ADR 0030 §3 with new `[CRITIC]` marker case per the Tier 14 amendment) processes after the configured deadline; deterministic default answer = `continue` (preserves today's advisory contract when operator's away)
7. Operator (or auto-answer) returns one of:
   - `continue` → wrapper returns `{ ..., exhausted: true }`; loop proceeds to planner with the last-attempt wiki
   - `abort` → wrapper throws `WikiReadinessAbortError`; loop catches, flips directive to `blocked`, emits `directive.completed`
   - `extend-N` → wrapper continues for N more attempts; axis cap treated as per-extension, not lifetime
8. Operator answer recorded in `pending_questions.answered_by` (`human` / `agent (auto)` per ADR 0030)

### 4.4 Resume path (existing behavior preserved)

`loop.ts:264-275`'s "wiki already ready" probe is replaced with a cheap structural check: "are there ≥1 pages on disk under `docs/knowledge/`?" If yes, the wrapper is skipped entirely. No critic call on resume — the directive that wrote the wiki already paid the critic cost. Preserves Phase 10's resume contract and avoids paying $0.05-0.30 per resume just to re-evaluate an already-accepted wiki.

### 4.5 Spend and emit accounting

- Each `runWikiCritic` call records usage with `agent: 'critic'`, `category: <resolved>` (Opus by default)
- `assertBudget` runs before every architect AND critic call (against directive `maxUsd` / `maxSteps` — existing axes still cap total spend; `maxWikiReadinessAttempts` only caps cycle count)
- All log lines flow through `emitLogLine` (ADR 0031). Components: `brain.critic` for critic events, `brain.architect-loop` for orchestration events. Error events carry first 500 chars of any offending LLM output in `attrs.detail`

## 5. Config surface

### 5.1 `BUDGET_DEFAULTS` 8th axis

```ts
// packages/core/src/budget-defaults.ts
maxWikiReadinessAttempts: {
  value: 3,
  explainer: 'Architect+critic cycles per build before escalating to operator (0 = unlimited).',
}
```

Resolves through the five-surface pipeline Phase 13.6 established:

| Surface             | File                                                        | Pattern                                                                                   |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Core schema         | `packages/core/src/budget-defaults.ts`                      | Adds axis to `BUDGET_DEFAULTS` + extends `budgetsSchema`                                  |
| Per-project default | `<project>/.factory/project.json` `metadata.budgetDefaults` | Already accepts all axes via Phase 13.5's `resolveDirectivePayloadBudgets` — free         |
| CLI flag            | `packages/cli/src/commands/budget-flags.ts`                 | Adds `--max-wiki-readiness-attempts <n>` via `parsePositiveInt`                           |
| Web UI              | `apps/factory-web/src/pages/build.astro`                    | New accordion row (8th axis); accordion summary "seven axes" → "eight axes"               |
| Resume inheritance  | `packages/daemon/src/server.ts`                             | Per-axis via Phase 12.7 `budgetsFromDirective` helper — free                              |
| Brain consumption   | `packages/brain/src/architect-loop.ts`                      | New site; reads `directive.payload.budgets.maxWikiReadinessAttempts` via `resolveBudgets` |

Operator-set value is the active cap. (Phase 13.3's "operator-as-ceiling" precedent applies in spirit: the operator's value is authoritative. For this axis the planner doesn't emit a competing value, so the operator value alone governs.) Zero sentinel = unlimited (matches the existing `maxUsd: 0` / `maxSteps: 0` pattern).

### 5.2 New `[agents.*]` config table

```toml
# .factory/config.toml
[agents]
# Per-agent model category overrides. Omit a key to use the agent's built-in
# default. Categories must be one of: quick / planning / reasoning / deep /
# documentation (see [categories.*] for the category → model bindings).
# architect = "planning"     # Sonnet (default for architect as of Tier 14)
# critic    = "reasoning"    # Opus (default for critic; the wiki-readiness judge)
```

**Persistence:** lives in `<dataDir>/config.json` via Phase 8's `loadConfig()` (ADR 0030 §2).

**Schema** (in `@factory5/state`):

```ts
const agentsConfigSchema = z
  .object({
    architect: modelCategorySchema.optional(),
    critic: modelCategorySchema.optional(),
  })
  .strict()
  .optional();
```

**Built-in defaults** (used when the key is absent):

```ts
export const DEFAULT_AGENT_CATEGORIES = {
  architect: 'planning', // Sonnet — was 'reasoning' (Opus) pre-Tier-14
  critic: 'reasoning', // Opus — new
} as const;
```

**Resolution helper:** `resolveAgentCategory(config, role)` returns `config.agents?.[role] ?? DEFAULT_AGENT_CATEGORIES[role]`. Used by `runArchitect` and `runWikiCritic` at call time. Cached per-directive via the existing config cache.

**Why only these two agents (not the full 10):** YAGNI. Other agents (triage, planner, scaffolder, etc.) have working defaults nobody's asked to override. `agentsConfigSchema` is strict; adding a third later requires a deliberate schema bump.

### 5.3 Persistence to `directive.payload.budgets`

Per ADR 0032 §6 (operator-overrides-only). When the operator sets `--max-wiki-readiness-attempts 5`, the daemon writes `payload.budgets.maxWikiReadinessAttempts = 5` only; defaults stay implicit. Free via Phase 12.4's `apiV1CreateBuildRequestSchema` widening.

**Agent category overrides do NOT persist to `payload.budgets`.** They live in daemon-wide config. Operator-felt model choice should be stable across directives, not per-build (matches `[categories.*]`).

### 5.4 Operator-felt summary

- One-time: edit `.factory/config.toml` `[agents]` to override `critic = "deep"` for a heavier critic
- Per-build: pass `--max-wiki-readiness-attempts 5` on CLI OR set in the Web UI accordion's 8th field
- Per-project: write `metadata.budgetDefaults.maxWikiReadinessAttempts: 5` in `project.json`; subsequent builds inherit

## 6. Schemas, ADRs, migrations

### 6.1 New / extended Zod schemas

**`wikiCritiqueSchema`** (new, in `@factory5/core/schemas.ts`):

```ts
export const wikiCritiqueAspectSchema = z.enum([
  'overview',
  'modules',
  'testing',
  'hygiene',
  'directive-fit',
  'other',
]);
export const wikiCritiqueSeveritySchema = z.enum(['pass', 'minor', 'major', 'blocking']);

export const wikiCritiqueFindingSchema = z.object({
  aspect: wikiCritiqueAspectSchema,
  gap: z.string().min(1),
  suggestion: z.string().min(1),
});

export const wikiCritiqueSchema = z.object({
  passes: z.boolean(),
  severity: wikiCritiqueSeveritySchema,
  findings: z.array(wikiCritiqueFindingSchema),
  summary: z.string().min(1),
});
export type WikiCritique = z.infer<typeof wikiCritiqueSchema>;
```

The `aspect` enum is fixed (Q2 picked rich critique over fixed taxonomy, but the _aspect tag_ is bounded — `'other'` as escape hatch keeps the schema validating without forcing the critic into a Procrustean bed).

**`budgetsSchema`** — extended in place with `maxWikiReadinessAttempts: z.number().int().nonnegative().optional()`. Phase 13.5's per-project resolution path is schema-driven; this single extension covers core + per-project + payload + resume inheritance.

**`agentsConfigSchema`** — defined in §5.2; lives in `@factory5/state/src/config.ts`.

### 6.2 `AGENT_ROLES` bump

```ts
// packages/core/src/constants.ts
export const AGENT_ROLES = [
  'triage',
  'architect',
  'planner',
  'scaffolder',
  'builder',
  'reviewer',
  'fixer',
  'investigator',
  'verifier',
  'critic', // NEW (10th)
] as const;
```

Spend rollups (`factory spend --group-by agent`) and agent-keyed queries get the new bucket for free.

### 6.3 ADRs

**ADR 0033 — Wiki-readiness critique loop (NEW, Tier 14 headline).** Six-part decision:

1. Replace regex with LLM critic as sole readiness arbiter
2. Critic contract: evaluate against directive intent + CLAUDE.md + wiki pages
3. Critic output schema: rich critique with severity + findings + suggestions
4. Retry feedback: critique-only re-prompt; architect rewrites
5. Exhaustion: `askUser` with `[continue/abort/extend-N]`; auto-answer defaults to `continue`
6. Architect default category flip: `reasoning` → `planning` (Sonnet); critic defaults to `reasoning` (Opus); both overridable via `[agents.*]`

**ADR 0032 amendment block** (dated 2026-05-18). Adds `maxWikiReadinessAttempts` as the 8th axis. Per Phase 13.3 precedent (amendment for U033 clarification), no supersedure — the §3 contract is unchanged, the table grows.

**ADR 0004 amendment block** (dated 2026-05-18). Adds the per-agent category override layer (`[agents.*]`) on top of the existing category→model routing. The category→model layer stays the source of truth; `[agents.*]` is a thin override layer for callers that want to deviate from an agent's built-in default.

**ADR 0030 amendment block** (dated 2026-05-18). Auto-answer dispatcher recognizes the `[CRITIC]` marker alongside `[BUDGET]`. Deterministic policy: default answer is `continue`. Reuses the marker-recognition path Phase 12.6 added; no LLM call for the marker case (matches the `[BUDGET]` precedent).

**Total ADR changes:** 1 new + 3 amendments. INDEX.md updated. `docs/ARCHITECTURE.md` ADR count line bumped 32 → 33.

### 6.4 Database migrations

**None.** All changes ride existing schema:

- `directives.payload` is JSON — new axis lives inside the existing `budgets` blob
- `usage_records.agent` is a TEXT column — new `critic` value just inserts; no migration
- `pending_questions` — Phase 8's `answered_by` enum and prompt shape accommodate the `[CRITIC]` marker convention (the marker is a string prefix in the prompt, not a schema column)
- `config.json` shape extension is optional — `loadConfig()` returns defaults when `agents` is absent

Migration count stays at 9. Phase 8's hard-coded `[1..N]` arrays in `003-findings-registry.test.ts` / `004-model-usage-mode.test.ts` / `006-project-identity.test.ts` are NOT touched.

### 6.5 Removed code

- `wikiReadiness()` and its four helpers — deleted from `packages/wiki/src/readiness.ts`
- `ReadinessCheck` and `ReadinessReport` types — deleted (no deprecated aliases)
- Existing 4 readiness tests in `packages/wiki/src/wiki.test.ts` (`describe('wikiReadiness')` block, ~80 lines) — deleted; coverage moves to `packages/brain/src/critic.test.ts` as judge-prompt-quality fixtures
- `architect.ts`'s post-architect `wikiReadiness` call (`architect.ts:250-267`) — deleted; the wrapper owns this
- `loop.ts`'s warn-and-append-build-log block (inside the `// -------- ARCHITECT --------` swap at `loop.ts:262-296`) — subsumed by the wrapper's escalation path

## 7. Error handling

| Condition                                   | Behavior                                                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critic returns malformed JSON               | `ClaudeCliStreamError` thrown; error log emitted with `attrs.detail` carrying first 500 chars; wrapper treats as "attempt failed" and retries; counts against the cap                                                                         |
| Critic returns valid JSON failing schema    | Same as above — Zod parse error wraps to error log + retry                                                                                                                                                                                    |
| Architect throws on retry                   | Propagates up; loop catches, flips directive to `failed` (same as today's architect error path)                                                                                                                                               |
| Budget exhausted mid-loop (maxUsd hit)      | `assertBudget` throws `BudgetExceededError`; loop catches per existing path; pending-question NOT filed because the directive is already terminating                                                                                          |
| `askUser` deadline expires without operator | Auto-answer dispatcher returns `continue` per ADR 0030 + amendment; wrapper resolves with `exhausted: true`                                                                                                                                   |
| `askUser` operator selects `abort`          | Wrapper throws `WikiReadinessAbortError`; loop catches; directive flipped to `blocked`. Operator finds the rendered critique in the pending_questions row (persisted) and in the activity panel via the Phase 11 `directive_log_lines` replay |
| Wiki pages empty when critic runs           | Critic errors early with clear message before LLM call ("no pages to evaluate at `<projectPath>/docs/knowledge/`"); wrapper treats as architect failure (the architect didn't write anything); counts as attempt; retries                     |

## 8. Testing strategy

### 8.1 Per-module unit tests (TDD: RED first, GREEN second — Phase 13.3 pattern)

**`packages/brain/src/critic.test.ts`** (new, ~10-12 tests):

1. Happy-path fixture — synthetic wiki + directive; mock Opus call returns `passes: true`; assert `WikiCritique` parses, info-level log line emitted
2. Failure fixture — mock returns `passes: false, severity: 'major', findings: [...]`; assert findings flow through, warn-level log emitted, severity preserved
3. Schema-parse failure — Opus returns malformed JSON or wrong shape; assert error thrown, error event emitted with `attrs.detail` carrying first 500 chars per ADR 0031
4. Empty findings on fail — degenerate case; allowed by schema; wrapper still triggers retry
5. Prompt shape regression — assert user prompt contains directive body, CLAUDE.md content, rendered wiki pages
6. Spend recorded under `agent: 'critic'`
7. Resolves model category from `agents.critic` config when set (fixture: `agents.critic = 'deep'`)
8. Defaults to `'reasoning'` when config absent
9. Budget assertion fires before LLM call
10. Empty pages on disk → clear error before LLM call

**`packages/brain/src/architect-loop.test.ts`** (new, ~12-15 tests):

1. Passes on attempt 1 — `attempts: 1, exhausted: false`, one architect + one critic call
2. Passes on attempt 2 — fail then pass; assert `attempts: 2`, two architect calls (second with `priorCritique` populated), two critic calls
3. Exhausts at attempt 3 — all fail; askUser called with rendered critique
4. Operator answers `continue` → wrapper returns `{exhausted: true}`
5. Operator answers `abort` → wrapper throws `WikiReadinessAbortError`
6. Operator answers `extend-3` → wrapper continues for 3 more attempts
7. `maxWikiReadinessAttempts: 0` (unlimited sentinel) — passes after N attempts; no askUser
8. `maxWikiReadinessAttempts: 1` — first fail → exhaustion immediately
9. Operator-as-ceiling axis precedence — directive axis=2, default=3; wrapper uses 2
10. `[CRITIC]` marker present in askUser prompt
11. Resume path skip — pages exist on disk → wrapper short-circuits, no critic call
12. Architect's `priorCritique` flows through on second attempt
13. Each attempt emits `critic: attempt N/M` log line
14. Exhaustion log line carries rendered critique
15. Both architect and critic throwing on same attempt → error propagation

**`packages/brain/src/architect.test.ts`** (modified, ~3-4 added tests):

1. `priorCritique` parameter appends feedback block to user prompt
2. No `priorCritique` → no feedback block (attempt-1 prompt shape preserved)
3. Architect resolves `agents.architect` category from config
4. Architect uses `'planning'` (Sonnet) by default post-Tier-14

### 8.2 Schema tests

- `packages/core/src/schemas.test.ts` — `wikiCritiqueSchema` parses valid shapes, rejects invalid. ~5 tests.
- `packages/core/src/budget-defaults.test.ts` — `BUDGET_DEFAULTS` has 8 entries; `maxWikiReadinessAttempts.value === 3`; `resolveBudgets({maxWikiReadinessAttempts: 5})` floors. ~3 tests.
- `packages/state/src/config.test.ts` — `agentsConfigSchema` parses/rejects; `resolveAgentCategory` returns config value when present, default when absent. ~4 tests.

### 8.3 Daemon integration tests

`packages/daemon/src/server.test.ts` — `POST /api/v1/builds` accepts `body.budgets.maxWikiReadinessAttempts`; persists to `directive.payload.budgets`; resume inherits per-axis. ~2-3 tests.

### 8.4 CLI tests

`packages/cli/src/commands/budget-flags.test.ts` (the Phase 12.5 / 13.6 test file) — `--max-wiki-readiness-attempts 5` parses through `parsePositiveInt`; rejects float input. ~2 tests.

### 8.5 End-to-end integration test (mocked LLM, real loop)

`packages/brain/src/loop.test.ts` — extends existing fixture:

- `architect → critic-pass → planner` (no retry exercised)
- `architect → critic-fail → architect → critic-pass → planner` (retry path)
- `architect → critic-fail x 3 → askUser → continue → planner` (exhaustion-continue)
- `architect → critic-fail x 3 → askUser → abort → blocked directive` (exhaustion-abort)

Mock provider returns canned `WikiCritique` shapes per scenario. Mock pending-question answerer for the askUser turns. ~4 tests.

### 8.6 Live browser smoke (phase-close gate)

Playwright MCP pattern from Phase 13.7:

1. Start fresh daemon (rebuild dist first — Phase 12's "running daemon doesn't auto-restart" lesson)
2. Create `tier-14-smoke` project via `/app/projects/new` with a CLAUDE.md spec deliberately thin on module relationships (regex would have passed; critic should flag it)
3. `/app/build/` → submit with default `maxWikiReadinessAttempts=3`
4. Watch directive detail's activity panel narrate: `critic: evaluating wiki (attempt 1/3)` → `critic: failed (major)` → `architect: calling planning` → `critic: evaluating wiki (attempt 2/3)` → ...
5. Assert at least one retry fires; ideally pass-on-attempt-2-or-3
6. Assert spend rollup shows `critic` as a distinct agent row in `/app/spend?group-by=agent`
7. Optional second smoke: fixture wiki the critic can't fix in 3 attempts → askUser surfaces in `/app/questions/` with `[CRITIC]` marker, operator answers `continue`, build proceeds

Estimated spend: $0.50-1.50 (Sonnet architect ×2-3 + Opus critic ×2-3), within typical $1.50 phase-close cap.

### 8.7 Test count delta

Brain +15-20, core +5-8, state +3-5, cli +2, daemon +2-3, wiki −12 to −15 (deleted regex tests).

**Net +15 to +25.** Workspace from 1322 to roughly **1340-1347 passing post-Tier-14.**

### 8.8 TDD discipline (Phase 13.3 pattern)

For each module:

1. Write the test file expressing the NEW contract
2. Run → expect RED on every test exercising new code
3. Implement minimum to make tests pass
4. Verify GREEN
5. Refactor if needed; tests stay GREEN

For the regex deletion: existing `wikiReadiness` tests in `packages/wiki/src/wiki.test.ts` are deleted in the _same commit_ that introduces the critic — not a setup commit. Workspace stays green at every commit boundary.

## 9. Out of scope (for Tier 14)

These were considered and intentionally excluded:

- **Generic critic loops for other stages** (planner critic, build critic). The `critic` agent role is generic for future-proofing, but only the wiki critic ships in Tier 14. Add new critic instances as future tiers when demand surfaces.
- **Diff-style architect output on retry.** Considered (Q3 option C — architect emits only new/modified pages). Rejected for first ship: requires merge logic + `delete this page` schema option + more moving parts. Architect rewrites full wiki on retry; if cost becomes a problem, optimize later.
- **Per-directive model category overrides.** `[agents.*]` lives in daemon-wide config, not `payload.budgets`. Per-build model switching is a future tier if needed.
- **Critic prompt context expansion** (task_log, findings, prior similar projects). First ship sends directive + CLAUDE.md + wiki pages; expand when quality data shows the lean prompt underperforms.
- **Cost-axis enforcement** (`maxWikiJudgeUsd` separate from `maxUsd`). Q4 picked count-only; spend is governed indirectly via the directive's `maxUsd`. Add a dedicated dollar cap later if the count-axis proves insufficient.

## 10. Risks and mitigations

| Risk                                                               | Mitigation                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonnet architect produces lower-quality wikis than Opus did        | Critic catches it on attempt 1; architect-loop retries with feedback. Net quality should match or exceed today's Opus-only path. Operator can flip config back to `agents.architect = "reasoning"` if needed                |
| Critic non-determinism (passes today, fails tomorrow on same wiki) | Temperature 0.0 on the critic call (vs 0.2 on the architect); deterministic JSON schema reduces variance. If non-determinism is still measurable, future tier can introduce a "stability check" (run twice, take consensus) |
| Loop runs forever via `maxWikiReadinessAttempts: 0` (unlimited)    | Existing `maxUsd` and `maxSteps` axes still cap total spend; loop will trip those instead. Sentinel matches established `BUDGET_DEFAULTS` pattern                                                                           |
| Critic approves a genuinely bad wiki (false-pass)                  | Operator-felt during planner stage when the planner can't decompose; existing planner-emit error path (ADR 0031) surfaces this. Critic prompt evolves over time if false-pass rate is measurable                            |
| Cost spike per build (worst case: 3 Sonnet + 3 Opus calls)         | Default `maxWikiReadinessAttempts: 3` caps the worst case; operator can lower to 1 (no retry) if cost-sensitive; `assertBudget` against directive `maxUsd` is a hard backstop                                               |
| `askUser` interrupts builds when operator's away                   | Auto-answer dispatcher (ADR 0030 + Tier 14 amendment) defaults the `[CRITIC]` marker to `continue` — preserves today's advisory contract end-to-end for autonomous operation                                                |

## 11. Implementation order (rough — full plan to be written next)

Sub-step granularity for `.control/phases/phase-14-wiki-readiness-judge/steps.md`:

1. **14.1** — Scaffold tier (phase dir, plan, ROADMAP rows, STATE flip); open referencing issue in `UPGRADE/ISSUES.md` (next U-number assigned at scaffold time)
2. **14.2** — ADR 0033 (new) + ADR 0032/0004/0030 amendments
3. **14.3** — `wikiCritiqueSchema` in core + `AGENT_ROLES` bump + `BUDGET_DEFAULTS` 8th axis
4. **14.4** — `agentsConfigSchema` + `DEFAULT_AGENT_CATEGORIES` + `resolveAgentCategory` in state
5. **14.5** — `runWikiCritic` in brain (TDD; ~12 tests)
6. **14.6** — `runArchitect` modifications (priorCritique param + agent-category resolution) (TDD; ~4 tests)
7. **14.7** — `runArchitectWithCritique` wrapper (TDD; ~15 tests)
8. **14.8** — `loop.ts` integration; delete `wikiReadiness` + helpers; delete old tests
9. **14.9** — Daemon: extend `apiV1CreateBuildRequestSchema`, persistence, resume inheritance (~3 tests)
10. **14.10** — CLI: `--max-wiki-readiness-attempts` flag (~2 tests)
11. **14.11** — Web UI: 8th accordion row; summary "seven axes" → "eight axes"
12. **14.12** — Phase close: live browser smoke + ROADMAP/STATE recordkeeping

Roughly 12 sub-steps; estimated 2-3 sessions to close.

---

## Acceptance criteria (for phase-close)

- [ ] All 4 `pnpm` gates green (build, test, lint, format:check) across all 15 packages
- [ ] ADR 0033 lands; ADR 0032/0004/0030 amendment blocks dated
- [ ] `wikiReadiness()` and its 4 helpers deleted; no remaining importers
- [ ] `runWikiCritic` + `runArchitectWithCritique` + `runArchitect priorCritique` parameter all tested per §8
- [ ] `BUDGET_DEFAULTS` has 8 axes; `maxWikiReadinessAttempts` flows through CLI + Web UI + per-project + payload + resume
- [ ] `[agents.*]` config table parses; `resolveAgentCategory` defaults correctly
- [ ] `AGENT_ROLES` has 10 entries including `'critic'`
- [ ] Live browser smoke verified: critic fires on a CLAUDE.md-thin project; at least one retry observed; spend rollup shows distinct `critic` row
- [ ] Auto-answer dispatcher recognizes `[CRITIC]` marker; defaults to `continue` after deadline
- [ ] Workspace test count ≥ 1340 passing
