# 0033 — Wiki-readiness critique loop: LLM judge replaces regex, architect–critic retry, exhaustion escalation, per-agent category overrides

- **Status:** Accepted
- **Date:** 2026-05-23
- **Supersedes:** none
- **Builds on:** [ADR 0004](0004-category-based-model-routing.md) — category-based routing that this ADR extends with a per-agent override layer. [ADR 0030](0030-pending-question-auto-answer.md) — auto-answer dispatcher this ADR extends with `[CRITIC]` marker recognition. [ADR 0032](0032-budget-ux-paradigm.md) — `BUDGET_DEFAULTS` closed set this ADR grows by one axis (`maxWikiReadinessAttempts`).

## Context

Every build runs a regex-based wiki-readiness gate after the architect stage (`packages/wiki/src/readiness.ts`, called from `packages/brain/src/architect.ts:250`). Four checks: `overview-exists`, `modules-documented`, `testing-documented`, `minimum-content`. On failure the brain logs `wiki readiness: failed (<checks>) — continuing per Phase 1 policy` and proceeds to the planner (advisory, not blocking).

The `modules-documented` check fires on most projects because its regex is over-literal: it requires either a `modules/` subdirectory of wiki pages OR a literal `\n## Modules` H2 header. The architect (Opus) frequently produces `# Modules` H1, `## Components`, scattered headings, or other shapes that the regex misses. The Phase 11 retrospective characterised this warn as "Opus non-determinism, not a load-bearing gate bug" and parked a fix as a carry-forward.

Operator-felt problem: the warn fires on most projects, creating noise that operators learn to ignore. When the warn IS load-bearing (genuinely thin wiki) the noise mixes it into the chaff. The advisory contract is right in principle; the regex implementation is wrong in practice.

The immediate trigger is the Phase 11 retro's "Opus non-determinism" framing: the problem is not random variation in a fixed program, but a mismatch between what the architect writes and what a hard-coded pattern can recognise. An LLM judge that reads both the directive's intent AND the wiki can close this gap without any rigid syntactic expectations.

Full design specification: [`docs/superpowers/specs/2026-05-18-tier-14-wiki-readiness-llm-judge-design.md`](../superpowers/specs/2026-05-18-tier-14-wiki-readiness-llm-judge-design.md).

## Decision

Six parts, one ADR. Tier 14 lands all six.

### 1. Replace regex with LLM critic as sole readiness arbiter

`wikiReadiness()` and its four helper functions are deleted from `packages/wiki/src/readiness.ts`. The `ReadinessCheck` and `ReadinessReport` types are deleted with no deprecated aliases — any remaining importer is broken code worth surfacing at compile time.

The LLM critic (`runWikiCritic` in `packages/brain/src/critic.ts`) becomes the sole arbiter of wiki readiness. The advisory contract is preserved end-to-end: the brain does not block the planner when the critic flags a wiki as insufficient; it retries the architect with critique feedback and escalates only on exhaustion (see §5). The _signal quality_ improves because the critic evaluates semantic intent, not syntactic pattern.

### 2. Critic contract: directive intent + CLAUDE.md + wiki pages

`runWikiCritic({ registry, projectPath, directiveBody, claudeMd, pages, db?, directiveId?, emit? })` is a single LLM call. It reads:

- The directive body (the operator's stated build intent)
- The project's `CLAUDE.md` content (project-level spec and constraints)
- All wiki pages on disk under `docs/knowledge/`

The critic's model category is resolved at call time via the per-agent override layer (§6). Default: `'reasoning'` (Opus). No retry logic — that is the wrapper's responsibility (§4).

No task-log, no findings, no past Q&A in the critic prompt. First-ship keeps the prompt lean and expands later if quality data shows the lean prompt underperforms. Critic temperature: `0.0` (vs `0.2` for the architect) to reduce non-determinism in the pass/fail signal.

The critic emits `brain.critic` log lines per ADR 0031. Each call records spend with `agent: 'critic'`, `category: <resolved>` against the parent directive.

### 3. Critic output schema: rich critique with severity, findings, and suggestions

The critic returns a structured `WikiCritique` validated against `wikiCritiqueSchema` (new Zod schema in `packages/core/src/schemas.ts`):

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

The `aspect` enum is closed to bound the schema but `'other'` acts as an escape hatch so the critic is not forced into a Procrustean taxonomy. If the critic returns malformed JSON or a shape that fails Zod parse, the error is logged at `error` level with `attrs.detail` carrying the first 500 characters of the offending output (per ADR 0031), the attempt counts against the cap, and the wrapper retries.

### 4. Retry feedback: critique-only re-prompt; architect rewrites

When the critic returns `passes: false`, the wrapper (`runArchitectWithCritique` in `packages/brain/src/architect-loop.ts`) invokes `runArchitect` again with `priorCritique: WikiCritique`. The architect's user prompt gets a `--- PREVIOUS ATTEMPT FAILED ---` section appended carrying the critique's `summary` and `findings`. The architect rewrites all wiki pages — no diff-style partial update on first ship (adds merge complexity; defer if cost becomes a problem).

The wrapper owns the retry loop. `runArchitect` and `runWikiCritic` remain sharp single-pass functions; orchestration is not their concern.

`assertBudget` runs before every architect AND critic call (against the directive's `maxUsd` / `maxSteps` — existing axes still cap total spend). `maxWikiReadinessAttempts` (§5) caps cycle count only, not spend.

### 5. Exhaustion: `askUser` with `[continue/abort/extend-N]`; auto-answer defaults to `continue`

When all attempts are exhausted, the wrapper calls the existing `askUser` surface with:

- Prompt: rendered critique (summary + findings) prefixed with the `[CRITIC]` marker
- Options: `['continue', 'abort', 'extend-3']`

The `[CRITIC]` marker enables the auto-answer dispatcher (ADR 0030 + the amendment landed in this tier) to recognise the question and apply a deterministic answer: `continue` after the deadline. No LLM call for the `[CRITIC]` marker case — matches the `[BUDGET]` deterministic precedent in ADR 0030's Phase 12.6 extension.

Operator / auto-answer responses:

| Answer     | Outcome                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `continue` | Wrapper returns `{ ..., exhausted: true }`; loop proceeds to planner with last-attempt wiki. Preserves today's advisory contract for autonomous operation. |
| `abort`    | Wrapper throws `WikiReadinessAbortError`; loop catches; directive flips to `blocked`.                                                                      |
| `extend-N` | Wrapper continues for N more attempts; cap treated as per-extension, not lifetime.                                                                         |

The `maxWikiReadinessAttempts` axis is the 8th entry in `BUDGET_DEFAULTS` (ADR 0032's closed set, extended per that ADR's amendment in this tier):

```ts
maxWikiReadinessAttempts: {
  value: 3,
  explainer: 'Architect+critic cycles per build before escalating to operator (0 = unlimited).',
}
```

Zero sentinel = unlimited — matches `maxUsd: 0` / `maxSteps: 0`. Operator can set `--max-wiki-readiness-attempts 1` for cost-sensitive runs or `0` for unbounded retries (the directive's `maxUsd` then governs total spend as the backstop).

### 6. Per-agent category overrides: `[agents.*]` config table; architect flips to `planning`; critic defaults to `reasoning`

ADR 0004's category→model routing layer is extended with a per-agent override layer (see ADR 0004's amendment landed in this tier). The layer lives in `<dataDir>/config.json` as a new `agents` key, parsed by `agentsConfigSchema` in `packages/state/src/config.ts`.

**Built-in defaults shipping in Tier 14:**

```ts
export const DEFAULT_AGENT_CATEGORIES = {
  architect: 'planning', // Sonnet — was 'reasoning' (Opus) pre-Tier-14
  critic: 'reasoning', // Opus — new
} as const;
```

The architect's default category flips from `'reasoning'` (Opus) to `'planning'` (Sonnet). This is an intentional behaviour change across all builds — cheaper, faster author + thorough expensive critic can net lower spend than today's expensive author with no critic. Operators who prefer the prior behaviour can flip back via `agents.architect = "reasoning"` in their config.

The `agentsConfigSchema` is `.strict()` — extending to additional agent roles requires a deliberate schema bump.

**Resolution helper:** `resolveAgentCategory(config, role)` returns `config.agents?.[role] ?? DEFAULT_AGENT_CATEGORIES[role]`. Used by `runArchitect` and `runWikiCritic` at call time.

**Agent category overrides do NOT persist to `payload.budgets`** (per ADR 0032 §6). They live in daemon-wide config. Model choice should be stable across directives, not per-build — matches the `[categories.*]` precedent.

## Consequences

### Positive

- Wiki-readiness signal quality improves. The LLM critic evaluates semantic intent against the directive's stated goal, not against a syntactic pattern. The "modules-documented" false-positive disappears.
- Advisory contract preserved. The exhaustion path defaults to `continue` — autonomous runs that exhaust the retry cap are not blocked indefinitely. Operators who are present can answer `continue` / `abort` / `extend-N` in real time.
- Cost-neutral or better in the common case. Sonnet architect (cheaper, faster) + Opus critic on a single pass is often less expensive than the prior Opus architect with no critic. The worst-case (3 Sonnet + 3 Opus calls) is bounded by `maxWikiReadinessAttempts: 3` and by the directive's `maxUsd`.
- Retry loop produces a better wiki. The architect receives specific, structured feedback on each retry — not a generic "try again". Finding-level suggestions tell the architect which aspect is thin and what to add.
- Spend taxonomy gains a distinct `critic` bucket. `factory spend --group-by agent` shows the critic's cost separately from the architect's.

### Negative

- Per-build cost increases in the retry path. Each retry is one Sonnet + one Opus call. Three-attempt worst case is roughly $0.50–$1.50 extra per build (bounded by the axis default and `maxUsd`).
- Critic non-determinism risk. The same wiki may pass on one critic call and fail on another. Mitigated by `temperature: 0.0` and a structured JSON schema. If measurable non-determinism remains, a future "stability check" (run twice, take consensus) can be added without an ADR amendment.
- Sonnet architect may produce lower-quality first drafts. Critic catches it on attempt 1; retry path feeds structured feedback. Net quality should match or exceed today's Opus-only single-pass. Operator can flip back via config.
- New wrapper module (`architect-loop.ts`) adds an orchestration layer between `loop.ts` and `architect.ts`. The added indirection is the cost of separation-of-concerns; the tradeoff is that `runArchitect` and `runWikiCritic` stay unit-testable as sharp single-pass functions.
- Resume skips the critic. The "pages exist on disk?" structural check at the top of the wrapper means a resume never re-evaluates an already-written wiki. This is intentional (paid the critic cost on the original run) but means a forced re-run after a wiki edit requires a new directive, not a resume.

## Alternatives Considered

### A. Fix the regex instead of replacing it

Improve `modules-documented` to match `# Modules` H1, `## Components`, or any heading that contains module-like content. Pros: tiny change, no new model calls. Cons:

- **Doesn't fix the root cause.** The architect writes whatever it judges best for the project; any finite regex set will find a new shape to miss. The Phase 11 retro already characterised this as a dead end.
- **No structured feedback on failure.** A smarter regex can say "failed" but not "the overview section doesn't mention the auth flow you requested; add a paragraph about it." The critic's `findings[]` array enables targeted re-prompting.

**Rejected.** The root cause is semantic evaluation, not pattern coverage.

### B. LLM judge advisory-only, no retry loop

Run the critic once, emit a warn if it fails, proceed — same advisory policy as today but with better signal. Pros: simpler; no retry cost. Cons:

- **Waste the signal.** A structured critique is most useful when it drives improvement, not just logging. A critic that never causes a rewrite is expensive logging.
- **Still noisy in practice.** Operators learn to ignore the warn. If the first-pass wiki is consistently passing on the second or third attempt with feedback, the retry loop is doing real work.

**Rejected.** The critique is valuable primarily as feedback, not as a verdict.

### C. Architect diff-output on retry (modified pages only)

On retry, the architect emits only the pages that changed relative to the prior attempt, rather than rewriting all pages. Pros: fewer tokens on retry; easier to see what changed. Cons:

- Requires merge logic (new pages, deleted pages, modified pages).
- Requires a `delete this page` schema option in the architect's output.
- More moving parts in the wrapper; harder to test.

**Deferred.** Full rewrites are simpler to implement and test. If per-retry cost becomes a real operator complaint (measurable in spend reports), optimize then.

### D. Per-directive `[agents.*]` config (model choice per build)

Let operators specify `--architect-category reasoning` per CLI invocation rather than via daemon-wide config. Pros: finer-grained control; build-level reproducibility for model choice. Cons:

- `payload.budgets` is already the per-directive persistence surface; adding model category to it extends the persistence contract and every resume/replay path.
- Model choice stability across directives is the desired operator UX — you configure once, all builds use the same model setup.

**Rejected for first ship.** Daemon-wide `[agents.*]` matches the `[categories.*]` precedent. Per-build model overrides are a future tier if real demand surfaces.

## References

- [Spec §6.3](../superpowers/specs/2026-05-18-tier-14-wiki-readiness-llm-judge-design.md) — six-part ADR 0033 decision content and schema definitions
- [ADR 0004](0004-category-based-model-routing.md) — category routing layer extended by §6's per-agent override table
- [ADR 0030](0030-pending-question-auto-answer.md) — auto-answer dispatcher extended with `[CRITIC]` marker
- [ADR 0032](0032-budget-ux-paradigm.md) — `BUDGET_DEFAULTS` closed set extended with `maxWikiReadinessAttempts` as the 8th axis
- [ADR 0031](0031-log-forwarder-design.md) — `emitLogLine` contract for `brain.critic` and `brain.architect-loop` log lines
- U035 — operator-felt incident driving Tier 14 (wiki-readiness gate noise)
