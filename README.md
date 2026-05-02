# Factory 5

Autonomous (and human-directable) software builder. Drop a spec, get a project. Talk to the factory in chat or kick off an inline build from the CLI — same brain, multiple channels.

## What this is

- **Multi-channel input:** CLI, Discord, Telegram, web UI
- **Multi-provider models:** Claude subscription (primary), Claude API, Codex, OpenRouter, OpenAI — selected per agent role via category routing
- **Three autonomy modes:** `chat` (turn-by-turn), `assisted` (default — autonomous between checkpoints), `autonomous` (full self-drive with mid-flight escalation when stuck)
- **Verification-first:** ground-truth assessor (real `pytest` / `pnpm test` / `go test` / `cargo test`) — agents can't claim false progress
- **Pluggable runtimes:** Python, Node, Go, Rust — selected per-directive
- **Per-spawn worker sandbox:** path-prefix-scoped fs access for tool-using subprocesses
- **Two-process design:** `factory` (CLI + brain) and `factoryd` (daemon owning Discord, Telegram, fs watching, web UI, and the localhost IPC server). Daemon optional for inline builds.

See **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** for the full design.

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

### Windows operator tips

- **PowerShell em-dash mojibake.** factory5's logs and CLI output use proper em-dashes (`—`) and other UTF-8 punctuation. Windows PowerShell defaults to a legacy code page and will render these as `â€"` etc. Set the console to UTF-8 once per session (or in your `$PROFILE`):

  ```powershell
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  ```

  Windows Terminal + Windows PowerShell 7+ usually pick this up automatically; classic PowerShell 5.1 does not.

## Layout

```
factory5/
├── CLAUDE.md                  ← guidance for Claude Code working on factory5 itself
├── packages/                  ← libraries (core, state, ipc, logger, brain, ...)
├── apps/                      ← runnable binaries (factory, factoryd, factory-web)
├── prompts/                   ← agent system prompts (markdown)
├── skills/                    ← skill methodology files
├── templates/                 ← project templates
├── migrations/                ← SQLite schema
└── docs/                      ← architecture, ADRs, contracts, issues
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — data contracts (Directive, Event, etc.)
- [`docs/decisions/`](docs/decisions) — Architecture Decision Records
- [`docs/SKILLS.md`](docs/SKILLS.md) — skill catalog
- [`docs/AGENTS.md`](docs/AGENTS.md) — agent role catalog
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — clone-to-first-build walkthrough

## Contributing / working on factory5

Every working session reads [`CLAUDE.md`](CLAUDE.md) first — it's the standing brief.

## License

MIT
