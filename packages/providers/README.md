# @factory5/providers

`ModelProvider` interface + implementations + the 4-step resolution pipeline (see ADR 0004).

## Resolution pipeline

For a given `ModelCategory`:

1. **Per-directive override** (e.g. `--model anthropic-api/claude-opus-4-7`)
2. **Category default** from `~/.factory5/config.toml [categories]`
3. **Provider fallback chain** from `[fallback_chains]`
4. **System default** (typically `claude-cli/claude-opus-4-7` if Claude subscription is set up)

Reactive fallback also kicks in at runtime: if a call errors with a recoverable failure (rate limit, transient), the next chain entry is tried automatically.

## Providers (planned)

| Provider id | Transport | Used for |
|---|---|---|
| `claude-cli` | subprocess to `claude` (subscription) | Reasoning, deep |
| `anthropic-api` | HTTP via `@anthropic-ai/sdk` | All categories |
| `openai` | HTTP via `openai` SDK | Codex, fallback |
| `openrouter` | OpenAI-compatible HTTP | Anything else |
| `codex-cli` | subprocess to `codex` | Codex agent |

## Status

Interface defined; implementations stubbed. First impl (`claude-cli`) lands in Phase 1.
