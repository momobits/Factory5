# Factory 5

Autonomous (and human-directable) software builder. Drop a spec, get a project. Talk to the factory in chat, point it at a GitHub issue, or kick off an inline build from the CLI — same brain, multiple channels.

> **Status:** scaffolding phase. Skeleton compiles; no build flow yet. See [`docs/PROGRESS.md`](docs/PROGRESS.md) for the running log.

## What this is

- **Multi-channel input:** CLI, Discord (day 1), Telegram + Web UI (later), GitHub events
- **Multi-provider models:** Claude subscription (primary), Claude API, Codex, OpenRouter, OpenAI — selected per agent role via category routing
- **Three autonomy modes:** `chat` (turn-by-turn), `assisted` (default — autonomous between checkpoints), `autonomous` (full self-drive with mid-flight escalation when stuck)
- **Verification-first:** ground-truth assessor (real `pytest`/`jest`/`cargo test`/etc.) — agents can't claim false progress
- **Knowledge wiki + finding lifecycle:** designs codified before code; cross-agent dialogue with stable IDs
- **Two-process design:** `factory` (CLI + brain) and `factoryd` (daemon owning all I/O). Daemon optional for inline builds.

See **[`CompleteArchitecture.md`](CompleteArchitecture.md)** for the full design.

## Quick start (developer)

```bash
# Prerequisites: Node 20+, pnpm 9+, git
# Optional but recommended on Windows: enable long paths (`git config --system core.longpaths true`)

pnpm install
pnpm build
pnpm test

# Run binaries from source (no rebuild needed)
pnpm factory --version
pnpm factoryd --version
```

## Layout

```
factory5/
├── CompleteArchitecture.md    ← canonical design doc
├── CLAUDE.md                  ← guidance for Claude Code working on factory5 itself
├── packages/                  ← libraries (core, state, ipc, logger, brain, ...)
├── apps/                      ← runnable binaries (factory, factoryd)
├── prompts/                   ← agent system prompts (markdown)
├── skills/                    ← skill methodology files
├── templates/                 ← project templates
├── migrations/                ← SQLite schema
└── docs/                      ← architecture, ADRs, progress, contracts
```

## Documentation

- [`CompleteArchitecture.md`](CompleteArchitecture.md) — canonical design (snapshot)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current architecture (evolves)
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — chronological progress log
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — data contracts (Directive, Event, etc.)
- [`docs/decisions/`](docs/decisions) — Architecture Decision Records
- [`docs/SKILLS.md`](docs/SKILLS.md) — skill catalog
- [`docs/AGENTS.md`](docs/AGENTS.md) — agent role catalog
- [`docs/issues/`](docs/issues) — internal issue tracker

## Contributing / working on factory5

Every working session reads [`CLAUDE.md`](CLAUDE.md) first — it's the standing brief.

## License

MIT
