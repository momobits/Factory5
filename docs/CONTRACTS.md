# Data contracts

> Source of truth: [`packages/core/src/`](../packages/core/src). This document is the human-readable view; if it disagrees with the code, the code wins — and someone needs to refresh this file.

All shapes are validated at boundaries with Zod schemas (also exported from `@factory5/core`).

---

## `AutonomyMode`

```ts
type AutonomyMode = 'chat' | 'assisted' | 'autonomous';
```

How much human-in-the-loop the brain expects:

- **`chat`** — every step asks
- **`assisted`** _(default)_ — confirm at phase boundaries
- **`autonomous`** — run to done; pause/escalate only when ambiguous or stuck

## `ChannelId`

```ts
type ChannelId = 'cli' | 'discord' | 'telegram' | 'github' | 'webhook';
```

Where a directive originated. Drives reply routing.

## `Intent`

```ts
type Intent =
  | 'build' // produce new software from spec
  | 'fix' // fix a problem in existing code
  | 'review' // adversarial review
  | 'investigate' // diagnose without changing
  | 'chat' // conversational Q&A
  | 'status' // report state
  | 'resume' // continue a stopped build
  | 'cancel'; // stop a running build
```

What the user (or external system) wants done. The triage agent classifies free-form input into one of these.

## `ModelCategory` and capability ranking

```ts
type ModelCategory = 'quick' | 'planning' | 'reasoning' | 'deep' | 'documentation';

// Exported from `@factory5/core` as MODEL_CATEGORY_RANKS.
// Higher = more capable. Ties: quick == documentation, reasoning == deep.
const RANKS = { quick: 0, documentation: 0, planning: 1, reasoning: 2, deep: 2 };
```

Used by the planner to clamp tool-using agents to at least their registry-declared category (ADR 0016). A `builder` task the LLM labels `quick` is materialised as `deep`.

## `Directive`

The unit of work flowing into the brain. One directive = one user-visible request.

```ts
type Directive = {
  id: string; // ULID
  source: ChannelId;
  principal: string; // user identifier scoped to source (e.g., discord user id)
  channelRef: string; // e.g. discord channel/thread id, cli session id
  intent: Intent;
  payload: unknown; // intent-specific shape
  autonomy: AutonomyMode;
  createdAt: string; // ISO8601
  status: 'pending' | 'claimed' | 'running' | 'blocked' | 'complete' | 'failed';
  claimedBy?: string; // brain process id (PID + hostname)
  parentDirectiveId?: string; // when one directive spawns another
};
```

Stored in SQLite `directives` table. Brain claims pending rows.

## `Event`

A normalized observation from the outside world. Daemon writes; brain reads when classifying triggers.

```ts
type Event = {
  id: string;
  source: string; // "github" | "git" | "fs" | "tmux" | "channel"
  body: EventBody; // typed union
  metadata: Record<string, unknown>;
  receivedAt: string;
};

type EventBody =
  | {
      kind: 'github.issue.opened';
      repo: string;
      number: number;
      title: string;
      author: string;
      body: string;
    }
  | {
      kind: 'github.issue.commented';
      repo: string;
      number: number;
      commentId: string;
      author: string;
      body: string;
    }
  | {
      kind: 'github.pr.status';
      repo: string;
      number: number;
      status: string;
      conclusion?: string;
      sha: string;
    }
  | {
      kind: 'git.commit';
      repo: string;
      sha: string;
      summary: string;
      branch: string;
      author: string;
    }
  | { kind: 'fs.changed'; path: string; type: 'create' | 'modify' | 'delete' }
  | { kind: 'channel.message'; channel: ChannelId; principal: string; ref: string; text: string };
```

Stored in SQLite `events_audit` table.

## `Finding`

An issue surfaced by an agent during build. The cross-agent dialogue primitive — finding IDs let reviewer/fixer/verifier reference the same problem.

```ts
type Finding = {
  id: string; // F001-style, project-scoped
  source: AgentRole;
  target: string; // file path or module name
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'FIXED' | 'VERIFIED' | 'WONTFIX';
  description: string;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
};
```

Lives in `<project>/.factory/findings.json` AND mirrored to `<project>/BUILD.md` for human reading.

## `Plan` and `Task`

A plan decomposes a directive into a DAG of tasks.

```ts
type Plan = {
  id: string;
  directiveId: string;
  projectPath: string;
  tasks: Task[]; // DAG via dependsOn
  createdAt: string;
  status: 'draft' | 'active' | 'complete' | 'abandoned';
};

type Task = {
  id: string;
  planId: string;
  title: string;
  agent: AgentRole;
  category: ModelCategory; // materialised with a per-agent floor (ADR 0016)
  inputs: { files: string[]; context: string };
  expectedOutputs: { files: string[]; signals: string[] };
  dependsOn: string[]; // task IDs — may include synthetic edges for file-ownership (ADR 0016)
  status: 'pending' | 'running' | 'complete' | 'failed' | 'blocked';
  attempts: number;
  worktreePath?: string;
  result?: TaskResult;
  maxTurns?: number; // optional per-task tool-use turn budget; tool-using agents only
};

type TaskResult = {
  exitCode: number;
  filesChanged: string[];
  findingsRaised: string[]; // finding IDs
  signalsEmitted: string[]; // e.g. "BUILD_COMPLETE", "NEEDS_FIXES"
  error?: string;
  durationMs: number;
};
```

Plans live in `<project>/.factory/plan.md` (markdown for human reading) AND `<project>/.factory/plan.json` (machine-readable).

## `AgentRole`

```ts
type AgentRole =
  | 'triage'
  | 'architect'
  | 'planner'
  | 'scaffolder'
  | 'builder'
  | 'reviewer'
  | 'fixer'
  | 'investigator'
  | 'verifier';
```

See [`AGENTS.md`](AGENTS.md) for what each does and which model category it uses by default.

## `ModelCategory`

```ts
type ModelCategory =
  | 'quick' // triage, classification (Haiku-tier)
  | 'planning' // task decomposition (Sonnet-tier)
  | 'reasoning' // architecture, deep diagnosis (Opus-tier)
  | 'deep' // long autonomous execution (Opus or GPT-tier)
  | 'documentation'; // doc generation (Haiku-tier)
```

Categories map to providers via `~/.factory5/config.toml`. See ADR 0004.

---

## Refresh process

When `packages/core/src/types.ts` changes:

1. Update this file with the new shape
2. Bump the relevant Zod schema in `packages/core/src/schemas.ts`
3. Run `pnpm test` — schema tests guard backward compatibility within a major version
4. If the change is breaking, add an ADR and a migration note in `docs/PROGRESS.md`
