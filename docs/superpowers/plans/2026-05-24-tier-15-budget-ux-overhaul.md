# Tier 15 — Budget UX overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the entire `[BUDGET]` askUser path with a project-level budget cockpit. Switch the three `maxTurns*` axes from per-task caps to per-agent-class directive-wide pools. Live re-resolve from `project.json` with per-build override as a floor. Optional auto-increase toggle bounded by safety multiplier ceiling. The parser, the askUser, the structured-options-UI gap, and the per-axis bucket schedule all disappear together.

**Architecture:** Pool calculation is derived live in `packages/brain/src/pool-usage.ts` from `tasks` + `model_usage` + `project.json`. New `pool-resume.ts` chokidar watcher on `<project>/.factory/project.json` flips parked directives back to running when cap is raised. `pool.ts` dispatcher rewrites the per-task retry-loop into a pool-driven pre-launch check + worker watchdog callback. `budget-escalation.ts` (~360 lines) + companion test (~520 lines) deleted entirely. Web UI project detail page rewrites from a single 2-axis form into a four-tabbed cockpit (Live / Defaults / History / Settings). New `GET /api/v1/directives/:id/pool-usage` route + `pool.tally` SSE event. ADR 0034 (new — Budget Pool Paradigm) supersedes ADR 0032.

**Tech Stack:** TypeScript strict, Node 20+, Zod, Vitest, Pino (`@factory5/logger`), Commander (CLI), Astro (Web UI), better-sqlite3 (via `@factory5/state`), Fastify (daemon), chokidar (file watcher — already a transitive dep via vitest/astro; verify before pulling in).

**Reference spec:** `docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md`

---

## File map

**New files:**

| Path | Responsibility |
|---|---|
| `packages/brain/src/pool-usage.ts` | `computePoolUsage(db, directiveId, projectBudgets)` — SQL aggregation + cap resolution |
| `packages/brain/src/pool-usage.test.ts` | Unit tests for pool-usage |
| `packages/brain/src/pool-resume.ts` | chokidar watcher for project.json; flips parked directives back to running |
| `packages/brain/src/pool-resume.test.ts` | Unit tests for pool-resume |
| `docs/decisions/0034-budget-pool-paradigm.md` | ADR 0034 (new, supersedes ADR 0032) |
| `UPGRADE/plans/tier-15-budget-ux-overhaul.md` | Control-framework tier plan (separate file, already authored at brainstorm time) |
| `.control/phases/phase-15-budget-ux-overhaul/README.md` | Phase README |
| `.control/phases/phase-15-budget-ux-overhaul/steps.md` | Phase steps checkboxes |

**Modified files:**

| Path | Change |
|---|---|
| `packages/core/src/schemas.ts` | Extend `projectMetadataSchema` (or equivalent) with `autoIncreaseBudgets` + `autoIncreaseCeilingMultiplier` |
| `packages/core/src/schemas.test.ts` | Tests for new fields |
| `packages/core/src/budget-defaults.ts` | Re-export `axisForAgent` (moved from `budget-escalation.ts`) or define here |
| `packages/wiki/src/project-metadata.ts` | Surface the two new scalars; delete `resolveDirectivePayloadBudgets` |
| `packages/wiki/src/project-metadata.test.ts` | Add round-trip tests for new scalars; remove `resolveDirectivePayloadBudgets` tests |
| `packages/brain/src/pool.ts` | Replace per-task retry-loop with pool-driven dispatcher; add `parkOrAutoIncrease` helper |
| `packages/brain/src/pool.test.ts` | Tests for pool-driven dispatcher (or new file if mock plumbing requires) |
| `packages/brain/src/planner.ts` | Drop `task.maxTurns` emit instruction from prompt |
| `packages/brain/src/auto-answer.ts` | Delete `[BUDGET]` branch + `pickBudgetEscalationAnswer` helper |
| `packages/brain/src/auto-answer.test.ts` | Drop `[BUDGET]` tests; keep `[CRITIC]` + generic LLM tests |
| `packages/brain/src/budget-escalation.ts` | **DELETE entirely** |
| `packages/brain/src/budget-escalation.test.ts` | **DELETE entirely** |
| `packages/brain/src/worker.ts` (or wherever runWorker lives) | Add `onTurnComplete?: () => { interrupt: boolean }` callback param to `runWorker` |
| `packages/brain/src/serve.ts` | Wire `pool-resume.ts` watcher startup into the serve lifecycle |
| `packages/daemon/src/server.ts` | Extend PUT /budget-defaults schema; new GET /pool-usage route; pool.tally SSE event |
| `packages/daemon/src/server.test.ts` | Tests for new schema + route + SSE event |
| `packages/ipc/src/schemas.ts` (or equivalent) | New + extended IPC schemas |
| `apps/factory-web/src/pages/projects/detail.astro` | Full rewrite — four-tabbed cockpit |
| `apps/factory-web/src/pages/directives/detail.astro` | Add Pool usage pill linking to project page |
| `apps/factory-web/src/pages/build.astro` | Copy update on Advanced budgets accordion |
| `docs/decisions/0032-budget-ux-paradigm.md` | Status line edit only: `Status: Superseded by ADR 0034` |
| `docs/decisions/0030-pending-question-auto-answer.md` | Append amendment block |
| `docs/decisions/0020-limits.md` | Append amendment block (cross-ref to ADR 0034) |
| `docs/decisions/INDEX.md` | Add ADR 0034 row; flip ADR 0032 status note |
| `docs/ARCHITECTURE.md` | ADR count 33 → 34 |
| `UPGRADE/ROADMAP.md` | Add Tier 15 row; bump intro count "Fourteen tiers" → "Fifteen tiers" |
| `UPGRADE/ISSUES.md` | Open U036, U037, U038 |
| `.control/architecture/phase-plan.md` | Add Phase 15 row |
| `.control/progress/STATE.md` | Cursor flip arc-complete → Phase 15 active |

---

## Conventions for every Task

- **TDD:** every Task that produces code writes the failing test FIRST, runs it to confirm RED, implements minimum to GREEN, runs to confirm. Test code is committed alongside implementation in the same commit (the workspace stays green at every commit boundary).
- **Commit format:** Control commit-msg hook enforces `<type>(<phase>.<step>): <subject>`. Tier 15 sub-steps use `(15.N)`. Allowed types: `feat fix test docs refactor chore redesign`.
- **Lint + format:** after every code change, run `pnpm lint` and `pnpm format:check` from repo root. Fix any output before committing. Prettier may reformat — that's expected.
- **Build gates:** before committing any Task that changes types or schemas, run `pnpm build` from repo root to catch downstream type breakage.
- **No `console.log`:** per CLAUDE.md, use `createLogger('brain.pool')` etc. Lint enforces.
- **No `any`:** strict mode is hard-on. Use `unknown` and narrow.
- **ESM imports:** `import { foo } from './bar.js'` (note the `.js` extension on TS source imports).

---

## Task 1: Scaffold Tier 15

**Files:**

- Create: `UPGRADE/plans/tier-15-budget-ux-overhaul.md` (already authored at brainstorm time — verify it exists; if not, author from the spec)
- Create: `.control/phases/phase-15-budget-ux-overhaul/README.md`
- Create: `.control/phases/phase-15-budget-ux-overhaul/steps.md`
- Modify: `.control/architecture/phase-plan.md` (add Phase 15 row + summary)
- Modify: `UPGRADE/ROADMAP.md` (add Tier 15 section; bump intro "Fourteen tiers" → "Fifteen tiers")
- Modify: `UPGRADE/ISSUES.md` (add U036, U037, U038 to Open section)
- Modify: `.control/progress/STATE.md` (cursor flip: arc-complete → Phase 15 active at 15.1)

---

- [ ] **Step 1: Open U036, U037, U038 in `UPGRADE/ISSUES.md`**

In the `## Open` section (per the file's line-3 protocol: append to bottom), append three issues:

```markdown
### U036 — `[BUDGET]` askUser parser rejects natural-language replies

- **Filed**: 2026-05-24
- **Severity**: high
- **Tier**: 15
- **Area**: brain

`packages/brain/src/budget-escalation.ts::parseBudgetEscalationAnswer` recognizes only literal `'accept'`, `'abort'`, or `/^custom\s+(\d+)$/`. Natural-language replies like `"accept, bump to 160"` (operator-typed during 2026-05-23 pythonetl build `01KSB8DEZQCENQEKBKBRCKNYZK`) fall through to `{ kind: 'abort', reason: 'parse-failed' }`, aborting the task and cascading 12 dependent task failures with exit 2 "upstream failure."

**Hypothesis**: parser was designed for a structured option-list UI that the Question Detail page never enforced (see U037). Operator typed a sensible natural reply that any LLM (or relaxed regex) would recognize as `custom 160`.

**Resolution candidates**: see Tier 15 spec — root-cause fix is to delete the parser entirely and replace the `[BUDGET]` askUser with a project-level budget cockpit (live edit, optional auto-increase).

### U037 — Question Detail page renders free-form textarea on structured-options questions

- **Filed**: 2026-05-24
- **Severity**: medium
- **Tier**: 15
- **Area**: web

ADR 0032 §4 specified `[BUDGET]` askUser as a closed-set answer space (`accept` / `custom <n>` / `abort`). `apps/factory-web/src/pages/questions/detail.astro` renders a free-form `<textarea>` regardless of the `options[]` field, so the operator has no UI affordance signaling the answer is structured.

**Hypothesis**: the Question Detail page predates the structured-options askUsers and was never updated. The `options[]` field is shown as a "suggested-answers" hint but not enforced.

**Resolution candidates**: in scope for Tier 15 specifically for `[BUDGET]` (closed by deletion of the question). General fix for non-budget structured-options askUsers deferred (Tier 16+).

### U038 — Brain races auto-answer LLM dispatch on directive-level `[escalation]` askUser

- **Filed**: 2026-05-24
- **Severity**: low
- **Tier**: (deferred — Tier 16+ candidate)
- **Area**: brain

During the 2026-05-23 pythonetl run, the brain's serve loop marked the directive `blocked` at 20:57:23 because the directive-level `[escalation]` askUser's deadline elapsed. The auto-answer dispatcher had claimed the question 1s earlier (20:57:22) and the LLM call returned a usable `"skip"` answer at 20:57:36 — 13s after the brain gave up. The directive stayed `blocked` even though the auto-answer eventually produced a sensible reply.

**Hypothesis**: brain's terminal-flip races the auto-answer LLM dispatch. Either the askUser deadline should budget for LLM latency, OR the brain should wait for in-flight auto-answer claims to settle before declaring blocked.

**Resolution candidates**: deferred — out of scope for Tier 15 (budget UX). Brain-side timing fix, separate tier.
```

- [ ] **Step 2: Author `.control/phases/phase-15-budget-ux-overhaul/README.md`**

Use the existing phase README pattern (read `.control/phases/phase-14-wiki-readiness-judge/README.md` for shape). Headline: `# Phase 15 — Budget UX overhaul`. Done-criteria from spec §6.13. Reference the spec and the UPGRADE plan.

- [ ] **Step 3: Author `.control/phases/phase-15-budget-ux-overhaul/steps.md`**

```markdown
# Phase 15 steps

- [ ] 15.1 Scaffold tier (this commit)
- [ ] 15.2 ADR 0034 (new) + ADR 0032 Status update + ADR 0030 amendment + ADR 0020 amendment
- [ ] 15.3 Core: project-level config scalars (`autoIncreaseBudgets`, `autoIncreaseCeilingMultiplier`)
- [ ] 15.4 State (wiki): project-metadata reads/writes for new scalars; delete `resolveDirectivePayloadBudgets`
- [ ] 15.5 Brain: `computePoolUsage` helper in `pool-usage.ts`
- [ ] 15.6 Brain: `pool-resume.ts` chokidar watcher
- [ ] 15.7 Brain: pool-driven dispatcher rewrite (`pool.ts` + planner emit drop + worker watchdog wire-up)
- [ ] 15.8 Brain: delete `budget-escalation.ts` + `[BUDGET]` branch in `auto-answer.ts`
- [ ] 15.9 Daemon: HTTP/SSE surface (PUT /budget-defaults extended, GET /pool-usage, pool.tally SSE event)
- [ ] 15.10 Web UI: project page tabbed cockpit
- [ ] 15.11 Web UI: directive detail pool pill + build form copy update
- [ ] 15.12 Phase close: live browser smoke + recordkeeping
```

- [ ] **Step 4: Verify `UPGRADE/plans/tier-15-budget-ux-overhaul.md` exists**

Authored at brainstorm time. If missing, author per the Tier 14 outline shape; cross-reference this implementation plan and the spec.

- [ ] **Step 5: Modify `.control/architecture/phase-plan.md`**

Add Phase 15 row at the bottom of the phases table. Update the summary text: "Phase 15 replaces the `[BUDGET]` askUser with a project-level budget cockpit, switching `maxTurns*` axes to directive-wide pools and adding an optional auto-increase policy (ADR 0034)."

- [ ] **Step 6: Modify `UPGRADE/ROADMAP.md`**

Bump intro: `Fourteen tiers → Fifteen tiers`. Add Tier 15 section after Tier 14 with done-criteria rows (mirror Tier 14's shape). First row: `- [x] U036 opened`. Second: `- [x] U037 opened`. Third: `- [x] U038 opened` (note: opened but deferred). All other rows unchecked.

- [ ] **Step 7: Modify `.control/progress/STATE.md`**

Flip cursor: `arc-complete (tenth time)` → `Phase 15 (budget-ux-overhaul) active at 15.1`. Update "Current step" to `15.1`. Update "Next action" to point at 15.2 (ADR work).

- [ ] **Step 8: Verify nothing builds-broken**

Run from repo root:

```bash
pnpm build
```

Expected: clean (no code changed yet, just docs and STATE).

- [ ] **Step 9: Commit**

```bash
git add UPGRADE/ISSUES.md UPGRADE/ROADMAP.md UPGRADE/plans/tier-15-budget-ux-overhaul.md \
  docs/superpowers/plans/2026-05-24-tier-15-budget-ux-overhaul.md \
  .control/phases/phase-15-budget-ux-overhaul/ \
  .control/architecture/phase-plan.md \
  .control/progress/STATE.md

git commit -m "chore(phase-15): scaffold tier 15 budget UX overhaul"
```

---

## Task 2: ADR 0034 + Status update on ADR 0032 + amendment blocks on ADR 0030 and ADR 0020

**Files:**

- Create: `docs/decisions/0034-budget-pool-paradigm.md`
- Modify: `docs/decisions/INDEX.md` (add 0034 row; flip 0032 status note)
- Modify: `docs/decisions/0032-budget-ux-paradigm.md` (Status line edit only)
- Modify: `docs/decisions/0030-pending-question-auto-answer.md` (amendment block)
- Modify: `docs/decisions/0020-limits.md` (amendment block)
- Modify: `docs/ARCHITECTURE.md` (ADR count 33 → 34)

---

- [ ] **Step 1: Author ADR 0034**

Follow factory5 ADR shape (read `docs/decisions/0033-wiki-readiness-critique-loop.md` for layout). Headline: `# ADR 0034 — Budget Pool Paradigm`. Six-part decision per brainstorm spec § "Decisions":

1. Pool semantic for the three `maxTurns*` axes; per-class aggregation; cap-resolution rule `max(project.json, payload.budgets, BUDGET_DEFAULTS)` per axis.
2. Live re-resolve from `project.json` (monotonic-up only — per-directive floor preserved); project page is the single editable source.
3. Pool exhaustion parks the directive with structured `blockedReason` — no askUser, no parser, no auto-answer policy for budget axes.
4. Linear bump rule (+default per accept / per auto-bump iteration); no `BUMP_BUCKETS`, no `MAX_TURNS_CLAMP_*` constants.
5. Per-project auto-increase toggle with safety multiplier ceiling; default off; default multiplier 5×.
6. Planner stops emitting `task.maxTurns`; the field stays in `taskSchema` as optional + ignored for backward read-back.

Status: `Accepted`. Date: `2026-05-24`. Header: `Supersedes: 0032`. Body uses Context / Decision / Consequences / Alternatives shape.

- [ ] **Step 2: Add ADR 0034 to `docs/decisions/INDEX.md`**

Insert row after 0033 with the title and date. Update ADR 0032's row to append a note: `(superseded by 0034)`.

- [ ] **Step 3: Edit ADR 0032 Status line only**

In `docs/decisions/0032-budget-ux-paradigm.md`, find the Status line at the top (typically `**Status:** Accepted` or similar) and change it to `**Status:** Superseded by ADR 0034 (2026-05-24)`. **Do not edit any other line of ADR 0032.** Per CLAUDE.md "do not edit accepted ADRs — supersede with a new one"; the Status line is the documented exception for supersedure.

- [ ] **Step 4: Append amendment block to ADR 0030**

At the bottom of `docs/decisions/0030-pending-question-auto-answer.md`, append (verbatim):

```markdown
## Amendment — 2026-05-24 (Tier 15)

The `[BUDGET]` marker branch added in Tier 12 (ADR 0032) and extended in the prior Tier 14 amendment block is removed. Per ADR 0034 (Budget Pool Paradigm), the `[BUDGET]` askUser is no longer created — pool exhaustion now parks the directive with a structured `blockedReason` and the operator unblocks via the project page Live tab. The auto-answer dispatcher now handles only the `[CRITIC]` marker (Tier 14) and generic LLM dispatch. `pickBudgetEscalationAnswer` helper deleted along with `packages/brain/src/budget-escalation.ts`. No supersedure — this is the consequence of ADR 0034's `[BUDGET]` deletion, mechanically removing a dependency.
```

- [ ] **Step 5: Append amendment block to ADR 0020**

```markdown
## Amendment — 2026-05-24 (Tier 15)

Pool semantics across `maxUsd`, `maxSteps`, `maxTurnsScaffolder`, `maxTurnsBuilder`, `maxTurnsFixer` are now unified per ADR 0034. ADR 0020's `maxUsd` / `maxSteps` already pool directive-wide; the three `maxTurns*` axes were per-task pre-Tier-15. ADR 0034 is the canonical reference for the pool model going forward.
```

- [ ] **Step 6: Bump ADR count in `docs/ARCHITECTURE.md`**

Find the line "ADR 0001-0033" (or current count) and bump to "ADR 0001-0034". Search for any other ADR-count references (e.g., a sentence saying "the project has 33 accepted ADRs") and update.

- [ ] **Step 7: Verify lint + format clean**

```bash
pnpm lint && pnpm format:check
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add docs/decisions/0034-budget-pool-paradigm.md \
  docs/decisions/INDEX.md \
  docs/decisions/0032-budget-ux-paradigm.md \
  docs/decisions/0030-pending-question-auto-answer.md \
  docs/decisions/0020-limits.md \
  docs/ARCHITECTURE.md

git commit -m "docs(15.2): ADR 0034 budget pool paradigm + ADR 0032 superseded + 0030/0020 amendments"
```

---

## Task 3: Core — project-level config scalars

**Files:**

- Modify: `packages/core/src/schemas.ts` — extend the appropriate metadata schema
- Modify: `packages/core/src/schemas.test.ts` — tests for new fields
- Modify: `packages/core/src/budget-defaults.ts` — define `axisForAgent` here (moved from `budget-escalation.ts`); export

---

- [ ] **Step 1: Inspect existing schema layout**

Read `packages/core/src/schemas.ts` to find where `projectMetadataSchema` (or equivalent) is defined. Note the existing `metadata: Record<string, unknown>` pattern — if metadata is fully open today, the schema work shifts to adding a typed accessor rather than constraining the schema.

- [ ] **Step 2: Write failing tests for `autoIncreaseBudgets` + `autoIncreaseCeilingMultiplier` schema acceptance**

In `packages/core/src/schemas.test.ts` (or a new test file if the metadata schema lacks a test file today), add:

```ts
describe('projectMetadataSchema — Tier 15 scalars', () => {
  it('accepts autoIncreaseBudgets: true', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3...',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: {
        autoIncreaseBudgets: true,
        autoIncreaseCeilingMultiplier: 5,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts autoIncreaseCeilingMultiplier: 1 (minimum)', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3...',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseCeilingMultiplier: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects autoIncreaseCeilingMultiplier: 0', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3...',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseCeilingMultiplier: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative autoIncreaseCeilingMultiplier', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3...',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseCeilingMultiplier: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('treats both fields as optional', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3...',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts autoIncreaseBudgets: false', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3...',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseBudgets: false },
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

```bash
pnpm --filter @factory5/core test schemas
```

Expected: most tests pass (today's metadata is `Record<string, unknown>` so anything goes), but the `rejects` tests fail because there's no constraint on `autoIncreaseCeilingMultiplier`.

- [ ] **Step 4: Define the typed metadata extension**

If the project-metadata `metadata` field is `Record<string, unknown>` today, add a typed sub-schema for the Tier-15 fields. Two implementation options:

- **Option A (preferred):** Define a separate `projectTier15MetadataSchema` (or similar) that extends the open metadata with typed slots:

  ```ts
  // packages/core/src/schemas.ts
  export const projectTier15MetadataSchema = z.object({
    autoIncreaseBudgets: z.boolean().optional(),
    autoIncreaseCeilingMultiplier: z.number().min(1).optional(),
  }).passthrough();  // preserves unrelated metadata keys

  // Inside projectMetadataSchema, replace `metadata: z.record(z.unknown())` with:
  metadata: projectTier15MetadataSchema,
  ```

- **Option B:** Keep `metadata: z.record(z.unknown())` open at the schema layer; enforce the type via a separate `parseProjectTier15Metadata` helper called at every reader site. Simpler but pushes validation downstream.

Use Option A. It catches malformed `autoIncreaseCeilingMultiplier` values at the schema boundary (e.g., a typo writing -1 into `project.json` would be caught at read time rather than at first auto-bump).

- [ ] **Step 5: Define `axisForAgent` helper in `packages/core/src/budget-defaults.ts`**

The helper moves from `packages/brain/src/budget-escalation.ts` (which is deleted in Task 8) to `@factory5/core` because two consumers will use it in Tier 15: `pool-usage.ts` (for per-class aggregation) and the pool dispatcher in `pool.ts`. Having it in core avoids a brain-internal dependency.

```ts
// packages/core/src/budget-defaults.ts
/**
 * Map an agent class to the maxTurns* pool axis it draws from.
 * Returns undefined for non-tool-using agents (e.g., critic, planner —
 * those don't draw against a turn pool).
 */
export type MaxTurnsAxis = 'maxTurnsScaffolder' | 'maxTurnsBuilder' | 'maxTurnsFixer';

const AGENT_TO_AXIS: Record<string, MaxTurnsAxis | undefined> = {
  scaffolder: 'maxTurnsScaffolder',
  builder: 'maxTurnsBuilder',
  fixer: 'maxTurnsFixer',
};

export function axisForAgent(agent: string): MaxTurnsAxis | undefined {
  return AGENT_TO_AXIS[agent];
}
```

Export from `packages/core/src/index.ts`.

- [ ] **Step 6: Run tests to verify GREEN**

```bash
pnpm --filter @factory5/core test
```

Expected: all pass.

- [ ] **Step 7: Run build to catch downstream type breakage**

```bash
pnpm build
```

Expected: clean. If `@factory5/state` or `@factory5/wiki` or `@factory5/brain` fails type-check on the schema change, surface the failures and address in the appropriate Task before committing.

- [ ] **Step 8: Lint + format clean**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts \
  packages/core/src/budget-defaults.ts packages/core/src/index.ts

git commit -m "feat(15.3): core schema scalars for auto-increase + axisForAgent helper"
```

---

## Task 4: Wiki — project-metadata reads/writes for new scalars; delete `resolveDirectivePayloadBudgets`

**Files:**

- Modify: `packages/wiki/src/project-metadata.ts`
- Modify: `packages/wiki/src/project-metadata.test.ts`
- Modify: `packages/wiki/src/index.ts` (drop the `resolveDirectivePayloadBudgets` re-export if any)
- Check: `packages/daemon/src/server.ts` for any importers of `resolveDirectivePayloadBudgets` — Tier 13.5 plumbing

---

- [ ] **Step 1: Read existing `project-metadata.ts`**

Note the current shape of `ProjectMetadata` and `loadOrCreateProjectMetadata`. The `metadata` field is currently `Record<string, unknown>`. Tier 15 narrows it via the schema work in Task 3.

- [ ] **Step 2: Write failing tests for round-trip of new scalars**

In `packages/wiki/src/project-metadata.test.ts`:

```ts
describe('project-metadata — Tier 15 scalars', () => {
  it('round-trips autoIncreaseBudgets and autoIncreaseCeilingMultiplier', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'factory5-pm-t15-'));
    try {
      const written = await writeProjectMetadata(dir, {
        id: '01KSB8C3...',
        name: 'pythonetl',
        createdAt: '2026-05-23T20:28:06.332Z',
        factoryVersion: '0.x',
        metadata: {
          language: 'python',
          autoIncreaseBudgets: true,
          autoIncreaseCeilingMultiplier: 5,
        },
      });
      expect(written.metadata.autoIncreaseBudgets).toBe(true);
      expect(written.metadata.autoIncreaseCeilingMultiplier).toBe(5);

      const reread = await loadOrCreateProjectMetadata(dir, 'pythonetl');
      expect(reread.metadata.autoIncreaseBudgets).toBe(true);
      expect(reread.metadata.autoIncreaseCeilingMultiplier).toBe(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined for missing new scalars (no default coercion at read time)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'factory5-pm-t15-defaults-'));
    try {
      await writeProjectMetadata(dir, {
        id: '01KSB8C3...',
        name: 'pythonetl',
        createdAt: '2026-05-23T20:28:06.332Z',
        factoryVersion: '0.x',
        metadata: { language: 'python' },
      });
      const reread = await loadOrCreateProjectMetadata(dir, 'pythonetl');
      expect(reread.metadata.autoIncreaseBudgets).toBeUndefined();
      expect(reread.metadata.autoIncreaseCeilingMultiplier).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves unrelated metadata keys on write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'factory5-pm-t15-preserve-'));
    try {
      await writeProjectMetadata(dir, {
        id: '01KSB8C3...',
        name: 'pythonetl',
        createdAt: '2026-05-23T20:28:06.332Z',
        factoryVersion: '0.x',
        metadata: {
          language: 'python',
          customKey: 'custom-value',
          autoIncreaseBudgets: true,
        },
      });
      const reread = await loadOrCreateProjectMetadata(dir, 'pythonetl');
      expect(reread.metadata.customKey).toBe('custom-value');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed autoIncreaseCeilingMultiplier (write side)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'factory5-pm-t15-reject-'));
    try {
      await expect(writeProjectMetadata(dir, {
        id: '01KSB8C3...',
        name: 'pythonetl',
        createdAt: '2026-05-23T20:28:06.332Z',
        factoryVersion: '0.x',
        metadata: { autoIncreaseCeilingMultiplier: -1 },
      })).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

```bash
pnpm --filter @factory5/wiki test project-metadata
```

Expected: the `autoIncreaseCeilingMultiplier: -1` rejection test fails (today's schema is open).

- [ ] **Step 4: Verify `writeProjectMetadata` uses the typed schema from Task 3**

`writeProjectMetadata` likely calls `projectMetadataSchema.parse(input)` before writing. The Task 3 schema extension automatically tightens validation. If `writeProjectMetadata` bypasses schema validation (writes raw `unknown` to disk), add a `.parse(input)` call.

- [ ] **Step 5: Identify and delete `resolveDirectivePayloadBudgets`**

```bash
grep -rn 'resolveDirectivePayloadBudgets' G:/Projects/Large-Projects/factory/factory5/packages/
```

Expected: helper defined in `packages/wiki/src/project-metadata.ts`; called from `packages/daemon/src/server.ts` (Tier 13.5 plumbing). Both will be replaced by the live-re-resolve mechanism in Task 5/7.

Delete the helper function from `project-metadata.ts`. Delete any companion tests. Find each importer in `server.ts` and either inline the simpler resolution (`payloadBudgets ?? projectBudgets ?? defaults`) OR mark the call site as `// REMOVED IN TIER 15 — see pool-usage.ts for live re-resolve` and replace the call with a no-op that doesn't break the existing per-build override behavior in Tier 13's tests. The daemon test from Task 9 will lock in the new behavior.

- [ ] **Step 6: Run tests to verify GREEN**

```bash
pnpm --filter @factory5/wiki test
pnpm --filter @factory5/daemon test
```

Expected: wiki tests pass; daemon tests that referenced `resolveDirectivePayloadBudgets` need updating (will be locked in Task 9 — for now ensure no compile errors).

- [ ] **Step 7: Run build**

```bash
pnpm build
```

- [ ] **Step 8: Lint + format clean**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 9: Commit**

```bash
git add packages/wiki/src/project-metadata.ts packages/wiki/src/project-metadata.test.ts \
  packages/wiki/src/index.ts \
  packages/daemon/src/server.ts

git commit -m "feat(15.4): project-metadata round-trip + delete resolveDirectivePayloadBudgets"
```

---

## Task 5: Brain — `computePoolUsage` helper

**Files:**

- Create: `packages/brain/src/pool-usage.ts`
- Create: `packages/brain/src/pool-usage.test.ts`

---

- [ ] **Step 1: Write failing tests for `computePoolUsage`**

```ts
// packages/brain/src/pool-usage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ulid } from 'ulid';

import { computePoolUsage } from './pool-usage.js';
import { runMigrations } from '@factory5/state';
import { BUDGET_DEFAULTS } from '@factory5/core/budgets';

describe('computePoolUsage', () => {
  let db: Database.Database;
  const projectBudgets = {
    budgetDefaults: {
      maxUsd: 100,
      maxSteps: 500,
      maxTurnsScaffolder: 120,
      maxTurnsBuilder: 240,
      maxTurnsFixer: 80,
    },
  };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('returns 0 used for an empty directive', () => {
    const directiveId = ulid();
    db.prepare(`INSERT INTO directives (id, source, principal, channel_ref, intent, payload, autonomy, created_at, status)
      VALUES (?, 'cli', 'test', 'test-ref', 'build', '{}', 'autonomous', ?, 'running')`).run(directiveId, new Date().toISOString());

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.used).toBe(0);
    expect(pool.perAxis.maxTurnsBuilder.cap).toBe(240);
    expect(pool.perAxis.maxTurnsBuilder.status).toBe('ok');
    expect(pool.perAxis.maxTurnsBuilder.tasks).toEqual([]);
  });

  it('sums turnsUsed across builder tasks', () => {
    const directiveId = ulid();
    db.prepare(`INSERT INTO directives (id, source, principal, channel_ref, intent, payload, autonomy, created_at, status)
      VALUES (?, 'cli', 'test', 'test-ref', 'build', '{}', 'autonomous', ?, 'running')`).run(directiveId, new Date().toISOString());

    // Insert 3 builder tasks with turnsUsed
    const planId = ulid();
    db.prepare(`INSERT INTO plans (id, directive_id, payload, created_at) VALUES (?, ?, '{}', ?)`)
      .run(planId, directiveId, new Date().toISOString());

    for (const [title, turns] of [['Task A', 60], ['Task B', 80], ['Task C', 45]]) {
      const taskId = ulid();
      db.prepare(`INSERT INTO tasks (id, directive_id, plan_id, title, agent, category, status, attempts, started_at, finished_at, result_json)
        VALUES (?, ?, ?, ?, 'builder', 'deep', 'complete', 1, ?, ?, ?)`)
        .run(taskId, directiveId, planId, title, new Date().toISOString(), new Date().toISOString(),
             JSON.stringify({ exitCode: 0, turnsUsed: turns, filesChanged: [], findingsRaised: [], signalsEmitted: [], durationMs: 1000 }));
    }

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.used).toBe(60 + 80 + 45);
    expect(pool.perAxis.maxTurnsBuilder.tasks).toHaveLength(3);
    expect(pool.perAxis.maxTurnsBuilder.tasks[0].contribution).toBe(60);
  });

  it('isolates per-class — builder tasks do not count toward fixer pool', () => {
    const directiveId = ulid();
    // ... insert directive + 1 builder task with 100 turns + 1 fixer task with 50 turns
    // assert maxTurnsBuilder.used === 100, maxTurnsFixer.used === 50
  });

  it('rolls up USD across model_usage rows scoped to directive_id', () => {
    // ... insert directive + 3 model_usage rows with cost_usd 0.5, 0.3, 0.7
    // assert maxUsd.used === 1.5
  });

  it('uses max(project, payload.budgets, BUDGET_DEFAULTS) for cap', () => {
    const directiveId = ulid();
    db.prepare(`INSERT INTO directives (id, source, principal, channel_ref, intent, payload, autonomy, created_at, status)
      VALUES (?, 'cli', 'test', 'test-ref', 'build', ?, 'autonomous', ?, 'running')`)
      .run(directiveId, JSON.stringify({ budgets: { maxTurnsBuilder: 500 } }), new Date().toISOString());

    const pool = computePoolUsage(db, directiveId, {
      budgetDefaults: { maxTurnsBuilder: 100 },
    });

    // max(project=100, payload=500, default=80) = 500
    expect(pool.perAxis.maxTurnsBuilder.cap).toBe(500);
  });

  it('falls back to BUDGET_DEFAULTS when neither project nor payload set the axis', () => {
    const directiveId = ulid();
    db.prepare(`INSERT INTO directives (id, source, principal, channel_ref, intent, payload, autonomy, created_at, status)
      VALUES (?, 'cli', 'test', 'test-ref', 'build', '{}', 'autonomous', ?, 'running')`).run(directiveId, new Date().toISOString());

    const pool = computePoolUsage(db, directiveId, { budgetDefaults: {} });

    expect(pool.perAxis.maxTurnsBuilder.cap).toBe(BUDGET_DEFAULTS.maxTurnsBuilder.value);
  });

  it('flags status=exhausted when used >= cap', () => {
    // ... setup task with 240 turns under cap 240
    // assert status === 'exhausted', pct === 100
  });

  it('flags status=warn when used >= 80% of cap', () => {
    // ... setup task with 200 turns under cap 240 (83%)
    // assert status === 'warn'
  });

  it('returns parkedReason when directive is blocked with pool-exhausted', () => {
    const directiveId = ulid();
    db.prepare(`INSERT INTO directives (id, source, principal, channel_ref, intent, payload, autonomy, created_at, status, blocked_reason)
      VALUES (?, 'cli', 'test', 'test-ref', 'build', '{}', 'autonomous', ?, 'blocked', ?)`)
      .run(directiveId, new Date().toISOString(),
           JSON.stringify({ kind: 'pool-exhausted', axis: 'maxTurnsBuilder', usedAtPark: 240, capAtPark: 240 }));

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.parkedReason).toEqual({
      axis: 'maxTurnsBuilder',
      usedAtPark: 240,
      capAtPark: 240,
      nextBumpTo: 240 + 240,  // current cap + project default for that axis
    });
  });

  it('handles malformed blocked_reason gracefully (legacy free-text)', () => {
    const directiveId = ulid();
    db.prepare(`INSERT INTO directives (id, source, principal, channel_ref, intent, payload, autonomy, created_at, status, blocked_reason)
      VALUES (?, 'cli', 'test', 'test-ref', 'build', '{}', 'autonomous', ?, 'blocked', ?)`)
      .run(directiveId, new Date().toISOString(), 'cancelled-from-web-ui');

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.parkedReason).toBeUndefined();  // not a structured pool-exhausted reason
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

```bash
pnpm --filter @factory5/brain test pool-usage
```

Expected: all tests fail with "Cannot find module './pool-usage.js'".

- [ ] **Step 3: Implement `pool-usage.ts`**

```ts
// packages/brain/src/pool-usage.ts
/**
 * Tier 15 / ADR 0034 — derive a directive's live budget pool usage.
 *
 * Aggregates `tasks` (turn counts grouped by `agent`) + `model_usage` (USD/steps
 * summed across rows scoped to `directive_id`) and resolves each axis cap via
 * `max(projectBudgets[axis], payload.budgets[axis], BUDGET_DEFAULTS[axis].value)`.
 *
 * The pool is NOT stored — it is derived on every call. Cheap enough for the
 * brain's 250 ms serve poll tick and the daemon's `GET /pool-usage` endpoint.
 */

import { BUDGET_DEFAULTS, type BudgetAxisName, axisForAgent, type MaxTurnsAxis } from '@factory5/core/budgets';
import type { Database } from '@factory5/state';

export interface PoolTaskContribution {
  taskId: string;
  title: string;
  agent: string;
  contribution: number;
}

export interface PoolAxisUsage {
  used: number;
  cap: number;
  pct: number;
  tasks: PoolTaskContribution[];
  status: 'ok' | 'warn' | 'exhausted';
}

export interface ParkedReason {
  axis: string;
  usedAtPark: number;
  capAtPark: number;
  nextBumpTo: number;
}

export interface PoolUsage {
  directiveId: string;
  computedAt: string;
  perAxis: Record<BudgetAxisName, PoolAxisUsage>;
  parkedReason?: ParkedReason;
}

export interface ProjectBudgetsLike {
  budgetDefaults: Partial<Record<BudgetAxisName, number>>;
  autoIncreaseBudgets?: boolean;
  autoIncreaseCeilingMultiplier?: number;
}

const POOL_AXES: ReadonlyArray<BudgetAxisName> = [
  'maxUsd',
  'maxSteps',
  'maxTurnsScaffolder',
  'maxTurnsBuilder',
  'maxTurnsFixer',
] as const;

const WARN_PCT = 80;

export function computePoolUsage(
  db: Database,
  directiveId: string,
  projectBudgets: ProjectBudgetsLike,
): PoolUsage {
  const directiveRow = db
    .prepare(`SELECT payload, status, blocked_reason FROM directives WHERE id = ?`)
    .get(directiveId) as { payload: string; status: string; blocked_reason: string | null } | undefined;

  if (directiveRow === undefined) {
    throw new Error(`computePoolUsage: directive ${directiveId} not found`);
  }

  const payloadBudgets: Partial<Record<BudgetAxisName, number>> =
    safeParseJson(directiveRow.payload)?.budgets ?? {};

  const perAxis = {} as Record<BudgetAxisName, PoolAxisUsage>;
  for (const axis of POOL_AXES) {
    perAxis[axis] = computeAxis(db, directiveId, axis, projectBudgets, payloadBudgets);
  }

  const parkedReason = directiveRow.status === 'blocked'
    ? parseParkedReason(directiveRow.blocked_reason, projectBudgets)
    : undefined;

  return {
    directiveId,
    computedAt: new Date().toISOString(),
    perAxis,
    ...(parkedReason !== undefined ? { parkedReason } : {}),
  };
}

function computeAxis(
  db: Database,
  directiveId: string,
  axis: BudgetAxisName,
  projectBudgets: ProjectBudgetsLike,
  payloadBudgets: Partial<Record<BudgetAxisName, number>>,
): PoolAxisUsage {
  const cap = resolveEffectiveCap(axis, projectBudgets, payloadBudgets);
  const { used, tasks } = aggregateUsed(db, directiveId, axis);
  const pct = cap === 0 ? 0 : Math.min(100, (used / cap) * 100);
  const status: PoolAxisUsage['status'] =
    used >= cap ? 'exhausted' : pct >= WARN_PCT ? 'warn' : 'ok';
  return { used, cap, pct, tasks, status };
}

function resolveEffectiveCap(
  axis: BudgetAxisName,
  projectBudgets: ProjectBudgetsLike,
  payloadBudgets: Partial<Record<BudgetAxisName, number>>,
): number {
  const project = projectBudgets.budgetDefaults[axis] ?? 0;
  const payload = payloadBudgets[axis] ?? 0;
  const fallback = BUDGET_DEFAULTS[axis]?.value ?? 0;
  return Math.max(project, payload, fallback);
}

function aggregateUsed(
  db: Database,
  directiveId: string,
  axis: BudgetAxisName,
): { used: number; tasks: PoolTaskContribution[] } {
  switch (axis) {
    case 'maxUsd': {
      const row = db
        .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM model_usage WHERE directive_id = ?`)
        .get(directiveId) as { total: number };
      return { used: row.total, tasks: [] };
    }
    case 'maxSteps': {
      const row = db
        .prepare(`SELECT COALESCE(SUM(steps), 0) AS total FROM model_usage WHERE directive_id = ?`)
        .get(directiveId) as { total: number };
      return { used: row.total, tasks: [] };
    }
    case 'maxTurnsScaffolder':
    case 'maxTurnsBuilder':
    case 'maxTurnsFixer': {
      const agent = axis === 'maxTurnsScaffolder' ? 'scaffolder'
                  : axis === 'maxTurnsBuilder' ? 'builder'
                  : 'fixer';
      const rows = db
        .prepare(`SELECT id, title, agent, result_json FROM tasks WHERE directive_id = ? AND agent = ?`)
        .all(directiveId, agent) as Array<{ id: string; title: string; agent: string; result_json: string | null }>;
      const tasks: PoolTaskContribution[] = [];
      let used = 0;
      for (const row of rows) {
        const result = row.result_json !== null ? safeParseJson(row.result_json) : null;
        const turnsUsed = typeof result?.turnsUsed === 'number' ? result.turnsUsed : 0;
        tasks.push({ taskId: row.id, title: row.title, agent: row.agent, contribution: turnsUsed });
        used += turnsUsed;
      }
      return { used, tasks };
    }
    default:
      return { used: 0, tasks: [] };
  }
}

function parseParkedReason(
  raw: string | null,
  projectBudgets: ProjectBudgetsLike,
): ParkedReason | undefined {
  if (raw === null) return undefined;
  const parsed = safeParseJson(raw);
  if (parsed === null || typeof parsed !== 'object') return undefined;
  if (parsed.kind !== 'pool-exhausted') return undefined;
  const axis = parsed.axis as string;
  const usedAtPark = Number(parsed.usedAtPark);
  const capAtPark = Number(parsed.capAtPark);
  if (!Number.isFinite(usedAtPark) || !Number.isFinite(capAtPark)) return undefined;
  const projectDefault = projectBudgets.budgetDefaults[axis as BudgetAxisName] ?? BUDGET_DEFAULTS[axis as BudgetAxisName]?.value ?? 0;
  return {
    axis,
    usedAtPark,
    capAtPark,
    nextBumpTo: capAtPark + projectDefault,
  };
}

function safeParseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify GREEN**

```bash
pnpm --filter @factory5/brain test pool-usage
```

Expected: all ~10 tests pass.

- [ ] **Step 5: Verify build clean**

```bash
pnpm build
```

- [ ] **Step 6: Lint + format**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/pool-usage.ts packages/brain/src/pool-usage.test.ts

git commit -m "feat(15.5): brain computePoolUsage helper"
```

---

## Task 6: Brain — `pool-resume` chokidar watcher

**Files:**

- Create: `packages/brain/src/pool-resume.ts`
- Create: `packages/brain/src/pool-resume.test.ts`

---

- [ ] **Step 1: Verify chokidar availability**

```bash
pnpm --filter @factory5/brain why chokidar
```

If not present as a direct dep, add it:

```bash
pnpm --filter @factory5/brain add chokidar
```

- [ ] **Step 2: Write failing tests for `pool-resume`**

Test surface: watcher registration, write-event triggers re-check, parked directive with headroom flips to running, parked still-exhausted stays blocked, multiple parked directives on same project all resume, watcher teardown.

```ts
// packages/brain/src/pool-resume.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createPoolResume } from './pool-resume.js';
import { runMigrations } from '@factory5/state';

describe('pool-resume', () => {
  let db: Database.Database;
  let projectPath: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-poolresume-'));
    await mkdir(join(projectPath, '.factory'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('flips parked directive to running when project.json cap is raised', async () => {
    // Insert parked directive with blocked_reason pool-exhausted
    // ... write project.json with maxTurnsBuilder: 80
    // Start watcher, wait for ready event
    // Mutate project.json to maxTurnsBuilder: 240
    // Wait for re-check tick
    // Assert directive status flipped to 'running'
  });

  it('does not flip when project.json cap is still below used', async () => {
    // ... parked directive with used=240, cap=240
    // Write project.json maxTurnsBuilder: 100 (below used)
    // Wait
    // Assert directive still blocked
  });

  it('flips multiple parked directives on the same project', async () => {
    // ... 3 parked directives on same project
    // Mutate project.json
    // Wait
    // Assert all 3 flipped to running
  });

  it('does not affect directives on other projects', async () => {
    // Two different project dirs; parked directive on each
    // Mutate only project A's project.json
    // Wait
    // Assert project A's directive flipped; project B's still blocked
  });

  it('lazy-adds watcher on first directive creation', async () => {
    const poolResume = createPoolResume({ db, log: vi.fn() });
    expect(poolResume.activeWatchers()).toHaveLength(0);

    await poolResume.registerProject(projectPath);
    expect(poolResume.activeWatchers()).toHaveLength(1);
  });

  it('tears down watcher when last directive on project terminates', async () => {
    // ... register project, then call unregisterProject after all directives done
    // Assert watcher.close() called
  });

  it('debounces rapid project.json writes', async () => {
    // ... write project.json 5 times in 100ms
    // Assert re-check fires only once or twice (not 5)
  });

  it('handles malformed project.json gracefully (logs and skips)', async () => {
    // Write invalid JSON to project.json
    // Assert no throw; warn logged
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

```bash
pnpm --filter @factory5/brain test pool-resume
```

Expected: all fail with "Cannot find module './pool-resume.js'".

- [ ] **Step 4: Implement `pool-resume.ts`**

```ts
// packages/brain/src/pool-resume.ts
/**
 * Tier 15 / ADR 0034 — chokidar watcher for project.json writes.
 *
 * On project.json mutation, re-checks any parked directives on that project
 * and flips them back to running if the recomputed pool cap has headroom.
 *
 * Lifecycle:
 *   - registerProject(projectPath) — lazy-add when first directive creates on this project.
 *   - unregisterProject(projectPath) — tear down when no active directives remain.
 *
 * Idempotent — re-flipping an already-running directive is a no-op.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { join } from 'node:path';

import { computePoolUsage } from './pool-usage.js';
import { loadOrCreateProjectMetadata } from '@factory5/wiki';
import type { Database } from '@factory5/state';
import type { Logger } from '@factory5/logger';

const DEBOUNCE_MS = 250;

export interface PoolResumeDeps {
  db: Database;
  log: Logger;
  /** Test injection: override the chokidar factory. */
  watcherFactory?: (path: string) => FSWatcher;
  /** Test injection: override debounce. */
  debounceMs?: number;
}

export interface PoolResume {
  registerProject(projectPath: string): void;
  unregisterProject(projectPath: string): Promise<void>;
  activeWatchers(): string[];
  shutdown(): Promise<void>;
}

export function createPoolResume(deps: PoolResumeDeps): PoolResume {
  const watchers = new Map<string, { watcher: FSWatcher; timer?: NodeJS.Timeout }>();
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;

  function registerProject(projectPath: string): void {
    if (watchers.has(projectPath)) return;
    const target = join(projectPath, '.factory', 'project.json');
    const watcher = deps.watcherFactory !== undefined
      ? deps.watcherFactory(target)
      : chokidar.watch(target, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100 } });
    const entry: { watcher: FSWatcher; timer?: NodeJS.Timeout } = { watcher };
    watcher.on('change', () => {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        void recheckParkedDirectives(deps, projectPath);
      }, debounceMs);
    });
    watcher.on('error', (err) => {
      deps.log.warn({ err, projectPath }, 'pool-resume: watcher error');
    });
    watchers.set(projectPath, entry);
    deps.log.info({ projectPath }, 'pool-resume: watcher registered');
  }

  async function unregisterProject(projectPath: string): Promise<void> {
    const entry = watchers.get(projectPath);
    if (entry === undefined) return;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    await entry.watcher.close();
    watchers.delete(projectPath);
    deps.log.info({ projectPath }, 'pool-resume: watcher torn down');
  }

  function activeWatchers(): string[] {
    return Array.from(watchers.keys());
  }

  async function shutdown(): Promise<void> {
    for (const path of activeWatchers()) {
      await unregisterProject(path);
    }
  }

  return { registerProject, unregisterProject, activeWatchers, shutdown };
}

async function recheckParkedDirectives(deps: PoolResumeDeps, projectPath: string): Promise<void> {
  let projectBudgets;
  try {
    const metadata = await loadOrCreateProjectMetadata(projectPath, '');
    projectBudgets = {
      budgetDefaults: (metadata.metadata?.budgetDefaults ?? {}) as Partial<Record<string, number>>,
      autoIncreaseBudgets: metadata.metadata?.autoIncreaseBudgets as boolean | undefined,
      autoIncreaseCeilingMultiplier: metadata.metadata?.autoIncreaseCeilingMultiplier as number | undefined,
    };
  } catch (err) {
    deps.log.warn({ err, projectPath }, 'pool-resume: failed to load project.json');
    return;
  }

  const parkedRows = deps.db
    .prepare(`SELECT id FROM directives
      WHERE status = 'blocked'
        AND blocked_reason IS NOT NULL
        AND json_extract(blocked_reason, '$.kind') = 'pool-exhausted'
        AND json_extract(payload, '$.projectPath') = ?`)
    .all(projectPath) as Array<{ id: string }>;

  for (const row of parkedRows) {
    const pool = computePoolUsage(deps.db, row.id, projectBudgets as any);
    const axis = pool.parkedReason?.axis;
    if (axis === undefined) continue;
    if (pool.perAxis[axis as keyof typeof pool.perAxis].used < pool.perAxis[axis as keyof typeof pool.perAxis].cap) {
      // Re-enqueue: clear blocked_reason, flip to running. The serve loop's
      // 250 ms poll tick will discover the running directive on its next pass
      // and re-claim it. (Doorbell `onWake` is wired from the IPC
      // `/directives/notify` route; pool-resume doesn't have direct access to
      // it from this helper. Polling within ≤250 ms is acceptable per spec.)
      deps.db.prepare(`UPDATE directives SET status = 'running', blocked_reason = NULL WHERE id = ?`).run(row.id);
      deps.log.info({ directiveId: row.id, axis, newCap: pool.perAxis[axis as keyof typeof pool.perAxis].cap },
                    'pool-resume: directive re-enqueued after cap raise');
    }
  }
}
```

- [ ] **Step 5: Run tests to verify GREEN**

```bash
pnpm --filter @factory5/brain test pool-resume
```

Expected: ~8 tests pass.

- [ ] **Step 6: Lint + format + build**

```bash
pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/pool-resume.ts packages/brain/src/pool-resume.test.ts \
  packages/brain/package.json packages/brain/pnpm-lock.yaml

git commit -m "feat(15.6): brain pool-resume chokidar watcher"
```

---

## Task 7: Brain — pool-driven dispatcher rewrite

**Files:**

- Modify: `packages/brain/src/pool.ts` (replace per-task retry-loop)
- Modify: `packages/brain/src/pool.test.ts` (or whatever the existing test file is)
- Modify: `packages/brain/src/planner.ts` (drop `task.maxTurns` emit instruction)
- Modify: `packages/brain/src/worker.ts` (or `runWorker` host file — add `onTurnComplete` callback)
- Modify: `packages/brain/src/serve.ts` (wire `pool-resume` watcher startup)

This is the most invasive Task. The pool dispatcher is the central planner→worker orchestrator and the new pool-driven semantics replace the existing per-task retry-loop.

---

- [ ] **Step 1: Read existing `pool.ts` carefully**

Note the current dispatcher loop: `executeTask` runs `runWorker`; on `errorSubtype === 'error_max_turns'`, calls `escalateBudgetTrip` (in the to-be-deleted `budget-escalation.ts`); on `kind: 'accept' | 'custom'` retries with bumped `maxTurns`; on `kind: 'abort'` keeps the failed outcome. Replace with pool semantics.

Identify: heartbeat lifecycle (HEARTBEAT_INTERVAL_MS, tasksInflight.heartbeat); cancellation signal plumbing; result schema (`TaskResult` with `errorSubtype`).

- [ ] **Step 2: Write failing tests for the new pool dispatcher**

```ts
// packages/brain/src/pool.test.ts (extend)
describe('pool — pool-driven dispatcher (Tier 15)', () => {
  // ... setup helpers similar to existing pool tests

  it('pre-launch pool check blocks dispatch when axis is exhausted', async () => {
    // Setup: directive with maxTurnsBuilder cap 80, existing tasks summing 80 turns used
    // Dispatch a new builder task
    // Assert: worker NOT launched; directive flipped to blocked with structured reason
  });

  it('worker watchdog interrupts mid-turn when pool crosses', async () => {
    // Setup: cap 100, used 50 from prior tasks
    // Mock runWorker to call onTurnComplete after simulating 60 turns
    // Assert: onTurnComplete returns { interrupt: true } after turn 51 (used 50 + 51 = 101)
    // Assert: worker gets SIGTERM
  });

  it('auto-increase ON within ceiling: bump-then-retry succeeds', async () => {
    // Setup: cap 80, used 80; autoIncreaseBudgets=true, ceilingMultiplier=3 → ceiling 240
    // Mock bumpProjectCap and verify it's called with axis=maxTurnsBuilder, delta=80
    // Assert: pool re-checks against new cap 160; task launches; succeeds
  });

  it('auto-increase ON exceeding ceiling: parks instead of bumping', async () => {
    // Setup: cap 240, used 240; autoIncreaseBudgets=true, ceilingMultiplier=3 → ceiling 240
    // Dispatch new task
    // Assert: bumpProjectCap NOT called; directive parked; bumping would exceed ceiling
  });

  it('auto-increase OFF: parks on first exhaustion', async () => {
    // ... autoIncreaseBudgets=false
    // Assert: parks immediately, no bump
  });

  it('parked reason has correct axis, usedAtPark, capAtPark', async () => {
    // Setup: cap 240, used 240 across builder tasks
    // Dispatch
    // Assert: blocked_reason JSON has { kind: 'pool-exhausted', axis: 'maxTurnsBuilder', usedAtPark: 240, capAtPark: 240 }
  });

  it('emits pool.tally SSE event after task-completion', async () => {
    // Mock emit; complete a task
    // Assert: emit called with { kind: 'pool.tally', directiveId, perAxis, ... }
  });

  it('dependent tasks see blocked directive and skip launch (cascade prevention)', async () => {
    // Setup: parked directive; 3 unstarted tasks depending on the parked task
    // Tick the pool dispatcher
    // Assert: NO worker launched for the dependents; they stay pending
  });

  it('passes onTurnComplete callback to runWorker', async () => {
    // Mock runWorker, assert it received an onTurnComplete function
  });

  it('no errorSubtype === error_max_turns retry-loop remains', () => {
    // Grep / inspect the implementation to verify no Tier 12-style retry on max_turns
    // (Negative assertion that confirms deletion of the old behavior)
  });

  it('handles `maxTurnsScaffolder` axis correctly', async () => {
    // Same as builder but for scaffolder agent
  });

  it('handles `maxTurnsFixer` axis correctly', async () => {
    // Same as builder but for fixer agent
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

```bash
pnpm --filter @factory5/brain test pool
```

Expected: many fail. Old tests for the per-task retry-loop will also fail since we're about to delete that behavior — they'll be removed in Task 8.

- [ ] **Step 4: Implement the new dispatcher in `pool.ts`**

Replace the `while (true) { ... }` loop (around the existing `runWorker` invocation) with:

```ts
// Pre-launch pool check
const projectBudgets = await loadProjectBudgets(directive);
const pool = computePoolUsage(db, directive.id, projectBudgets);
const axis = axisForAgent(task.agent);

if (axis !== undefined && pool.perAxis[axis].used >= pool.perAxis[axis].cap) {
  await parkOrAutoIncrease({ db, directive, axis, pool, projectBudgets, emit });
  // Return synthesized failed result so the outer task-result flow stays uniform.
  return {
    result: {
      exitCode: 1,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 0,
      errorSubtype: 'pool-exhausted',
    },
  };
}

// Run the worker with the new onTurnComplete watchdog
let outcome;
try {
  outcome = await runWorker({
    task: currentTask,
    projectPath: plan.projectPath,
    registry,
    systemPrompt,
    userPrompt,
    findingRegistry: { ... },
    onTurnComplete: (): { interrupt: boolean } => {
      // Re-check pool against latest project.json + tasks state
      const live = computePoolUsage(db, directive.id, projectBudgets);
      const axisLive = axisForAgent(task.agent);
      if (axisLive === undefined) return { interrupt: false };
      return { interrupt: live.perAxis[axisLive].used >= live.perAxis[axisLive].cap };
    },
    ...(askUserConfig !== undefined ? { askUserConfig } : {}),
    ...(signal !== undefined ? { signal } : {}),
  });
} finally {
  clearInterval(hb);
}

// Emit pool.tally after every task-completion
const postPool = computePoolUsage(db, directive.id, projectBudgets);
emitLogLine(emit, directive.id, 'info', 'brain.pool',
  `pool: tally updated after task ${task.id}`,
  { perAxis: postPool.perAxis });
// Plus the SSE event (added in Task 9)
```

Define `parkOrAutoIncrease`:

```ts
async function parkOrAutoIncrease(opts: {
  db: Database;
  directive: Directive;
  axis: MaxTurnsAxis;
  pool: PoolUsage;
  projectBudgets: ProjectBudgetsLike;
  emit: EmitFn;
}): Promise<void> {
  const defaultDelta = BUDGET_DEFAULTS[opts.axis].value;
  const projectCap = opts.projectBudgets.budgetDefaults[opts.axis] ?? defaultDelta;
  const ceiling = projectCap * (opts.projectBudgets.autoIncreaseCeilingMultiplier ?? 5);
  const currentCap = opts.pool.perAxis[opts.axis].cap;

  if (opts.projectBudgets.autoIncreaseBudgets === true && currentCap < ceiling) {
    const newCap = currentCap + defaultDelta;
    await bumpProjectCap(opts.directive, opts.axis, newCap);
    emitLogLine(opts.emit, opts.directive.id, 'info', 'brain.pool',
      `pool: auto-bumped ${opts.axis} to ${newCap} (was ${currentCap})`,
      { axis: opts.axis, oldCap: currentCap, newCap });
    return;  // dispatcher loop re-runs pool check against new cap
  }

  const usedAtPark = opts.pool.perAxis[opts.axis].used;
  const blockedReason = JSON.stringify({
    kind: 'pool-exhausted',
    axis: opts.axis,
    usedAtPark,
    capAtPark: currentCap,
  });
  opts.db.prepare(`UPDATE directives SET status = 'blocked', blocked_reason = ? WHERE id = ?`)
    .run(blockedReason, opts.directive.id);
  emitLogLine(opts.emit, opts.directive.id, 'warn', 'brain.pool',
    `pool: ${opts.axis} exhausted at ${currentCap} — directive parked; raise cap on project page to resume`,
    { axis: opts.axis, capAtPark: currentCap, nextBumpTo: currentCap + defaultDelta });
}

async function bumpProjectCap(directive: Directive, axis: MaxTurnsAxis, newCap: number): Promise<void> {
  const projectPath = directive.payload?.projectPath as string | undefined;
  if (projectPath === undefined) {
    throw new Error(`bumpProjectCap: directive ${directive.id} has no projectPath`);
  }
  const metadata = await loadOrCreateProjectMetadata(projectPath, '');
  const newBudgets = {
    ...(metadata.metadata?.budgetDefaults ?? {}),
    [axis]: newCap,
  };
  await writeProjectMetadata(projectPath, {
    ...metadata,
    metadata: { ...metadata.metadata, budgetDefaults: newBudgets },
  });
}
```

Delete the existing `escalateBudgetTrip(...)` invocation site and the entire `while (true) { ... break }` loop wrapping it.

- [ ] **Step 5: Update `runWorker` signature to accept `onTurnComplete`**

In `packages/brain/src/worker.ts` (or wherever `runWorker` lives):

```ts
export interface RunWorkerOpts {
  // ... existing fields
  onTurnComplete?: () => { interrupt: boolean };
}

// Inside runWorker, after each completed turn (callback hooked to the existing
// turn-completion event from the worker subprocess):
if (opts.onTurnComplete !== undefined) {
  const decision = opts.onTurnComplete();
  if (decision.interrupt) {
    workerProcess.kill('SIGTERM');
    return { result: { exitCode: 1, filesChanged: [], findingsRaised: [], signalsEmitted: [], durationMs: ..., errorSubtype: 'pool-exhausted' } };
  }
}
```

- [ ] **Step 6: Drop `task.maxTurns` emit from planner**

In `packages/brain/src/planner.ts`, find the planner prompt section that instructs the planner to emit `maxTurns` per task. Remove the instruction. Keep the schema field optional (don't delete `task.maxTurns` from `taskSchema` — backward read-back of historical directives requires it).

- [ ] **Step 7: Wire `pool-resume` watcher into serve startup**

In `packages/brain/src/serve.ts`:

```ts
// At startup:
const poolResume = createPoolResume({ db: opts.db, log });

// When a directive is claimed and its project is known:
poolResume.registerProject(directive.payload.projectPath);

// At shutdown:
await poolResume.shutdown();
```

- [ ] **Step 8: Run tests to verify GREEN**

```bash
pnpm --filter @factory5/brain test pool
pnpm --filter @factory5/brain test planner
pnpm --filter @factory5/brain test worker
pnpm --filter @factory5/brain test serve
```

Expected: new tests pass. Old retry-loop tests in `pool.test.ts` may fail (they'll be removed in Task 8).

- [ ] **Step 9: Build clean**

```bash
pnpm build
```

Expected: compilation error if anything still imports `escalateBudgetTrip` or `parseBudgetEscalationAnswer`. Those will be deleted in Task 8.

- [ ] **Step 10: Lint + format**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 11: Commit**

```bash
git add packages/brain/src/pool.ts packages/brain/src/pool.test.ts \
  packages/brain/src/planner.ts \
  packages/brain/src/worker.ts \
  packages/brain/src/serve.ts

git commit -m "feat(15.7): brain pool-driven dispatcher + planner emit drop + watchdog wire-up"
```

---

## Task 8: Brain — delete `budget-escalation.ts` + `[BUDGET]` branch in `auto-answer.ts`

**Files:**

- DELETE: `packages/brain/src/budget-escalation.ts`
- DELETE: `packages/brain/src/budget-escalation.test.ts`
- Modify: `packages/brain/src/auto-answer.ts` (delete `[BUDGET]` branch + `pickBudgetEscalationAnswer` helper)
- Modify: `packages/brain/src/auto-answer.test.ts` (delete `[BUDGET]` tests)
- Modify: `packages/brain/src/pool.test.ts` (remove old retry-loop tests if any remain)

---

- [ ] **Step 1: Grep for any remaining imports of `budget-escalation.ts` exports**

```bash
grep -rn 'budget-escalation\|BUDGET_ESCALATION_MARKER\|parseBudgetEscalationAnswer\|escalateBudgetTrip\|escalateMaxUsdPerTaskTrip\|BUMP_BUCKETS\|MAX_TURNS_CLAMP' G:/Projects/Large-Projects/factory/factory5/packages/
```

Expected: hits in `auto-answer.ts` (handled below), and possibly stale references in tests. Address each.

- [ ] **Step 2: Delete the `[BUDGET]` branch from `auto-answer.ts`**

Open `packages/brain/src/auto-answer.ts`. Remove:

- Import line `import { BUDGET_ESCALATION_MARKER } from './budget-escalation.js';`
- The if-block starting with `if (q.question.startsWith(BUDGET_ESCALATION_MARKER)) { ... }` (~20 lines)
- The `pickBudgetEscalationAnswer` helper function at the bottom (~25 lines)

Keep:

- The `[CRITIC]` marker branch (Tier 14)
- The generic LLM dispatch path
- The race-mitigation sentinel + retry logic

- [ ] **Step 3: Delete the `[BUDGET]` tests from `auto-answer.test.ts`**

Find `describe('autoAnswerOne — [BUDGET] marker policy', ...)` (or similar) and delete the entire `describe` block. Keep `[CRITIC]` tests + generic LLM dispatch tests.

- [ ] **Step 4: Run remaining auto-answer tests to verify they still pass**

```bash
pnpm --filter @factory5/brain test auto-answer
```

Expected: `[CRITIC]` tests pass; generic LLM dispatch tests pass.

- [ ] **Step 5: Delete `budget-escalation.ts` and its test file**

```bash
git rm packages/brain/src/budget-escalation.ts packages/brain/src/budget-escalation.test.ts
```

- [ ] **Step 6: Run full brain test suite to confirm no stragglers**

```bash
pnpm --filter @factory5/brain test
```

Expected: all green. If anything else imported a deleted symbol, fix the importer (likely a test file in `pool.test.ts` from the old retry-loop tests — delete those tests too).

- [ ] **Step 7: Build clean**

```bash
pnpm build
```

- [ ] **Step 8: Lint + format**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 9: Commit**

```bash
git add packages/brain/src/auto-answer.ts packages/brain/src/auto-answer.test.ts \
  packages/brain/src/pool.test.ts

git commit -m "refactor(15.8): delete budget-escalation.ts + [BUDGET] branch in auto-answer"
```

---

## Task 9: Daemon — HTTP/SSE surface

**Files:**

- Modify: `packages/daemon/src/server.ts`
- Modify: `packages/daemon/src/server.test.ts`
- Modify: `packages/ipc/src/schemas.ts` (or wherever the IPC schemas live)
- Modify: `packages/ipc/src/index.ts` (re-exports)

---

- [ ] **Step 1: Define new + extended IPC schemas**

In `packages/ipc/src/schemas.ts`:

```ts
// PUT /api/v1/projects/:id/budget-defaults — extended
export const apiV1ProjectBudgetDefaultsPutBodySchema = z.object({
  budgetDefaults: budgetsSchema.optional(),
  autoIncreaseBudgets: z.boolean().optional(),
  autoIncreaseCeilingMultiplier: z.number().min(1).optional(),
}).strict();

// GET /api/v1/directives/:id/pool-usage — new
export const apiV1PoolUsageResponseSchema = z.object({
  directiveId: z.string(),
  computedAt: z.string(),
  perAxis: z.record(z.object({
    used: z.number(),
    cap: z.number(),
    pct: z.number(),
    tasks: z.array(z.object({
      taskId: z.string(),
      title: z.string(),
      agent: z.string(),
      contribution: z.number(),
    })),
    status: z.enum(['ok', 'warn', 'exhausted']),
  })),
  parkedReason: z.object({
    axis: z.string(),
    usedAtPark: z.number(),
    capAtPark: z.number(),
    nextBumpTo: z.number(),
  }).optional(),
});

// Structured blocked reason union
export const directiveBlockedReasonSchema = z.union([
  z.object({
    kind: z.literal('pool-exhausted'),
    axis: z.string(),
    usedAtPark: z.number(),
    capAtPark: z.number(),
  }),
  z.string(),  // legacy free-text reasons
]);
```

Export from `packages/ipc/src/index.ts`.

- [ ] **Step 2: Write failing tests for the daemon endpoint changes**

```ts
// packages/daemon/src/server.test.ts (extend)
describe('PUT /api/v1/projects/:id/budget-defaults — Tier 15 extension', () => {
  it('accepts all 8 axes plus autoIncreaseBudgets and autoIncreaseCeilingMultiplier', async () => {
    // ... PUT with full body
    // Assert 200, project.json contains all keys
  });

  it('rejects extra unknown keys (strict mode)', async () => {
    // PUT with body containing unknownKey
    // Assert 400
  });

  it('rejects autoIncreaseCeilingMultiplier: 0', async () => { ... });

  it('clears defaults on empty body (PUT semantics)', async () => { ... });
});

describe('GET /api/v1/directives/:id/pool-usage', () => {
  it('returns the live pool tally shape', async () => {
    // ... set up directive with tasks + model_usage
    // GET, assert response shape matches apiV1PoolUsageResponseSchema
  });

  it('returns 404 on missing directive', async () => { ... });

  it('requires bearer auth', async () => { ... });

  it('includes parkedReason when directive is blocked-pool-exhausted', async () => { ... });
});

describe('pool.tally SSE event', () => {
  it('emits pool.tally event after task-completion', async () => {
    // Subscribe to per-directive SSE stream
    // Complete a task
    // Assert event with kind=pool.tally arrives
  });

  it('emits pool.tally event after bumpProjectCap write', async () => { ... });
});

describe('GET /api/v1/directives/:id — Tier 15 blockedReason union', () => {
  it('returns structured blockedReason for pool-exhausted directives', async () => { ... });

  it('returns string blockedReason for legacy directives', async () => { ... });
});
```

- [ ] **Step 3: Run tests to verify RED**

```bash
pnpm --filter @factory5/daemon test server
```

- [ ] **Step 4: Implement the daemon changes**

In `packages/daemon/src/server.ts`:

```ts
// Extend the existing PUT route
app.put('/api/v1/projects/:id/budget-defaults', {
  // ... existing config
  schema: { body: zodToFastify(apiV1ProjectBudgetDefaultsPutBodySchema) },
}, async (req, reply) => {
  const parsed = apiV1ProjectBudgetDefaultsPutBodySchema.parse(req.body);
  // ... use wiki.updateProjectMetadata with the parsed body
});

// New GET route
app.get('/api/v1/directives/:id/pool-usage', {
  preHandler: bearerAuth,
}, async (req, reply) => {
  const directive = directives.getById(db, req.params.id);
  if (directive === undefined) {
    reply.code(404).send({ error: 'directive not found' });
    return;
  }
  const projectMetadata = await loadOrCreateProjectMetadata(directive.payload.projectPath, '');
  const projectBudgets = {
    budgetDefaults: projectMetadata.metadata.budgetDefaults ?? {},
    autoIncreaseBudgets: projectMetadata.metadata.autoIncreaseBudgets,
    autoIncreaseCeilingMultiplier: projectMetadata.metadata.autoIncreaseCeilingMultiplier,
  };
  const pool = computePoolUsage(db, directive.id, projectBudgets);
  reply.send(apiV1PoolUsageResponseSchema.parse(pool));
});
```

For SSE: in the brain's pool dispatcher (Task 7), after every task-completion and after every `bumpProjectCap`, emit:

```ts
hub.emit({
  kind: 'pool.tally',
  directiveId: directive.id,
  perAxis: pool.perAxis,
  ...(pool.parkedReason !== undefined ? { parkedReason: pool.parkedReason } : {}),
});
```

For `GET /api/v1/directives/:id`: extend the response serializer to round-trip the structured `blockedReason` (parse the DB column as JSON if possible; fallback to plain string).

- [ ] **Step 5: Run tests to verify GREEN**

```bash
pnpm --filter @factory5/daemon test server
pnpm --filter @factory5/ipc test
```

- [ ] **Step 6: Build + lint + format**

```bash
pnpm build && pnpm lint && pnpm format:check
```

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/server.ts packages/daemon/src/server.test.ts \
  packages/ipc/src/schemas.ts packages/ipc/src/index.ts

git commit -m "feat(15.9): daemon PUT /budget-defaults extended + GET /pool-usage + pool.tally SSE"
```

---

## Task 10: Web UI — project page tabbed cockpit

**Files:**

- Modify: `apps/factory-web/src/pages/projects/detail.astro` (full rewrite)
- Possibly create: `apps/factory-web/src/components/PoolTally.astro` (extract Live tab into a component for readability)
- Possibly create: `apps/factory-web/src/components/Tabs.astro` (if no tab primitive exists)

This is a large UI rewrite. Break into sub-steps but they all land in one commit (the page is unusable until the tabs work).

---

- [ ] **Step 1: Read the existing `detail.astro` and identify the primitives**

Note: existing file is ~250 lines, has a `Dashboard` layout, `Form`/`Field`/`Submit`/`Alert` primitives. The new page will reuse all of them.

- [ ] **Step 2: Sketch the page structure**

Top to bottom:
1. Header (project name, ULID, workspace path, language, status) — unchanged
2. Parked-alert banner (conditional)
3. Tab strip
4. Tab content (4 panels: Live / Defaults / History / Settings)

- [ ] **Step 3: Author the new `detail.astro` page**

(Code block ~600 lines. Implementer reads the spec § 4 for the full layout; uses existing `Field`/`Form`/`Submit` primitives; localStorage for tab persistence; fetches from `/api/v1/projects/:id` for project + `/api/v1/directives/:id/pool-usage` for tally + subscribes to per-directive SSE for live updates.)

Key implementation points:

- **Tab state**: stored in `localStorage` keyed by `factory5.projectDetail.activeTab` (string: `live` | `defaults` | `history` | `settings`).
- **Live tab**: empty-state when no in-flight directive. Otherwise fetch `/api/v1/directives/:id/pool-usage` once on mount, subscribe to SSE filtered for `pool.tally` events, update bars on each event. Per-axis bars with color logic: green < 80%, amber 80-99%, vermillion ≥ 100%.
- **Drill-down**: each axis row has a `data-axis` attribute; clicking toggles a `tasks` sub-table populated from `perAxis[axis].tasks`.
- **Defaults tab**: extends existing 2-axis form to 8 fields. `Save defaults` and `Clear all defaults` buttons PUT to `/api/v1/projects/:id/budget-defaults` with the form body.
- **History tab**: paginated table; `GET /api/v1/directives?projectId=X&limit=50&offset=N`.
- **Settings tab**: `autoIncreaseBudgets` checkbox + `autoIncreaseCeilingMultiplier` number input. Saves through the same PUT endpoint.
- **Parked-alert banner**: conditional render based on any in-flight directive having `status === 'blocked'` with `blockedReason.kind === 'pool-exhausted'`. "Raise cap to {nextBumpTo}" button issues PUT with `budgetDefaults[axis] = currentCap + projectDefault`.

- [ ] **Step 4: Light smoke test (compile + tabs mount)**

Run dev server:

```bash
pnpm --filter factory-web dev
```

Navigate to `http://localhost:4321/app/projects/{id}` and verify:
- Page loads without console errors
- Four tabs visible; clicking switches content
- Defaults tab form submits (PUT happens; success alert shows)
- Settings tab toggles save (PUT happens)
- Live tab shows tally if directive in flight, empty-state otherwise

(Astro doesn't have a unit-test framework wired in factory5; smoke is the testing primitive per Tier 11/14 precedent.)

- [ ] **Step 5: TypeScript compile check**

```bash
pnpm --filter factory-web build
```

Expected: clean.

- [ ] **Step 6: Lint + format**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 7: Commit**

```bash
git add apps/factory-web/src/pages/projects/detail.astro \
  apps/factory-web/src/components/PoolTally.astro \
  apps/factory-web/src/components/Tabs.astro

git commit -m "feat(15.10): web UI project page tabbed cockpit (Live/Defaults/History/Settings)"
```

---

## Task 11: Web UI — directive detail pool pill + build form copy update

**Files:**

- Modify: `apps/factory-web/src/pages/directives/detail.astro`
- Modify: `apps/factory-web/src/pages/build.astro`

---

- [ ] **Step 1: Add pool-usage pill to directive detail page**

In `apps/factory-web/src/pages/directives/detail.astro`, find the spend display (existing `spend $X.XX` element). Append:

```html
<span style="margin-left: 0.75rem; opacity: 0.7;">·</span>
<span id="pool-pill" style="margin-left: 0.5rem; font-size: 0.85rem;">
  <a href={`/app/projects/${projectId}`} style="color: inherit;">
    pool: <span id="pool-pill-text">...</span> · Manage on project page →
  </a>
</span>
```

JS:

```ts
// On mount, fetch pool-usage and pick the most-loaded axis to display
const pool = await apiFetch(`/api/v1/directives/${directiveId}/pool-usage`);
const sorted = Object.entries(pool.perAxis).sort((a, b) => b[1].pct - a[1].pct);
const [axis, axisData] = sorted[0];
document.getElementById('pool-pill-text').textContent =
  `${axis} ${axisData.used}/${axisData.cap}${axisData.status === 'exhausted' ? ' EXHAUSTED' : ''}`;

// Subscribe to SSE for live updates
sse.on('pool.tally', (event) => {
  const sorted = Object.entries(event.perAxis).sort((a, b) => b[1].pct - a[1].pct);
  const [axis, axisData] = sorted[0];
  document.getElementById('pool-pill-text').textContent = `${axis} ${axisData.used}/${axisData.cap}${axisData.status === 'exhausted' ? ' EXHAUSTED' : ''}`;
});
```

- [ ] **Step 2: Update build form Advanced budgets accordion copy**

In `apps/factory-web/src/pages/build.astro`, find the accordion summary text (currently "Advanced budgets" + meta). Update the meta line to include the new operator-floor framing:

```
Override budgets for this build (operator floor). Live edits during the build happen on the project page and can only raise the cap further.
```

No functional change to the accordion fields.

- [ ] **Step 3: Smoke test**

Run dev server; navigate to `/app/directives/{id}` and verify pool pill renders. Click pill, verify navigation to project page. On `/app/build`, expand accordion, verify new copy.

- [ ] **Step 4: TypeScript compile check + lint + format**

```bash
pnpm --filter factory-web build && pnpm lint && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
git add apps/factory-web/src/pages/directives/detail.astro \
  apps/factory-web/src/pages/build.astro

git commit -m "feat(15.11): web UI directive detail pool pill + build form copy"
```

---

## Task 12: Phase close — live browser smoke + recordkeeping

**Files:**

- Modify: `UPGRADE/ROADMAP.md` (tick all Tier 15 done-criteria rows)
- Modify: `UPGRADE/ISSUES.md` (move U036 + U037 to Resolved; U038 stays in Open as Tier-16+ candidate)
- Modify: `.control/phases/phase-15-budget-ux-overhaul/steps.md` (flip all checkboxes)
- Modify: `.control/progress/STATE.md` (cursor flip Phase 15 active → arc-complete eleventh time)
- Modify: `docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md` (status header bump)
- Tag: `phase-15-budget-ux-overhaul-closed` annotated at the last work commit

---

- [ ] **Step 1: Run all four `pnpm` gates from repo root**

```bash
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

Expected: all green. Workspace test count ≥ 1450 passing.

- [ ] **Step 2: Live browser smoke gate #1 (parked → raise → auto-resume)**

Restart factoryd to load fresh `dist/`:

```bash
pnpm factory daemon restart
```

In Playwright MCP:
1. Navigate to `/app/projects/new`, create project `tier-15-smoke` with `language=python`
2. Navigate to project detail Defaults tab; set `maxTurnsBuilder = 80`
3. Navigate to `/app/build`, kick off build with spec "full python CLI helper"
4. Watch directive detail Activity feed; verify build progresses through wiki + planner stages
5. Wait for builder task to hit pool exhaustion (~5 minutes); verify directive flips to `blocked`
6. Navigate back to project detail; verify parked-alert banner shows
7. Click "Raise cap to 160" CTA
8. Wait ≤ 250 ms; verify directive auto-resumes (status flips back to `running` in the activity feed)

Record: directive ID, spend, time to auto-resume. Append to STATE.md "Notes for next session" if anything notable surfaced.

- [ ] **Step 3: Live browser smoke gate #2 (auto-increase flow)**

Same project, edit Settings tab: `autoIncreaseBudgets = true`, `autoIncreaseCeilingMultiplier = 3`. Re-kick the build with `maxTurnsBuilder = 80`.

Verify:
- Pool exhaustion fires; auto-bump to 160 happens silently; activity feed narrates `pool: auto-bumped maxTurnsBuilder to 160`
- Second exhaustion → auto-bump to 240
- Third exhaustion → directive parks (3× ceiling reached); banner shows; activity feed narrates ceiling
- No `[BUDGET]` askUser fires at any point

- [ ] **Step 4: Live browser smoke gate #3 (multi-class isolation)**

Spec-shape: kick off a build where the planner emits BOTH scaffolder + builder tasks. Verify the Live tab shows distinct pools per class. Exhaust the builder pool; verify the scaffolder pool's status stays `ok`/`warn` (not `exhausted`).

- [ ] **Step 5: ROADMAP recordkeeping**

In `UPGRADE/ROADMAP.md`, tick all Tier 15 done-criteria rows. Update intro count if not already at "Fifteen tiers."

- [ ] **Step 6: ISSUES recordkeeping**

Move U036 + U037 from `## Open` to `## Resolved` (with resolution note pointing at the relevant commit). U038 stays in `## Open` with the tier annotation updated to `(Tier 16+ candidate; brain-side timing, unrelated to budget UX)`.

- [ ] **Step 7: Steps recordkeeping**

In `.control/phases/phase-15-budget-ux-overhaul/steps.md`, flip all checkboxes to `[x]`.

- [ ] **Step 8: STATE cursor flip**

In `.control/progress/STATE.md`:
- Update "Last updated" to today's date with the Phase 15 close note
- Flip "Current phase" to `arc-complete (eleventh time)`
- Update "Status" with Tier 15 outcome summary
- Update "Next action" with arc-complete options
- Update "Recent decisions" with ADR 0034
- Add Phase 15 close entry to "Recently completed"

- [ ] **Step 9: Spec status header bump**

In `docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md`, update the `Status:` line:

```markdown
**Status:** Implemented and closed · `phase-15-budget-ux-overhaul-closed` tag at <last work commit sha>
```

- [ ] **Step 10: Phase close commit**

```bash
git add UPGRADE/ROADMAP.md UPGRADE/ISSUES.md \
  .control/phases/phase-15-budget-ux-overhaul/steps.md \
  .control/progress/STATE.md \
  docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md

git commit -m "chore(phase-15): close phase 15, kick off arc-complete (eleventh time)"
```

- [ ] **Step 11: Tag the phase close at the last substantive work commit**

```bash
# Find the last work commit (last 15.N commit before the close commit)
git log --oneline | head -20

# Tag annotated (use the SHA of the last 15.X work commit, NOT the close commit)
git tag -a phase-15-budget-ux-overhaul-closed <last-work-commit-sha> \
  -m "Phase 15 — Budget UX overhaul. [BUDGET] askUser path deleted. Pool model for maxTurns* axes. Live re-resolve from project.json with per-build floor. Auto-increase toggle with safety ceiling. Project page tabbed cockpit. ADR 0034 supersedes ADR 0032. U036 + U037 closed."
```

- [ ] **Step 12: Run `/phase-close` to verify all done-criteria green**

This is a Control framework slash command. It walks done-criteria in the phase README. Confirm all 12 criteria pass.

- [ ] **Step 13: Session-end after phase close**

Run `/session-end` to bank STATE.md, journal, next.md.

---

## Done-criteria recap

From spec § 6.13, restated here so the implementer can confirm pre-close:

1. All 4 `pnpm` gates green (~1454 passing + 3 skipped)
2. ADR 0034 lands; ADR 0032 marked `Superseded by ADR 0034`; ADR 0030 amendment block; ADR 0020 cross-ref amendment
3. `packages/brain/src/budget-escalation.ts` deleted; companion test deleted; no remaining importers
4. `[BUDGET]` branch removed from `auto-answer.ts`; `[CRITIC]` regression test passes
5. Pool consumer lives in `pool.ts` + `pool-usage.ts` + `pool-resume.ts` with full test coverage
6. New `GET /api/v1/directives/:id/pool-usage` returns correct shape; SSE `pool.tally` events emit
7. `PUT /api/v1/projects/:id/budget-defaults` accepts all 8 axes + 2 new scalars
8. Project detail page renders 4 tabs; Live tab shows bars + drill-down; parked-alert banner appears
9. Auto-increase toggle bumps on exhaustion, respects ceiling, parks at ceiling
10. Live re-resolve verified: edit `project.json` out-of-band, in-flight cap updates
11. Browser smoke #1 (parked → raise → auto-resume) verified
12. U036 + U037 moved to Resolved; U038 stays in Open as Tier-16+ candidate
