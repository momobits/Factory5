# 0004 — Category-based model routing (declare intent, not agent)

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Factory 5 must support multiple model providers (Claude subscription via CLI, Claude API, OpenAI, OpenRouter, Codex) with different agent roles using different models. The predecessor (factory2) hardcoded a model per agent role:

```toml
architect = "opus"
builder = "sonnet"
reviewer = "opus"
```

This breaks down quickly:

- New providers can't be slotted in without changing per-agent code
- Cost optimization (run triage on a cheap model) requires editing many places
- Provider outages can't be handled without manual reconfig
- Multi-tenant (SaaS) per-user model preferences become a code change

`oh-my-openagent` solved this with **category-based routing**: agents declare a _category_ (intent class), not a _model_. The system resolves category → provider+model via user config, with a fallback chain.

## Decision

Each agent declares a `ModelCategory`, not a model name:

```ts
type ModelCategory =
  | 'quick' // triage, classification (Haiku-tier)
  | 'planning' // task decomposition (Sonnet-tier)
  | 'reasoning' // architecture, deep diagnosis (Opus-tier)
  | 'deep' // long autonomous execution (Opus or GPT-tier)
  | 'documentation'; // doc generation (Haiku-tier)
```

Resolution pipeline (4-step, in order):

1. **Per-directive override** — user explicit `--model` flag or per-session config
2. **Category default** — from `~/.factory5/config.toml` `[categories]` section
3. **Provider fallback chain** — next available provider in the chain for that category
4. **System default** — final fallback (typically `claude-cli` if subscription is set up)

Default category mapping (overridable):

```toml
[categories]
quick         = "anthropic-api/claude-haiku-4-5"
planning      = "anthropic-api/claude-sonnet-4-6"
reasoning     = "claude-cli/claude-opus-4-7"
deep          = "claude-cli/claude-opus-4-7"
documentation = "anthropic-api/claude-haiku-4-5"

[fallback_chains]
quick     = ["anthropic-api/haiku", "openai/gpt-4o-mini", "openrouter/llama-3"]
reasoning = ["claude-cli/opus", "anthropic-api/opus", "openai/gpt-5"]
```

**Dual fallback (proactive + reactive):**

- **Proactive** at config-load: if `claude-cli` reports unavailable on startup, brain pre-rebinds reasoning to next chain entry and warns
- **Reactive** at runtime: if a call fails (rate limit, error), the provider layer transparently retries with the next chain entry; brain receives a successful response with a fallback annotation in metadata

## Consequences

**Positive:**

- New providers are added by implementing the `ModelProvider` interface and registering — zero changes to agent code
- Cost optimization is a config edit, not a code change
- Provider outages are handled automatically by the fallback chain
- SaaS posture: per-user model preferences are config rows, not code branches
- Different users / projects can use entirely different model setups against the same factory binary
- Aligns with proven OmO pattern

**Negative:**

- Indirection: a contributor reading the brain code sees `category: "deep"` and must look up what model that resolves to. Mitigated by `factory status models` printing the current resolution.
- Five categories may be too few for nuanced cases (e.g., "vision-needed" or "code-completion" specialty). Add a sixth category if/when needed via a new ADR.

**Reversible?** Yes. If category routing turns out to be the wrong abstraction, agents can be hardcoded back to specific providers in a follow-up ADR. The interface (`ModelProvider`) survives either way.

## Alternatives considered

- **Hardcoded model per agent** (factory2's approach). Rejected: doesn't scale to multi-provider, doesn't handle outages, requires code changes for cost tuning.
- **Single model for everything** (always Opus, etc.). Rejected: wastes budget on triage tasks; defeats the purpose of supporting multiple providers.
- **Per-agent provider config** (no category abstraction; each agent names its provider in config). Rejected: more verbose, doesn't share across agents that want the same tier, harder to express fallback chains.
- **Capability-based routing** (agent says "I need vision and 200k context", system picks). Considered: more flexible but more complex to specify and reason about. Categories give 90% of the benefit with 20% of the complexity. Capability routing could be added on top later.

## Amendment — 2026-05-23 (Phase 14)

Adds a per-agent category override layer on top of the existing category→model routing. New `[agents.*]` table in `<dataDir>/config.json` (managed by `@factory5/state`'s `loadConfig`) lets operators flip an agent's resolved category without remapping the global category→model bindings.

Resolution order (additive layer above existing routing):

1. `config.agents?.[role]` if present
2. else `DEFAULT_AGENT_CATEGORIES[role]` from `@factory5/state`
3. (existing routing) category → provider+model via `[categories.*]`

`DEFAULT_AGENT_CATEGORIES.architect = 'planning'` (Sonnet) and `DEFAULT_AGENT_CATEGORIES.critic = 'reasoning'` (Opus) ship in Tier 14. Other agents keep their hardcoded built-in defaults; `agentsConfigSchema` is `.strict()` so extending to additional agents is a deliberate future schema bump.
