# @factory5/providers

`ModelProvider` interface + implementations + the 4-step resolution pipeline (see ADR 0004).

## Resolution pipeline

For a given `ModelCategory`:

1. **Per-directive override** (e.g. `--model anthropic-api/claude-opus-4-7`)
2. **Category default** from `~/.factory5/config.toml [categories]`
3. **Provider fallback chain** from `[fallback_chains]`
4. **System default** (typically `claude-cli/claude-opus-4-7` if Claude subscription is set up)

Reactive fallback also kicks in at runtime: if a call errors with a recoverable failure (rate limit, transient), the next chain entry is tried automatically.

## Providers

| Provider id     | Transport                             | Status (as of Phase 1) | Used for                         |
| --------------- | ------------------------------------- | ---------------------- | -------------------------------- |
| `claude-cli`    | subprocess to `claude` (subscription) | **implemented**        | Every category (default chain)   |
| `anthropic-api` | HTTP via `@anthropic-ai/sdk`          | planned (Phase 2)      | All categories; primary fallback |
| `openai`        | HTTP via `openai` SDK                 | planned (Phase 2)      | Codex, fallback                  |
| `openrouter`    | OpenAI-compatible HTTP                | planned (Phase 2)      | Anything else                    |
| `codex-cli`     | subprocess to `codex`                 | planned (Phase 2)      | Codex agent                      |

## `ClaudeCliProvider` — quick reference

```ts
import { ClaudeCliProvider } from '@factory5/providers';

const provider = new ClaudeCliProvider({
  // binaryPath?: 'C:\\path\\to\\claude.cmd' — optional; falls back to FACTORY5_CLAUDE_CLI_PATH, then PATH
  // timeoutMs?: 600_000 — default 10min
  // extraArgs?: ['--verbose'] — passed to every spawn
});

await provider.available(); // true if `claude --version` exits 0
const res = await provider.call({
  model: 'claude-haiku-4-5',
  systemPrompt: '...',
  messages: [{ role: 'user', content: '...' }],
});
// res.text, res.usage.{inputTokens, outputTokens, costUsd}
```

Internals worth knowing:

- Prompt is piped via stdin. Only flag args (`-p`, `--output-format`, `--model`) travel on argv, so argv escaping on Windows is not a problem.
- On Windows, the resolver probes PATHEXT (`.cmd`, `.exe`, ...). A resolved `.cmd`/`.bat` is invoked via `cmd.exe` with safe quoting; other shapes use `spawn(..., { shell: false })`.
- `available()` is cached for the provider's lifetime; call `resetAvailability()` to force a re-check.

## Status

`claude-cli` implemented in Phase 1. Remaining providers land in Phase 2 alongside proactive + reactive fallback.
