# Factory 5 — Complete Architecture

> Canonical design document for Factory 5. This is the snapshot of the architecture as agreed at scaffold time. Living working documents (`docs/ARCHITECTURE.md`, `docs/PROGRESS.md`, `docs/decisions/`) evolve from here.

---

## 1. Mission

Factory 5 is an autonomous (and human-directable) software builder.

It accepts a software requirement — from a CLI command, a Discord message, or a local spec file — and produces working, tested, documented software. It can run **completely autonomously** (build to completion, ask only when stuck), **assisted** (autonomous between human-set checkpoints), or **chat** (turn-by-turn conversation).

It uses the user's Claude subscription as the primary model provider, with first-class fallbacks to Claude API, OpenAI/Codex, OpenRouter, and other providers — selectable per agent role via category-based routing.

It is not an MCP server. It is a complete application: two binaries, a durable state store, a multi-channel input layer, and a verification-first build loop.

---

## 2. Philosophy

Three lessons inform the design.

**From `claw-code`:** "Humans set direction; claws perform the labor." The factory is a coordination system, not a code generator. The human's value is taste, direction, and judgment — not typing speed. The system's job is to read direction, decompose, parallelize, execute, verify, recover, and only escalate when stuck.

**From `factory2` (the predecessor):** Ground-truth verification is the moat. Real `pytest`, real file checks, real `git status` — the assessor cannot be gamed by an agent claiming false progress. The knowledge wiki (design before code) and the finding lifecycle (cross-agent dialogue with stable IDs) are kept and ported.

**From `oh-my-openagent`, `oh-my-codex`, `oh-my-claudecode`, `clawhip`, `openclaw`:** The orchestration layer should be the LLM itself, augmented by:

- Category-based delegation (declare _intent_, not _agent_; let the system pick the model)
- Dual fallback (proactive at config-load + reactive at runtime)
- Out-of-band monitoring (separate process for I/O so monitoring doesn't burn agent context tokens)
- Worktree-isolated parallel workers
- Magic keyword detection for natural-language interfaces
- Continuation enforcement (todos must complete before the agent claims "done")
- Persistent plan/session state survives crashes

---

## 3. Architecture

### Top-level diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          USER / EXTERNAL                             │
│   CLI prompt                     Discord channel                     │
└──────┬───────────────────────────────────┬───────────────────────────┘
       │                                   │
       ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  factoryd  — DAEMON  (Node + TypeScript)                             │
│                                                                      │
│  Channels (inbound + outbound):                                      │
│    cli-rpc       discord (discord.js)        [telegram later]        │
│                                                                      │
│  Event sources (watch):                                              │
│    fs-watch (chokidar)                                               │
│                                                                      │
│  Normalizer: external → typed Event/Directive (Zod-validated)        │
│                                                                      │
│  IPC server (Fastify, 127.0.0.1:25295):                              │
│    POST /send /directives/notify /reload-config   GET /status /events│
└──────────────────────────────┬───────────────────────────────────────┘
                               │ writes
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ~/.factory5/factory.db   (SQLite — durable bus + audit + state)     │
│                                                                      │
│  directives       outbound_messages    events_audit                  │
│  sessions         pending_questions    tasks_inflight                │
│  projects         learnings            model_usage                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ reads/writes
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  factory  — CLI + BRAIN  (Node + TypeScript)                         │
│                                                                      │
│  CLI: init, build, chat, status, resume, push, daemon, logs          │
│                                                                      │
│  Brain:                                                              │
│    TRIAGE (quick) → confirm-per-autonomy → ARCHITECT (reasoning) →   │
│    PLAN (planning) → DELEGATE in parallel → ASSESSOR (no LLM) →      │
│    VERIFY → loop or escalate (ask_user / escalate_blocked)           │
│                                                                      │
│  Workers (one process per parallel task):                            │
│    allocate worktree → spawn `claude -p` / `codex` → stream output → │
│    parse findings → persist to SQLite + project files                │
│                                                                      │
│  Providers (LLM clients):                                            │
│    anthropic-sdk · openai-sdk · openrouter · claude-cli · codex-cli  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ creates/updates files in
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PROJECTS  (in <workspace>/<project>/ — OUTSIDE factory5)            │
│                                                                      │
│  CLAUDE.md              ← user spec (input)                          │
│  docs/knowledge/*.md    ← wiki (architect writes)                    │
│  BUILD.md               ← findings, decisions, log (all agents)      │
│  .factory/                                                           │
│    plan.md  checkpoints/  logs/build-<ts>.log  findings.json         │
│  src/  tests/  ...      ← the actual code being built                │
└──────────────────────────────────────────────────────────────────────┘
```

### Process model

Two binaries, both Node + TypeScript:

| Binary         | Role                                                                                                                                                                                             | Lifetime                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **`factory`**  | CLI + brain. Commander-based subcommands. Spawns the brain in-process for inline work, or claims directives from SQLite when serving long-running flows.                                         | Per-invocation for CLI; long-lived when `factory chat` or `factory serve` is up   |
| **`factoryd`** | Daemon. Owns outside-world I/O: Discord websocket, fs watching, channel sinks. Normalizes external input to typed events/directives. Hosts the IPC server and the long-running brain supervisor. | Long-lived background service; can run as systemd unit (Linux) or Windows Service |

Why split: brain restarts during dev shouldn't kill Discord connections; LLM crash shouldn't drop pending events; daemon can serve multiple brains in a future SaaS form. (GitHub polling / webhook ingress were part of the original scaffold but retired by ADR 0019 — factory's effects in the world are operator-directed per-directive, not pattern-driven.)

### Inter-process communication

Two channels, used together:

- **SQLite as durable bus + audit log** (always): daemon writes inbound directives, brain claims and processes; brain writes outbound messages, daemon delivers; every event is recorded in `events_audit`. Crash-safe by construction.
- **Localhost HTTP for low-latency live ops** (when both processes up): brain calls daemon's `POST /send` for immediate channel sends; daemon notifies brain of urgent inbound via `POST /directives/notify`. SQLite remains the truth — HTTP is a doorbell.

If HTTP is down: 250ms SQLite polling fallback. If SQLite is down: we're broken. Both up: snappy.

### Graceful degradation

The daemon is required for **chat / events / Discord-driven** work. It is **not** required for inline `factory build my-project` runs. First-time users can build without setting up the daemon; they opt in with `factory daemon start` when they want chat or Discord.

---

## 4. Components

| Component       | Location             | Process            | Responsibility                                                                                                                             |
| --------------- | -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`          | `packages/core`      | shared lib         | Types: `Directive`, `Event`, `Finding`, `Plan`, `Task`, `AgentRole`, `ModelCategory`, `AutonomyMode`. Zod schemas. Constants.              |
| `state`         | `packages/state`     | shared lib         | SQLite (better-sqlite3) wrapper, migrations, typed CRUD.                                                                                   |
| `ipc`           | `packages/ipc`       | shared lib         | HTTP contracts (Zod) + typed clients for daemon↔brain.                                                                                     |
| `logger`        | `packages/logger`    | shared lib         | Pino-based logger factory; correlation-ID propagation.                                                                                     |
| `channels`      | `packages/channels`  | daemon             | `ChannelPlugin` interface + impls (`cli-rpc`, `discord`).                                                                                  |
| `events`        | `packages/events`    | daemon             | Event sources — today `fs-watcher` (chokidar, debounced). `git-poll` stub pending a concrete use case. GitHub sources retired by ADR 0019. |
| `daemon`        | `packages/daemon`    | daemon             | Hosts channels + events + IPC server; lifecycle, config, signals.                                                                          |
| `providers`     | `packages/providers` | brain              | LLM clients: anthropic-sdk, openai-sdk, openrouter, claude-cli (subprocess), codex-cli (subprocess). Unified `ModelProvider` interface.    |
| `wiki`          | `packages/wiki`      | brain              | Read/write `docs/knowledge/`, `BUILD.md`, findings JSON; readiness gates.                                                                  |
| `assessor`      | `packages/assessor`  | brain              | Ground-truth checks: spawn pytest/jest/cargo/go-test, parse output, file/git/import checks. **No LLM**.                                    |
| `brain`         | `packages/brain`     | brain              | Triage → architect → plan → delegate → verify loop. Agent registry. Category routing. `ask_user`/`escalate_blocked` tools.                 |
| `worker`        | `packages/worker`    | brain (subprocess) | Per-task subprocess: allocate worktree, spawn coding-agent CLI, stream output, persist results.                                            |
| `cli`           | `packages/cli`       | brain              | Commander-based CLI. Wraps brain operations and daemon control.                                                                            |
| `apps/factory`  | `apps/factory`       | brain entry        | Wires `cli` + `brain` + `worker` + `providers` into the `factory` binary.                                                                  |
| `apps/factoryd` | `apps/factoryd`      | daemon entry       | Wires `daemon` + `channels` + `events` into the `factoryd` binary.                                                                         |

---

## 5. Languages and runtime

| Layer                                  | Language                                                   | Runtime                | Why                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| All factory code                       | **TypeScript** (strict)                                    | **Node 20+**           | Cross-platform without compile pain; official Anthropic/OpenAI SDKs; mature Discord ecosystem; fastest iteration |
| Both binaries                          | TypeScript bundled with `tsup`                             | Node 20+               | Single-file output for distribution                                                                              |
| SQLite driver                          | C++ via `better-sqlite3` (sync, prebuilt binaries)         | Node native module     | No async ceremony; prebuilt binaries for Win/Linux x64 + arm64                                                   |
| Coding agent (the actual code-writing) | Whatever the CLI is — `claude` (Node), `codex` (Rust/Node) | Subprocess             | We orchestrate the existing CLIs; we don't reimplement them                                                      |
| Test runners invoked by assessor       | Project's own — pytest, jest, vitest, cargo, go test, etc. | Subprocess             | Ground-truth verification means using the project's actual runner                                                |
| Skill/agent prompts                    | Markdown                                                   | None (read as text)    | Hot-reloadable; version-controllable; no compile step                                                            |
| Project templates                      | Whatever the template builds (Python/JS/Rust/etc.)         | None at template stage | Templates are example `CLAUDE.md` + scaffold files                                                               |

**No Python in factory itself.** Python only needed on the user's machine if they're building Python projects (so assessor can run `pytest`).

**No Rust in factory itself for v0.** `clawhip` exists as a reference. If we later extract the daemon for performance, that's a contained migration of one binary.

**Why Node and not Bun for v0:** Bun is faster and ergonomically nicer, but its Windows native-module story still occasionally surprises. Node + better-sqlite3 + discord.js + Pino on Windows is boring and reliable. Re-evaluate Bun once architecture stabilizes.

**Build/dev tooling:**

- `pnpm` — workspace manager (strict, fast, deterministic)
- `tsx` — dev (zero-config TS execution, watch mode)
- `tsup` — production builds (esbuild-based, fast, ESM output)
- `vitest` — tests (fast, ESM-native, watch mode)
- `eslint` + `@typescript-eslint` — lint
- `prettier` — format

---

## 6. Storage model

**Per-project state** lives in files inside each project directory (outside `factory5/`):

```
<workspace>/<project>/
├── CLAUDE.md                  ← user spec (input)
├── docs/knowledge/*.md        ← wiki (architect writes; ships with project)
├── BUILD.md                   ← findings, decisions, log (human-readable)
├── .factory/
│   ├── findings.json          ← finding lifecycle (mirrors BUILD.md table)
│   ├── plan.md                ← active plan (Boulder pattern from OmO)
│   ├── checkpoints/           ← resume points
│   ├── worktrees/             ← per-task git worktrees (parallel work isolation)
│   └── logs/build-<ts>.log    ← per-build log mirror
└── src/, tests/, ...          ← the project being built
```

This keeps the project portable, human-readable, git-committable, and Obsidian-browsable — same as factory2.

**Factory runtime state** lives in one SQLite file at `~/.factory5/factory.db`:

| Table               | Purpose                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `directives`        | Inbound work queue across all channels. FIFO, status lifecycle, claim model.                     |
| `outbound_messages` | Brain → channels delivery queue with audit.                                                      |
| `events_audit`      | Every event ever seen. Debugging gold.                                                           |
| `sessions`          | Per-channel/per-user conversational state (Discord channel ID → context).                        |
| `pending_questions` | `ask_user` calls awaiting reply (survives brain restart).                                        |
| `tasks_inflight`    | Currently-running worker tasks (worktree path, agent, started_at, last heartbeat).               |
| `projects`          | Registry of all projects factory has touched (name → workspace path → status).                   |
| `learnings`         | Cross-project patterns extracted from past builds (the `~/.factory/learnings.md` from factory2). |
| `model_usage`       | Token/cost tracking per provider per directive (budget enforcement, reporting).                  |

Why SQLite for these: atomicity (concurrent writes from daemon + workers + brain), queries ("show all stuck builds"), single-file ops (zero admin), survives crashes.

Why not SQLite for project state: project state is markdown by design (factory2's wiki philosophy), portable with the project, human-readable, ships as documentation.

---

## 7. Control flow — representative example

User types `factory build my-app --autonomy assisted`:

1. **CLI** parses, constructs `Directive { source: "cli", intent: "build", project: "my-app", autonomy: "assisted" }`, writes to SQLite `directives`, claims it (in-process — no daemon needed for inline build), starts brain.
2. **Brain.triage** (Haiku, ~1s) classifies as `build`. Writes `events_audit`.
3. **Brain.confirm** (because autonomy=assisted) prints plan summary to CLI; awaits keypress.
4. **Brain.architect** (Opus, ~30s) reads `CLAUDE.md`, writes `docs/knowledge/*.md` wiki to project. Wiki readiness gate runs.
5. **Brain.plan** (Sonnet, ~10s) decomposes into task DAG, writes `.factory/plan.md`.
6. **Brain.delegate** spawns N **worker** subprocesses in parallel for independent tasks. Each gets its own git worktree at `<project>/.factory/worktrees/task-<id>/`.
7. Each **worker** runs `claude -p` (or `codex` based on category routing), streams output to its log file, parses `FINDING [HIGH] ...` markers, writes to `BUILD.md` + `findings.json` + SQLite `tasks_inflight`.
8. Brain polls task completion; on completion runs **assessor** (real pytest etc., no LLM).
9. If assessor passes for a milestone: brain reports back to CLI, awaits next-checkpoint approval (assisted mode).
10. If assessor fails: brain.investigator (Opus) diagnoses → either fixes directly or schedules a fix task.
11. On full completion or block: brain writes terminal directive status, returns control to CLI.

For Discord-driven flow: same path, except step 1 happens in **factoryd** (Discord adapter creates the directive), and steps 3/9 use `ask_user` tool that posts to the originating Discord thread via the daemon's `POST /send` IPC and awaits a reply (stored in `pending_questions`, survives brain restart).

---

## 8. Data contracts (in `packages/core`)

```ts
type AutonomyMode = "chat" | "assisted" | "autonomous";

type ChannelId = "cli" | "discord" | "telegram" | "github" | "webhook";

type Intent =
  | "build"        // produce new software from spec
  | "fix"          // fix a problem in existing code
  | "review"       // adversarial review
  | "investigate"  // diagnose without changing
  | "chat"         // conversational Q&A
  | "status"       // report state
  | "resume"       // continue a stopped build
  | "cancel";      // stop a running build

type Directive = {
  id: string;            // ulid
  source: ChannelId;
  principal: string;     // user identifier scoped to source (e.g., discord user id)
  channelRef: string;    // e.g. discord channel/thread id, cli session id
  intent: Intent;
  payload: unknown;      // intent-specific shape
  autonomy: AutonomyMode;
  createdAt: string;     // ISO8601
  status: "pending" | "claimed" | "running" | "blocked" | "complete" | "failed";
  claimedBy?: string;    // brain process id
  parentDirectiveId?: string;
};

type Event = {
  id: string;
  source: string;        // "github" | "git" | "fs" | "tmux" | "channel"
  body: EventBody;       // typed union
  metadata: Record<string, unknown>;
  receivedAt: string;
};

type EventBody =
  | { kind: "github.issue.opened"; repo: string; number: number; title: string; ... }
  | { kind: "github.pr.status"; repo: string; number: number; status: string; ... }
  | { kind: "git.commit"; repo: string; sha: string; summary: string; branch: string }
  | { kind: "fs.changed"; path: string; type: "create" | "modify" | "delete" }
  | { kind: "channel.message"; channel: ChannelId; principal: string; ref: string; text: string };

type Finding = {
  id: string;            // F001-style, project-scoped
  source: AgentRole;
  target: string;        // file path or module name
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "FIXED" | "VERIFIED" | "WONTFIX";
  description: string;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
};

type Plan = {
  id: string;
  directiveId: string;
  projectPath: string;
  tasks: Task[];         // DAG with dependencies
  createdAt: string;
  status: "draft" | "active" | "complete" | "abandoned";
};

type Task = {
  id: string;
  planId: string;
  title: string;
  agent: AgentRole;
  category: ModelCategory;
  inputs: { files: string[]; context: string };
  expectedOutputs: { files: string[]; signals: string[] };
  dependsOn: string[];   // task IDs
  status: "pending" | "running" | "complete" | "failed" | "blocked";
  attempts: number;
  worktreePath?: string;
  result?: TaskResult;
};

type AgentRole =
  | "triage"        // classify intent
  | "architect"     // design wiki
  | "planner"       // task DAG
  | "scaffolder"    // project setup
  | "builder"       // implement modules (TDD)
  | "reviewer"      // adversarial review
  | "fixer"         // address findings
  | "investigator"  // diagnose without changing
  | "verifier";     // final checklist

type ModelCategory =
  | "quick"         // triage, classification (Haiku-tier)
  | "planning"      // task decomposition (Sonnet-tier)
  | "reasoning"     // architecture, deep diagnosis (Opus-tier)
  | "deep"          // long autonomous execution (Opus or GPT-tier)
  | "documentation"; // doc generation (Haiku-tier)
```

These types are load-bearing across every package. Changes go through an ADR.

---

## 9. Channels

`ChannelPlugin` interface in `packages/channels`:

```ts
interface ChannelPlugin {
  id: ChannelId;
  capabilities: {
    inbound: boolean;
    outbound: boolean;
    threading: boolean; // can post in threads/replies
    interactive: boolean; // supports ask_user
    fileAttachments: boolean;
  };
  configSchema: ZodSchema;
  start(ctx: ChannelContext): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<SendResult>;
}
```

Day-1 channels:

- **`cli-rpc`** — local Unix socket / named pipe so the `factory` CLI and `factoryd` daemon can converse for chat sessions
- **`discord`** — discord.js, supports threading + interactive

Phase-2 channels (added without changing brain):

- **`telegram`** — grammy
- **`web`** — small SSE+REST server for browser UI

---

## 10. Provider / model routing

Multi-provider via category routing (lifted from oh-my-openagent).

```ts
interface ModelProvider {
  id: string; // "anthropic-api", "claude-cli", "openai", "openrouter", "codex-cli"
  available(): Promise<boolean>;
  call(req: ProviderRequest): Promise<ProviderResponse>;
  stream(req: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}

type ProviderRequest = {
  model: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  reasoning?: 'low' | 'medium' | 'high' | 'max';
};
```

**Resolution pipeline (4-step, lifted from OmO):**

1. **Per-directive override** (user explicit `--model` or per-session config)
2. **Category default** (from `~/.factory5/config.toml` `[categories]` section)
3. **Provider fallback chain** (next available provider in chain)
4. **System default** (final fallback — usually `claude-cli` if subscription is set up)

**Default category mapping (overridable):**

```toml
[categories]
quick         = { provider = "anthropic-api", model = "claude-haiku-4-5" }
planning      = { provider = "anthropic-api", model = "claude-sonnet-4-6" }
reasoning     = { provider = "claude-cli",    model = "claude-opus-4-7" }
deep          = { provider = "claude-cli",    model = "claude-opus-4-7" }
documentation = { provider = "anthropic-api", model = "claude-haiku-4-5" }

[fallback_chains]
quick     = ["anthropic-api/haiku", "openai/gpt-4o-mini", "openrouter/llama-3"]
reasoning = ["claude-cli/opus", "anthropic-api/opus", "openai/gpt-5", "openrouter/sonnet"]
```

**Dual fallback (proactive + reactive):**

- **Proactive** at config-load: if `claude-cli` reports unavailable on startup, brain pre-rebinds reasoning to next chain entry and warns.
- **Reactive** at runtime: if a call fails (rate limit, error), the provider layer transparently retries with the next chain entry; brain receives a successful response with a fallback annotation in metadata.

---

## 11. Autonomy modes

Three modes per directive — the brain owns _when to talk back_:

| Mode                       | Behavior                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`chat`**                 | Turn-by-turn. Every step asks. For Q&A, brainstorming, light edits.                                                                                                                                                                                                                  |
| **`assisted`** _(default)_ | Brain produces plan → asks user to confirm → executes between checkpoints (per phase boundary, not per step) → asks at next checkpoint.                                                                                                                                              |
| **`autonomous`**           | Runs to completion without checkpoints, **except**: (a) brain pauses and asks user when ambiguity blocks progress; (b) brain escalates to user if a task fails its retry budget; (c) brain reports milestones (start, design done, build done, complete/blocked). No silent looping. |

Two brain-side tools enable mid-flight engagement:

- **`ask_user(question, options?, deadline?)`** — pauses execution, posts to originating channel, awaits a reply (default: indefinitely). Stored in `pending_questions`. Survives brain restart. Phase 8 ([ADR 0024](docs/decisions/0024-worker-subprocess-ask-user.md)) extends this to tool-using worker subprocesses (scaffolder/builder/fixer/investigator) via an MCP tool (`mcp__factory5-ask-user__ask_user`) that routes to `POST /worker/ask-user` on the daemon, which proxies into this same brain-level helper. `max_usd`/`max_steps` are paused while a worker is waiting (per ADR 0024 §2); `tasks_inflight.status='waiting_for_human'` lets brain-restart orphan recovery detect workers killed mid-wait.
- **`escalate_blocked(reason, attempted, suggestions)`** — fires when retry budget exhausted or circuit breaker tripped. Posts a structured "I'm stuck — here's what I tried, here's what I'd suggest, what should I do?" message; awaits direction.

---

## 12. Safety / anti-loop guardrails (lifted from OmO)

- **Per-task retry budget** (default 3 attempts → escalate, never infinite)
- **Repetitive-tool-use detector** (same tool with same args 3× in a row → abort & escalate)
- **Per-build cost ceiling** (configurable `max_usd` or `max_steps`)
- **Stall detector** (no state-hash change in N steps → escalate)
- **Circuit breakers per provider** (mark unavailable for cooldown_seconds after error burst)
- **Budget tracking** in `model_usage` table — hard ceiling enforced before each call
- **Worker timeouts** (default 30 min per task → kill worker, mark failed, escalate)

---

## 13. Logging — first-class from day 1

**Library:** Pino. Fast, structured (JSON), pretty-prints in dev, writes JSON in prod.

**Topology:**

- Single root config in `packages/logger`
- Each package imports `createLogger("brain.triage")` — gets a child with stable name
- Every directive/task/session has a `correlationId` (ULID) propagated via `logger.child({ directiveId, taskId })`

**Levels (used consistently):**

- `trace` — verbose internals (off by default; on per-component via env var)
- `debug` — development detail
- `info` — normal lifecycle
- `warn` — recoverable issues (provider fallback engaged)
- `error` — failures with stack traces

**Sinks (configured at process start):**

- **Console** — pretty-printed colorized when stdout is a TTY, JSON otherwise
- **File** — JSON to `~/.factory5/logs/<process>-<date>.log`, daily rotation, 14-day retention
- **Per-build file** — when a build is active, mirror brain logs scoped to that build into `<project>/.factory/logs/build-<ts>.log`

**Operator interface:**

- `factory logs` — tail logs across all components, with filters (`--component brain`, `--directive <id>`, `--level warn+`, `--since 1h`)
- `factory logs --follow` — live tail
- `factory daemon logs` — daemon-specific
- `factory inspect <directiveId>` — pulls all log lines for a directive across processes via correlationId

**Day-1 rule:** No `console.log` anywhere. Every package uses `createLogger(name)`. Lint rule enforces it.

---

## 14. Documentation — first-class from day 1

Three layers, each with clear ownership and update cadence.

### a) Code documentation

- TSDoc on every exported function, type, class
- Each `packages/*/README.md` documents that package's purpose, public API, dependencies, examples
- Generated API docs via TypeDoc into `docs/api/` on release

### b) Architecture documentation (`docs/`)

- `docs/ARCHITECTURE.md` — single source of truth for the architecture (mirrors this file but is allowed to evolve)
- `docs/CONTRACTS.md` — generated from Zod schemas in `core/`; describes Directive/Event/Finding/Plan/Task shapes
- `docs/decisions/` — Architecture Decision Records (ADRs). One file per significant decision: Context / Decision / Consequences / Alternatives. Append-only.
- `docs/SKILLS.md` — index of all skills in `skills/` (what each does, when applied)
- `docs/AGENTS.md` — index of all agent roles, their model categories, their tools, their prompts

### c) Runtime documentation (auto-produced)

- Every directive produces a markdown trail in `<project>/.factory/runs/<directive-id>/` containing: the directive, the plan, all findings, all task results, the final disposition
- Queryable via `factory inspect <directiveId>`

### Initial ADRs (written at scaffold)

- `0001-typescript-on-node.md` — language and runtime choice
- `0002-two-binary-split.md` — daemon as a separate process from day 1
- `0003-sqlite-and-files-hybrid-storage.md` — wiki for projects, SQLite for runtime
- `0004-category-based-model-routing.md` — declare intent not agent
- `0005-three-autonomy-modes.md` — chat/assisted/autonomous + ask_user/escalate_blocked

---

## 15. Task logs and context-drift prevention

The factory's own thesis (design before code, ground-truth verification, finding lifecycle) applies to building factory itself. Eat our own dog food.

**`CLAUDE.md` at repo root** — first thing every Claude Code session reads when working on factory5. Contains:

- Pointer to `docs/ARCHITECTURE.md` (read before touching code)
- Pointer to `docs/PROGRESS.md` (read to understand where we are)
- Non-negotiable rules (no `console.log`, no `any`, every package needs README + tests, no orphan files)
- "Before you finish" checklist (update PROGRESS, regenerate CONTRACTS if types changed, add ADR if you made a decision, run tests, run lint)

**`docs/PROGRESS.md`** — chronological log of progress on factory5 itself, updated at the end of every working session. The canonical "what's been built and what's next." Every new session reads this before doing anything.

**`docs/issues/`** — internal issue tracker for factory5, modeled on factory's own findings pattern:

- One markdown file per issue, named `I001-short-title.md`
- Frontmatter: `id`, `severity`, `status` (OPEN / IN_PROGRESS / RESOLVED / VERIFIED), `area`, `created`, `resolved`
- Body: description, repro, hypothesis, resolution
- Indexed by `docs/issues/INDEX.md`

**`docs/decisions/`** — ADRs as above. New decisions get a new ADR; we don't argue against past decisions in code reviews — we argue them in a new ADR that supersedes the old one (`Supersedes: 0003`).

**Verification gates before marking work "done"** (same discipline factory imposes on its outputs):

- All tests pass (`pnpm test`)
- All packages build (`pnpm build`)
- Lint clean (`pnpm lint`)
- PROGRESS.md updated
- Types/contracts changed: CONTRACTS.md regenerated
- Decision made: ADR added
- Each package touched: its README still accurate

---

## 16. Workspace layout

```
factory5/
├── CompleteArchitecture.md      ← this file (snapshot)
├── CLAUDE.md                    ← guidance for Claude Code working on factory5
├── README.md                    ← top-level intro + dev quickstart
├── package.json                 ← workspace root
├── pnpm-workspace.yaml          ← workspace definition
├── tsconfig.base.json           ← shared TS config
├── .gitignore  .editorconfig  .prettierrc  .eslintrc.cjs  .nvmrc
├── vitest.config.ts             ← shared test config
├── packages/                    ← libraries (no entry point)
│   ├── core/
│   ├── logger/
│   ├── state/
│   ├── ipc/
│   ├── providers/
│   ├── wiki/
│   ├── assessor/
│   ├── brain/
│   ├── worker/
│   ├── channels/
│   ├── events/
│   ├── daemon/
│   └── cli/
├── apps/                        ← runnable binaries
│   ├── factory/                 ← CLI + brain entry
│   └── factoryd/                ← daemon entry
├── prompts/                     ← agent system prompts (markdown, hot-reloadable)
│   └── agents/
├── skills/                      ← skill methodology files (ported from factory2)
├── templates/                   ← project templates (ported from factory2)
├── migrations/                  ← SQLite schema (raw .sql, applied by state package)
└── docs/
    ├── ARCHITECTURE.md
    ├── PROGRESS.md
    ├── CONTRACTS.md
    ├── SKILLS.md
    ├── AGENTS.md
    ├── decisions/
    │   ├── INDEX.md
    │   ├── 0001-typescript-on-node.md
    │   ├── 0002-two-binary-split.md
    │   ├── 0003-sqlite-and-files-hybrid-storage.md
    │   ├── 0004-category-based-model-routing.md
    │   └── 0005-three-autonomy-modes.md
    └── issues/
        └── INDEX.md
```

---

## 17. Build / dev workflow

```bash
# Setup (once)
cd factory5
pnpm install

# Dev (per package, watch mode)
pnpm --filter @factory5/brain dev

# Run binaries from source (no build needed)
pnpm tsx apps/factory/src/main.ts --version
pnpm tsx apps/factoryd/src/main.ts --version

# Build (production bundles in dist/)
pnpm build

# Test
pnpm test            # all packages
pnpm test:watch      # watch mode
pnpm --filter @factory5/state test  # single package

# Lint + format
pnpm lint
pnpm format

# Run the binaries after build
node apps/factory/dist/main.js --help
node apps/factoryd/dist/main.js --help
```

---

## 18. Cross-platform notes

- All paths via `node:path` (`path.join`, `path.sep`); never string-concatenate `/`
- All env home via `os.homedir()`
- Spawn subprocesses with `{ shell: false }` and explicit args array; avoid shell-string interpolation
- File watchers via `chokidar` (cross-platform abstraction over inotify/FSEvents/ReadDirectoryChangesW)
- Line endings: write `os.EOL` for files we generate; respect existing line endings in files we edit
- tmux integration is feature-flagged Linux/Mac only
- Service installation: systemd unit on Linux, NSSM-based Windows Service installer; one `factory daemon install` command branches on platform

---

## 19. Roadmap (rough phases — not committed, indicative)

**Phase 0 — Skeleton (this scaffold).** Everything compiles; logging wired everywhere; types and contracts settled; docs scaffolded.

**Phase 1 — Inline build.** `factory build <project>` works end-to-end without daemon. Triage stub → architect → plan → one builder → assessor → done. Single provider (claude-cli). Synchronous, no parallelism. Findings tracked in BUILD.md.

**Phase 2 — Parallel + multi-provider.** Worker pool, worktree isolation, parallel task DAG, second provider (anthropic-api), category routing live, dual fallback live.

**Phase 3 — Daemon + CLI chat.** `factoryd` running, `factory chat` interactive against daemon, IPC live, SQLite as bus.

**Phase 4 — Discord channel.** Discord adapter, threaded conversations, ask_user round-trips through Discord, escalate_blocked posts to channel.

**Phase 5 — Green-verify end-to-end.** Autonomous loop proven end-to-end against a live corpus; ground-truth assessor gate owns the success criterion; every factory5 self-issue from phases 4–5 resolved. (Originally scoped as "GitHub events" at scaffold time; retargeted during actual execution, with the GitHub work retired by ADR 0019.)

**Phase 6 — Operator-trust + multi-surface.** Cross-project findings registry (6a ✅); verifier advisory-only (6c ✅); GitHub channel dropped (6b, per ADR 0019).

**Phase 7 — Operator-control + budget discipline.** Pre-call `max_usd` / `max_steps` enforcement (7a); cross-session spend dashboard (7b); Telegram channel (7c).

---

## 20. What scaffolding produces (this commit)

- `CompleteArchitecture.md` (this file) at repo root
- `CLAUDE.md` at repo root (guidance for Claude Code)
- `README.md` at repo root
- Workspace config: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, lint/format/test config
- `docs/` tree fully populated (ARCHITECTURE, PROGRESS, CONTRACTS, SKILLS, AGENTS, ADRs 0001–0005, issues INDEX)
- All 13 `packages/*` stubbed with `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`
- `packages/core` types fully defined (Directive, Event, Finding, Plan, Task, etc.) with Zod schemas
- `packages/logger` implemented (Pino, child loggers, sinks)
- `packages/state` implemented (better-sqlite3, migrations runner, typed CRUD stubs)
- `packages/ipc` HTTP contracts defined (Zod) with typed clients
- `apps/factory` and `apps/factoryd` stubs that respond to `--version` and `--help`
- `migrations/` initial SQLite schema for all listed tables
- `skills/` ported verbatim from `factory2/skills/`
- `templates/` ported verbatim from `factory2/templates/`
- `prompts/agents/` ported from `factory2/agents/`

After scaffold: `pnpm install && pnpm build` compiles cleanly on Windows + Linux. No LLM calls yet, no Discord yet, no actual builds yet. But every subsequent slice (CLI channel, brain triage, first worker, Discord adapter) drops cleanly into the structure without re-shaping anything. (The scaffold also included GitHub-event slots that were retired by ADR 0019 before ever being implemented — see that ADR for the design reversal.)

---

## 21. Web UI (Phase 9, added post-scaffold)

factoryd's Fastify server (§3, port 25295) grew two surfaces in Phase 9 without any process split: a **static SPA bundle** under `/app/*` and a **read-only JSON API** under `/api/v1/*`. The SPA is an Astro app at `apps/factory-web/` (file-based routing, Islands-on-demand, `<ClientRouter />` for cross-page transition feel); its `dist/` is served via `@fastify/static` in production and proxied via Vite (port 4321) in dev. The API is bearer-gated by a new `FACTORY5_UI_TOKEN` minted per factoryd startup alongside the existing worker token (§3), distributed to the operator via the `ui: http://127.0.0.1:25295/app/?t=<48-hex>` line on stdout — the SPA strips the query param into `sessionStorage` on first load. The JSON API returns four aggregations in the read-side (directives, pending-questions, spend, findings) plus a status smoke, and echoes query filters back in the envelope so pages can render stable filter UIs.

Authoritative design: [ADR 0025](docs/decisions/0025-web-ui-architecture.md) (framework + auth + bundling + routing). Phase 9 shipped read-only (9a) per the charter; the mutation surface (9b — answer a pending question from the browser, kick off a build) was deferred as a later phase.
