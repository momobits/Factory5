# Living Knowledge Graph — Phase C: Self-Healing + Workspace Hygiene

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisites:** Phases A and B are complete. Specifically: structured findings exist in the wiki, the coherence validator (schema/reference/doc-fiction/dead-code) runs at post-task/post-merge/final-verification, the coherence-reviewer agent produces structured findings.

**Goal:** Close the loop. The brain partitions findings into auto-fixable vs operator-judgment; dispatches the fixer agent for auto-fixable, escalating only what's stuck. Operators get a `factory5 cleanup` CLI and resume-time prompts for abandoned worktrees from prior runs.

**Architecture:** Phase C consumes the structured findings produced in Phases A/B. The brain's escalation path gains a "try fixer first" step. The fixer's prompt grows to consume structured findings as a list and either fix each or report blockers. Workspace hygiene is independent — a new CLI command + resume-time check.

**Tech Stack:** TypeScript, Zod, better-sqlite3, Commander (CLI), Fastify (daemon endpoints).

**Spec:** `docs/superpowers/specs/2026-05-28-living-knowledge-graph-design.md`

---

## Section 1: Fixer agent updates

### Task 1: Fixer reads structured findings

**Files:**

- Modify: `prompts/agents/fixer.md`

**Spec reference:** Component 4 → "Fixer agent input"

- [ ] **Step 1: Read existing fixer prompt**

Run: `cat prompts/agents/fixer.md`

- [ ] **Step 2: Append structured-findings handling section**

Append to `prompts/agents/fixer.md`:

```markdown
## Structured findings input (Tier 15.13)

You may receive a structured findings payload in your user prompt's
context. Format:
```

## Findings to resolve

The brain detected N auto-fixable findings. Resolve each one with the
smallest possible change. After each fix, the validator will re-run;
findings will either disappear (success), persist (your fix didn't
help), or new ones may surface (your fix made things worse — undo).

Findings:

- ID: F042
  Category: graph-orphan
  Severity: medium
  Location: docs/knowledge/features/cli-run-command.md (front-matter: implements)
  Title: Feature status=implemented but implements: is empty
  Why: Without implements link, traceability lost.
  Suggested fix: Set implements: [<this-task-id>]

- ID: F043
  ...

```

For each finding:

1. Read the file at `Location:`.
2. Apply the smallest change that resolves the specific finding. Use
   `Suggested fix:` as a starting point.
3. Do not refactor adjacent code. Do not "while-I'm-here" cleanups.
4. After all fixes, emit a `RESOLUTION <ID> (FIXED): <one-line summary>`
   marker for each finding you addressed.
5. If you cannot fix a specific finding (the suggested fix doesn't
   apply, or fixing it requires architectural change), emit
   `RESOLUTION <ID> (BLOCKED): <reason>` and leave the finding's
   location untouched.

You SHOULD update the knowledge graph as part of your fixes (use the
`knowledge-graph` skill). For `graph-orphan` findings, the fix is
usually a front-matter edit. For `doc-fiction` findings, the fix is
either implementing the documented feature or removing the doc claim
+ writing a decision.
```

- [ ] **Step 3: Commit**

```bash
git add prompts/agents/fixer.md
git commit -m "feat(15.13): fixer prompt handles structured findings input"
```

---

## Section 2: Self-healing fix loop in brain

### Task 2: Brain partitions findings and dispatches fixer

**Files:**

- Modify: `packages/brain/src/loop.ts` (escalateBlocked call site, ~lines 530-558)
- Test: `packages/brain/src/loop.test.ts`

**Spec reference:** Component 4 → "Self-Healing Loop"

- [ ] **Step 1: Locate the escalation point**

Run: `sed -n '525,565p' packages/brain/src/loop.ts`
Confirm: `escalateBlocked` is called when `hadFailures && autonomy === 'autonomous'`.

- [ ] **Step 2: Add fixer dispatch logic**

In `packages/brain/src/loop.ts`, before the `escalateBlocked` call, add:

```typescript
// Tier 15.13 — self-healing fix loop. Before escalating to the operator,
// dispatch the fixer agent for any auto-fixable findings. Up to N attempts
// (default 3, configurable via project metadata).
import { listFindings } from '@factory5/wiki';

const maxAttempts = ((await loadProjectMetadata(directive.projectPath))?.metadata
  ?.maxFixerAttempts ?? 3) as number;

let autoFixableRemaining = (await listFindings(directive.projectPath, { status: 'OPEN' })).filter(
  (f) => f.auto_fixable === true,
);

let attemptIndex = 0;
while (autoFixableRemaining.length > 0 && attemptIndex < maxAttempts) {
  attemptIndex++;
  log.info(
    {
      directiveId: directive.id,
      attempt: attemptIndex,
      maxAttempts,
      findingCount: autoFixableRemaining.length,
    },
    'loop: dispatching fixer for auto-fixable findings',
  );

  // Build a fixer task with structured findings in the context
  const fixerTaskId = newUlid();
  const findingsContext = autoFixableRemaining
    .map(
      (f) =>
        `- ID: ${f.id}\n  Category: ${f.category}\n  Severity: ${f.severity}\n  Location: ${f.location?.file ?? f.target}${f.location?.frontmatter_field ? ` (front-matter: ${f.location.frontmatter_field})` : ''}\n  Title: ${f.title ?? f.description}\n  Why: ${f.why ?? '(no detail)'}\n  Suggested fix: ${f.suggested_fix ?? '(no suggestion)'}`,
    )
    .join('\n\n');

  const fixerTask: Task = {
    id: fixerTaskId,
    planId: plan.id,
    title: `Self-healing fixer attempt ${attemptIndex}/${maxAttempts}`,
    agent: 'fixer',
    category: 'reasoning',
    inputs: {
      files: [...new Set(autoFixableRemaining.map((f) => f.location?.file ?? f.target))],
      context: `## Findings to resolve\n\n${findingsContext}`,
    },
    expectedOutputs: { files: [], signals: [] },
    dependsOn: [],
    status: 'pending',
    attempts: 0,
    featureIds: [],
  };

  const beforeFindings = new Set(autoFixableRemaining.map((f) => f.id));
  const before = autoFixableRemaining.length;

  try {
    await executeTask(fixerTask, plan, registry, db, directive.id, opts.signal, emit);
  } catch (err) {
    log.warn({ err, attempt: attemptIndex }, 'loop: fixer attempt threw');
    break;
  }

  // Re-query findings to see what changed
  autoFixableRemaining = (await listFindings(directive.projectPath, { status: 'OPEN' })).filter(
    (f) => f.auto_fixable === true,
  );

  // Zero-progress detection: if no findings resolved AND no new ones appeared
  const after = autoFixableRemaining.length;
  const stillSame = autoFixableRemaining.every((f) => beforeFindings.has(f.id));
  if (after === before && stillSame) {
    log.warn(
      { attempt: attemptIndex, remaining: after },
      'loop: fixer made zero progress — escalating immediately',
    );
    break;
  }
}

if (autoFixableRemaining.length === 0) {
  log.info(
    { directiveId: directive.id, attempts: attemptIndex },
    'loop: self-healing resolved all findings',
  );
  hadFailures = false; // Re-evaluate; if other failures exist, hadFailures stays true via other paths
}
```

- [ ] **Step 3: Build + test**

Run: `pnpm build && pnpm --filter @factory5/brain test 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/loop.ts
git commit -m "feat(15.13): self-healing fix loop — try-then-ask before escalation"
```

---

### Task 3: Structured escalation payload

**Files:**

- Modify: `packages/brain/src/ask-user.ts` (find escalateBlocked, update payload shape)
- Test: relevant test file

**Spec reference:** Component 4 → "Structured escalation"

- [ ] **Step 1: Locate escalateBlocked**

Run: `grep -n "escalateBlocked" packages/brain/src/ask-user.ts | head -5`

- [ ] **Step 2: Augment the escalation payload**

When the loop calls `escalateBlocked` after fixer attempts exhaust, pass structured context:

```typescript
const escalationPayload = {
  attemptsTried: attemptIndex,
  maxAttempts,
  remainingFindings: autoFixableRemaining.map((f) => ({
    id: f.id,
    category: f.category,
    title: f.title,
    why: f.why,
    suggested_fix: f.suggested_fix,
    location: f.location,
  })),
  options: [
    { id: 'manual', label: 'Resolve findings manually then resume' },
    { id: 'skip', label: 'Skip findings and mark directive complete' },
    { id: 'abort', label: 'Abort directive' },
    { id: 'retry', label: 'Retry fixer with extended budget' },
  ],
};

// Pass into escalateBlocked's existing payload mechanism
```

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/ask-user.ts packages/brain/src/loop.ts
git commit -m "feat(15.13): escalation payload includes attempts + remaining findings + options"
```

---

## Section 3: Abandoned worktree detection

### Task 4: Helper to list abandoned worktrees

**Files:**

- Create: `packages/worker/src/abandoned-worktrees.ts`
- Create: `packages/worker/src/abandoned-worktrees.test.ts`

**Spec reference:** Component 5 → "Abandoned worktree detection"

- [ ] **Step 1: Write failing test**

```typescript
// packages/worker/src/abandoned-worktrees.test.ts
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listAbandonedWorktrees } from './abandoned-worktrees.js';

describe('listAbandonedWorktrees', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-abandoned-'));
    await mkdir(join(projectPath, '.factory', 'worktrees'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns empty when no worktrees on disk', async () => {
    const result = await listAbandonedWorktrees({ projectPath, activeTaskIds: [] });
    expect(result).toEqual([]);
  });

  it('flags worktree directories not in activeTaskIds', async () => {
    await mkdir(join(projectPath, '.factory', 'worktrees', 'task-01ABANDONED'), {
      recursive: true,
    });
    await mkdir(join(projectPath, '.factory', 'worktrees', 'task-01ACTIVE'), { recursive: true });
    const result = await listAbandonedWorktrees({
      projectPath,
      activeTaskIds: ['01ACTIVE'],
    });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toContain('task-01ABANDONED');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm --filter @factory5/worker test -- -t "listAbandonedWorktrees"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/worker/src/abandoned-worktrees.ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface AbandonedWorktree {
  path: string;
  taskId: string;
  abandonedSince: Date;
}

export interface ListOptions {
  projectPath: string;
  /** Task IDs currently active in the project's plan(s). Worktrees not in this set are candidates. */
  activeTaskIds: readonly string[];
}

export async function listAbandonedWorktrees(opts: ListOptions): Promise<AbandonedWorktree[]> {
  const dir = join(opts.projectPath, '.factory', 'worktrees');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const activeSet = new Set(opts.activeTaskIds);
  const result: AbandonedWorktree[] = [];

  for (const entry of entries) {
    if (!entry.startsWith('task-')) continue;
    const taskId = entry.slice('task-'.length);
    if (activeSet.has(taskId)) continue;
    const path = join(dir, entry);
    const s = await stat(path);
    result.push({ path, taskId, abandonedSince: s.mtime });
  }
  return result;
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @factory5/worker test -- -t "listAbandonedWorktrees"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/abandoned-worktrees.ts packages/worker/src/abandoned-worktrees.test.ts
git commit -m "feat(15.13): worker helper to list abandoned worktrees"
```

---

## Section 4: factory5 cleanup CLI

### Task 5: Cleanup command

**Files:**

- Create: `packages/cli/src/commands/cleanup.ts`
- Modify: `packages/cli/src/cli.ts` (register the command)

**Spec reference:** Component 5 → "Operator surfaces — CLI"

- [ ] **Step 1: Create command file**

```typescript
// packages/cli/src/commands/cleanup.ts
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

import { Command } from 'commander';

import { listAbandonedWorktrees } from '@factory5/worker';
import { createLogger } from '@factory5/logger';

const log = createLogger('cli.cleanup');

interface CleanupFlags {
  pruneBranches?: boolean;
  yes?: boolean;
}

export function registerCleanupCommand(parent: Command): void {
  parent
    .command('cleanup')
    .description('List and remove abandoned worktrees from prior failed runs')
    .argument('[projectPath]', 'Project root path', process.cwd())
    .option('--prune-branches', 'Also delete the factory/task-<id> branches')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (projectPath: string, opts: CleanupFlags) => {
      const abs = resolve(projectPath);
      // Active task IDs are pulled from .factory/plan.json (current plan only)
      let activeTaskIds: string[] = [];
      try {
        const { readFile } = await import('node:fs/promises');
        const planText = await readFile(`${abs}/.factory/plan.json`, 'utf8');
        const parsed = JSON.parse(planText) as { tasks?: Array<{ id?: string }> };
        activeTaskIds = (parsed.tasks ?? [])
          .map((t) => t.id)
          .filter((id): id is string => typeof id === 'string');
      } catch {
        /* no plan — all worktrees are abandoned */
      }

      const abandoned = await listAbandonedWorktrees({ projectPath: abs, activeTaskIds });

      if (abandoned.length === 0) {
        process.stdout.write('No abandoned worktrees found.\n');
        return;
      }

      process.stdout.write(`Found ${abandoned.length} abandoned worktree(s):\n\n`);
      for (const w of abandoned) {
        process.stdout.write(
          `  ${w.path}\n    Task: ${w.taskId}\n    Last modified: ${w.abandonedSince.toISOString()}\n\n`,
        );
      }

      if (!opts.yes) {
        process.stdout.write(`Remove these? Re-run with --yes to confirm.\n`);
        return;
      }

      for (const w of abandoned) {
        log.info({ path: w.path }, 'cleanup: removing worktree');
        try {
          execFileSync('git', ['worktree', 'remove', '--force', w.path], { cwd: abs });
        } catch {
          await rm(w.path, { recursive: true, force: true });
        }
        if (opts.pruneBranches === true) {
          try {
            execFileSync('git', ['branch', '-D', `factory/task-${w.taskId.toLowerCase()}`], {
              cwd: abs,
            });
          } catch (err) {
            log.warn(
              { err, taskId: w.taskId },
              'cleanup: branch delete failed (probably already gone)',
            );
          }
        }
      }
      process.stdout.write(`Removed ${abandoned.length} worktree(s).\n`);
    });
}
```

- [ ] **Step 2: Register in cli.ts**

```typescript
// In packages/cli/src/cli.ts buildCli():
import { registerCleanupCommand } from './commands/cleanup.js';
// ...
registerCleanupCommand(program);
```

- [ ] **Step 3: Add @factory5/worker dep to CLI package**

In `packages/cli/package.json`:

```json
"@factory5/worker": "workspace:*",
```

Export `listAbandonedWorktrees` from `packages/worker/src/index.ts`:

```typescript
export { listAbandonedWorktrees, type AbandonedWorktree } from './abandoned-worktrees.js';
```

Run: `pnpm install`

- [ ] **Step 4: Build and smoke test**

Run: `pnpm --filter @factory5/cli build && node packages/cli/dist/index.js cleanup --help`
Expected: usage printed.

Run: `node packages/cli/dist/index.js cleanup "C:\Users\Momo\factory5-workspace\pythonetl"`
Expected: lists the 5 abandoned worktrees we identified earlier.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/cleanup.ts packages/cli/src/cli.ts packages/cli/package.json packages/worker/src/index.ts
git commit -m "feat(15.13): factory5 cleanup CLI lists + removes abandoned worktrees"
```

---

## Section 5: Resume-time prompt + non-CLI degradation

### Task 6: Daemon detects abandoned worktrees on resume

**Files:**

- Modify: `packages/daemon/src/server.ts:1415` (POST resume endpoint)
- Modify: `packages/ipc/src/schemas.ts` (extend resume response with abandoned-worktree info)

**Spec reference:** Component 5 → "Operator surfaces — Auto-prompt"

- [ ] **Step 1: Read current resume endpoint**

Run: `sed -n '1410,1460p' packages/daemon/src/server.ts`

- [ ] **Step 2: Extend resume response schema**

In `packages/ipc/src/schemas.ts`, find the resume response schema and extend:

```typescript
export const apiV1DirectiveResumeResponseSchema = z.object({
  // ... existing fields
  abandonedWorktrees: z
    .array(
      z.object({
        path: z.string(),
        taskId: z.string(),
        abandonedSince: z.string().datetime({ offset: true }),
      }),
    )
    .optional(),
});
```

- [ ] **Step 3: Inject abandoned detection in resume handler**

In `packages/daemon/src/server.ts` resume endpoint, after the directive validation but before the new directive is created:

```typescript
// Tier 15.13 — surface abandoned worktrees from prior runs of this directive.
const tasks = tasksInflight.listByDirective(opts.db, priorId);
const activeTaskIds = tasks.map((t) => t.id);
const abandoned = await listAbandonedWorktrees({
  projectPath: prior.projectPath,
  activeTaskIds,
});
// Include in response so the frontend/CLI can prompt
```

Then in the resume response construction, add the abandoned list.

- [ ] **Step 4: Build + test**

Run: `pnpm build && pnpm --filter @factory5/daemon test 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/server.ts packages/ipc/src/schemas.ts
git commit -m "feat(15.13): resume endpoint surfaces abandoned worktrees in response"
```

---

### Task 7: Web UI surfaces abandoned worktrees on directive detail

**Files:**

- Modify: `apps/factory-web/src/pages/directives/detail.astro`

**Spec reference:** Component 5 → "Operator surfaces — Directive detail page"

- [ ] **Step 1: Add "Previous attempts" panel**

In the directive detail page, after fetching the directive (or the resume action), if the directive is `blocked` or `failed` AND has a `parentDirectiveId` chain (or detected abandoned worktrees), show a panel:

```typescript
// In the page state interface
abandonedWorktrees: Array<{ path: string; taskId: string; abandonedSince: string }>;

// In the renderer after the task table:
if (state.abandonedWorktrees.length > 0) {
  const panel = el('div', { class: 'abandoned-panel' });
  panel.appendChild(el('h3', {}, 'Abandoned worktrees from prior attempts'));
  for (const w of state.abandonedWorktrees) {
    panel.appendChild(
      el('div', { class: 'abandoned-row' }, `${w.taskId} — last modified ${w.abandonedSince}`),
    );
  }
  panel.appendChild(
    el('div', { class: 'abandoned-hint' }, 'Run `factory5 cleanup` (CLI) to remove these.'),
  );
  // Insert into main column
}
```

- [ ] **Step 2: Fetch on detail load**

When the detail page hits `GET /api/v1/directives/:id`, also call (or include in same response) the abandoned-worktrees check. If the endpoint doesn't already include this, add a sub-fetch.

- [ ] **Step 3: Rebuild web app**

Run: `pnpm --filter factory-web build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/factory-web/src/pages/directives/detail.astro
git commit -m "feat(15.13): directive detail page surfaces abandoned worktrees"
```

---

### Task 8: Channel degradation for non-CLI resume

**Files:**

- Modify: `packages/channels/src/discord-commands.ts` (or wherever channel commands are defined)

**Spec reference:** Component 5 → "Non-CLI channels"

- [ ] **Step 1: Locate channel resume handler**

Run: `grep -rn "resume" packages/channels/src/ | head -10`

- [ ] **Step 2: Inject structured message when abandoned worktrees exist**

In the channel's resume handler, before resuming, check the daemon's response for `abandonedWorktrees`. If present, post a structured message to the channel:

```typescript
if (resumeResponse.abandonedWorktrees && resumeResponse.abandonedWorktrees.length > 0) {
  const msg = [
    `Resuming directive ${directiveId}.`,
    ``,
    `Note: ${resumeResponse.abandonedWorktrees.length} abandoned worktrees from prior attempts remain on disk:`,
    ...resumeResponse.abandonedWorktrees.map((w) => `  - ${w.taskId} (since ${w.abandonedSince})`),
    ``,
    'Run `factory5 cleanup <projectPath>` (CLI) to remove them. No silent removal.',
  ].join('\n');
  await channel.postMessage(msg);
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/channels/src/discord-commands.ts
git commit -m "feat(15.13): channels surface abandoned worktrees in resume messages"
```

---

## Section 6: End-to-end Phase C verification

### Task 9: Phase C verification

- [ ] **Step 1: Build + lint + test full**

Run: `pnpm build && pnpm lint && pnpm test 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 2: Manual: trigger self-healing on a project with auto-fixable findings**

Create a project with intentional `graph-orphan` findings (e.g., a feature file with `status: implemented` but `implements: []`). Trigger a build; verify the fixer is dispatched and the findings get resolved before operator escalation.

- [ ] **Step 3: Manual: test cleanup**

```bash
node packages/cli/dist/index.js cleanup "C:\Users\Momo\factory5-workspace\pythonetl"
# Expected: lists the 5 abandoned worktrees
node packages/cli/dist/index.js cleanup "C:\Users\Momo\factory5-workspace\pythonetl" --yes --prune-branches
# Expected: removes them + branches
```

- [ ] **Step 4: Commit completion marker**

```bash
git commit --allow-empty -m "chore(15.13): Phase C complete — self-healing + workspace hygiene"
```

---

## Phase C coverage check

- [x] Component 4 (fixer reads structured findings): Task 1
- [x] Component 4 (brain partitions + dispatches fixer): Task 2
- [x] Component 4 (structured escalation): Task 3
- [x] Component 5 (abandoned worktree detection helper): Task 4
- [x] Component 5 (factory5 cleanup CLI): Task 5
- [x] Component 5 (daemon resume endpoint surfaces abandoned): Task 6
- [x] Component 5 (web UI shows abandoned panel): Task 7
- [x] Component 5 (channel resume degrades to structured message): Task 8

## Full spec coverage (across A + B + C)

After Phase C ships, the living knowledge graph spec is implemented end-to-end. Verify with the spec's component map:

- Component 1 (Living Knowledge Graph) ✓ — Phase A (schema, templates, skill, architect, planner) + Phase B (backward-compat migration)
- Component 2 (Structured Findings) ✓ — Phase A (schema + storage + IPC + frontend)
- Component 3 (Coherence Validator) ✓ — Phase A (schema + reference) + Phase B (doc-fiction + dead-code + reviewer agent + post-merge/final-verification wiring)
- Component 4 (Self-Healing Loop) ✓ — Phase C
- Component 5 (Workspace Hygiene) ✓ — Phase C
