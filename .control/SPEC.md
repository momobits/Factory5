# Project Spec

> **Canonical project spec (Control v2.0).** Source of truth for scope, architecture, decisions, and design rules. Distilled docs (`.control/architecture/phase-plan.md`, per-phase READMEs) derive from this file; when they disagree, this file wins.
>
> **Spec evolution lives in this file's git history.** Amend with `/spec-amend <slug>` to append a dated artifact section under "Artifacts (chronological)" below — OR edit the canonical sections directly when reframing fundamentals. Either way, `git log .control/SPEC.md` is the authoritative history.

---

## Overview

factory5 is a multi-channel, autonomous software builder. It accepts requirements via CLI, Discord, Telegram, or a web UI; designs, implements, tests, and verifies projects through a verification-first build loop; and runs against four pluggable language runtimes (Python, Node, Go, Rust). Two binaries: `factory` (CLI + brain, per-invocation or long-lived) and `factoryd` (daemon owning channel I/O, fs watching, web UI, and the brain supervisor). The system is at v1 — working end-to-end across all four channels and all four runtimes, 876 tests passing across 15 packages — and is now in a "first-class polish" arc to close UX gaps without architectural changes.

The full system reference lives in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). The 28 ADRs in [`docs/decisions/`](../docs/decisions) document every architectural choice and its rationale.

## Problem statement

The system works but isn't first-class. Six surfaces need polish: (1) the web UI is functional but bare — no live updates, no chat, no cancel, vanilla DOM-in-Astro instead of components; (2) Discord and Telegram only emit `intent=build` and `intent=chat` — they can't reach the other six brain intents (`status`, `spend`, `findings`, `resume`, `cancel`, `budget`); (3) onboarding is missing the most-used surfaces (no web UI walkthrough, no `factory chat` walkthrough, no canonical workflows doc); (4) the CLI is missing `cancel`, `budget set`, `project list`, `ask`, tab completion; (5) two package READMEs are stale (`packages/cli`, `packages/channels`); (6) no `docs/WORKFLOWS.md` exists. The full audit is in [`UPGRADE/AUDIT.md`](../UPGRADE/AUDIT.md); 23 catalogued issues in [`UPGRADE/ISSUES.md`](../UPGRADE/ISSUES.md).

## Scope

**In scope:**

- **Doc cleanup** — fix stale `packages/cli/README.md` and `packages/channels/README.md`; add web UI + chat sections to `docs/ONBOARDING.md`; write new `docs/WORKFLOWS.md` (four canonical loops + decision matrix + CLAUDE.md authoring guide).
- **Channel parity** — Discord slash commands (`/factory status / spend / findings / resume / cancel / budget`); Telegram `setMyCommands` + parser; pending-question button affordances on both surfaces; `factory cancel` with real worker kill (not just status flip); brain triage classifies chat across all eight intents.
- **Web UI** — SSE for live directive detail updates; Astro component library (retiring the `el()` builder); `/app/chat` page; cancel/pause buttons; `/app/projects/new`; spend charts; mobile-responsive nav; logout + connection-status indicator.
- **CLI completion** — `factory cancel`, `factory budget set`, `factory project list/show/delete`, `factory ask`, tab completion (bash/zsh/pwsh), rich `--help` examples on every command.

**Out of scope (deferred until demand signals):**

- **Bash sandboxing** — incident-driven; ADR 0028 §4 deferral remains active; no demand signal yet across Phases 12–14.
- **Network egress scoping** — long-tail; no egress-policy demand signal.
- **Multi-user UI auth** — single-operator design is fine for now.
- **Multi-tenant SaaS daemon** — out of charter.
- **VS Code extension** — out of charter.
- **Hosted "factory cloud"** — out of charter.

## Tech choices

| Layer                                | Choice                                                                                | ADR                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / runtime                   | TypeScript on Node 20+                                                                | [0001](../docs/decisions/0001-typescript-on-node.md)                                                                                                                                                                                                                                                                                               |
| Process model                        | Two binaries — `factory` (CLI + brain) + `factoryd` (daemon)                          | [0002](../docs/decisions/0002-two-binary-split.md)                                                                                                                                                                                                                                                                                                 |
| Storage                              | Files for project state; SQLite for factory runtime state (`<repo>/.factory/`)        | [0003](../docs/decisions/0003-sqlite-and-files-hybrid-storage.md), [0023](../docs/decisions/0023-repo-local-instance-and-cwd-walk.md)                                                                                                                                                                                                              |
| Model routing                        | Category-based — declare _intent_, not _agent_                                        | [0004](../docs/decisions/0004-category-based-model-routing.md)                                                                                                                                                                                                                                                                                     |
| Channels                             | `cli-rpc` (HTTP+SQLite); Discord (discord.js); Telegram (grammy long-poll); Web (Fastify + Astro) | [0014](../docs/decisions/0014-cli-rpc-transport.md), [0022](../docs/decisions/0022-telegram-polling-in-plugin.md), [0025](../docs/decisions/0025-web-ui-architecture.md), [0027](../docs/decisions/0027-web-ui-mutation-surface.md)                                                                                                                  |
| Worker                               | Per-task git worktrees + tool-using `claude -p` subprocess + per-spawn fs sandbox     | [0007](../docs/decisions/0007-phase-2-tool-using-worker-subprocess.md), [0008](../docs/decisions/0008-per-task-git-worktrees.md), [0024](../docs/decisions/0024-worker-subprocess-ask-user.md), [0028](../docs/decisions/0028-worker-sandbox-contract.md)                                                                                            |
| Assessor                             | Pluggable runtimes (Python / Node / Go / Rust); ground-truth verification, no LLM    | [0026](../docs/decisions/0026-pluggable-runtime-contract.md)                                                                                                                                                                                                                                                                                       |
| Budget                               | Pre-call enforcement; rolling-average estimator; three-tier merge (flag → project → config) | [0020](../docs/decisions/0020-pre-call-budget-enforcement.md), [0021](../docs/decisions/0021-first-class-project-identity.md), [0027](../docs/decisions/0027-web-ui-mutation-surface.md)                                                                                                                                                            |
| Build / dev tooling                  | `pnpm` workspace, `tsx` (dev), `tsup` (prod), `vitest`, `eslint`, `prettier`           | —                                                                                                                                                                                                                                                                                                                                                  |

## High-level architecture

See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the canonical reference (~250-line system doc; rewritten 2026-05-02 from current code). Summary shape:

- 15 internal packages + 2 binary apps (`factory`, `factoryd`) + 1 web app (`factory-web`).
- Daemon hosts Fastify on `127.0.0.1:25295` with `/api/v1/*` JSON API + `/app/*` static SPA mount.
- SQLite at `<repo>/.factory/factory.db` (or `~/.factory/factory.db` fallback) is the durable bus + audit log; HTTP is a low-latency doorbell with 250ms polling fallback.
- Brain runs the verify-first build loop: triage → architect → planner → delegate-in-parallel → assessor (no LLM) → verify → loop or escalate (`askUser` / `escalateBlocked`).
- Workers run per-task in isolated git worktrees with per-spawn fs sandbox (deny rules + PreToolUse hook + acceptEdits permission mode, ADR 0028).
- All four channels (CLI-RPC, Discord, Telegram, Web) emit the same `Directive` shape — channel-agnostic from the brain's POV.

## Key interfaces

- **Data shapes** — `Directive`, `Event`, `Finding`, `Plan`, `Task`, `AgentRole`, `ModelCategory`, `AutonomyMode`. Zod-validated. See [`docs/CONTRACTS.md`](../docs/CONTRACTS.md).
- **Channel plugin** — `ChannelPlugin` interface (`packages/channels/src/types.ts`). Inbound: parse external message → `Directive` via `ctx.onInbound`. Outbound: `send(OutboundMessage) → SendResult`.
- **Runtime assessor** — `RuntimeAssessor` contract per ADR 0026. Provisioner shape (env-owning vs env-assuming), verify-gate command sequence, host-tool pre-flight.
- **Worker sandbox** — `WorkerSandboxConfig { workspaceRoots, readOnlyRoots, allowSymlinks }`. See ADR 0028.
- **Web mutation surface** — three routes: `POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`. See ADR 0027.
- **Worker askUser** — MCP tool `mcp__factory5-ask-user__ask_user` proxying to `POST /worker/ask-user` on factoryd. See ADR 0024.

## Project-specific invariants

(Distilled from CLAUDE.md "Non-negotiable rules" + ADRs. Don't paraphrase loosely; if you're unsure, read the source.)

- **No `console.log`.** Use `createLogger(name)` from `@factory5/logger` everywhere except in the logger package itself. Lint enforces it.
- **No `any`.** TypeScript strict mode + `@typescript-eslint/no-explicit-any: error`. Use `unknown` and narrow at boundaries.
- **Cross-platform always.** Windows + Linux must both work. Use `node:path`, `os.homedir()`, `os.EOL`. Never string-concatenate `/` for paths. Spawn subprocesses with `{ shell: false }` and explicit args arrays.
- **Per-package shape:** `package.json`, `tsconfig.json` extending root, `README.md`, `src/index.ts`, at least one `*.test.ts` once it has logic. All public exports TSDoc'd.
- **ADRs go in `docs/decisions/`** with `NNNN` numbering — append-only; supersede rather than amend. `.control/architecture/decisions/` stays empty (project-specific override of Control's default).
- **Issues for upgrade work go in [`UPGRADE/ISSUES.md`](../UPGRADE/ISSUES.md).** Operational issues that fit Control's `/new-issue` flow can use `.control/issues/`.
- **Four `pnpm` gates clean before declaring work done:** `build`, `test`, `lint`, `format:check`. No exceptions.
- **GitHub integration is permanently retired.** ADR 0019 documents the doctrine: factory's effects in the world are operator-directed per-directive, not pattern-driven. No bringing back GitHub polling, webhook ingress, or `factory push`.
- **The brain understands eight intents:** `build`, `fix`, `review`, `investigate`, `chat`, `status`, `resume`, `cancel`. Channels should reach all eight (the upgrade work in scope above closes this gap for Discord + Telegram).
- **Cwd-walk discovery for repo-local instances** (ADR 0023). `.factory/` directory at repo root marks an instance; `FACTORY5_DATA_DIR` overrides; `~/.factory/` fallback. Never write to `~/.factory5/` from worker code.

## Phases

Four phases mapped 1:1 onto the [`UPGRADE/ROADMAP.md`](../UPGRADE/ROADMAP.md) tier structure. Per-phase implementation detail lives in [`UPGRADE/plans/tier-N-*.md`](../UPGRADE/plans) (richer than `.control/phases/phase-N-<name>/README.md`); Control phase docs are the operational checklist + commit-shape contract.

| Phase | Name           | Maps to                                                                                       | Estimated     |
| ----- | -------------- | --------------------------------------------------------------------------------------------- | ------------- |
| 1     | doc-sweep      | Tier 1 — Doc + UX cleanup                                                                     | ~1 session    |
| 2     | channel-parity | Tier 2 — Channel parity (Discord slash + Telegram bot commands + cancel + triage)             | ~2 sessions   |
| 3     | web-ui         | Tier 3 — Web UI live + complete (SSE, components, chat, mobile)                               | ~2-3 sessions |
| 4     | cli-completion | Tier 4 — CLI completion (cancel, budget, project, ask, tab-completion, --help examples)       | ~1 session    |

Phases 3 and 4 share no critical code, so the operator can pick either after Phase 2 closes. Open issues (U001-U023) tagged with the phase that closes each.

---

## Artifacts (chronological)

<!-- Spec evolutions over time, appended by /spec-amend <slug>. Newer artifacts
take precedence over older content in the canonical sections above. The commit
log of this file (`git log .control/SPEC.md`) is the authoritative history;
this section is the in-document view. -->

<!-- Use /spec-amend <slug> to add a new artifact here. -->
