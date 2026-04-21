# Phase 7 Steps — Budget discipline

> **Placeholder.** Detailed 7a sub-step bodies are authored at the start
> of the 7a session, after the pre-call cost-estimate ADR is decided.
> 7b and 7c placeholders expand when their sessions open.

## Phase 7a — Budget enforcement

- [ ] 7a.1 — ADR: pre-call cost estimate approach (how `brain` knows whether the next LLM call will exceed `max_usd`)
- [ ] 7a.2 — `@factory5/state` — running-total query over `model_usage` by directive
- [ ] 7a.3 — `@factory5/providers` — expose per-call cost estimate (input-token + expected-output-token × model-rate)
- [ ] 7a.4 — `@factory5/brain` — pre-call ceiling check in the main loop; halt + escalate when exceeded
- [ ] 7a.5 — `@factory5/cli` — `--max-usd <N>` / `--max-steps <N>` flags on `factory build`
- [ ] 7a.6 — Config defaults in `~/.factory5/config.toml`
- [ ] 7a.7 — Regression test: synthetic build hits `max_usd` → clean escalation (not mid-task half-failure)
- [ ] 7a.8 — Live validation: `factory build example --max-usd 3` either lands clean or escalates cleanly
- [ ] 7a.9 — Close Phase 7a (tag `phase-7a-budget-enforcement-closed`)

## Phase 7b — Cross-session spend dashboard

- [ ] 7b.1 — `@factory5/state.queries.spend` — aggregations by project / directive / day / model
- [ ] 7b.2 — `factory spend` CLI subcommand with filters (`--since`, `--project`, `--group-by`)
- [ ] 7b.3 — Round-trip test: seed two builds → query dashboard → rows match raw `model_usage`
- [ ] 7b.4 — Close Phase 7b (tag `phase-7b-spend-dashboard-closed`)

## Phase 7c — Telegram channel

- [ ] 7c.1 — **[HALT] secret_needed** — user provides Telegram bot token + target chat-id
- [ ] 7c.2 — `packages/channels/src/telegram.ts` implementing `ChannelPlugin` (Discord is the reference — ADR 0019 dropped the GitHub channel)
- [ ] 7c.3 — Long-polling event source in `@factory5/events` (Telegram's preferred transport; no webhook server needed)
- [ ] 7c.4 — State config for bot-token + allowed-chats allowlist
- [ ] 7c.5 — Round-trip integration test using recorded fixtures
- [ ] 7c.6 — Live run against user-provided test chat
- [ ] 7c.7 — Close Phase 7c (tag `phase-7c-telegram-channel-closed`)

## Phase 7 close

- [ ] Phase-level close: `docs/Phase7_Progress.md` charter complete, 3 sub-phases ✅, tag `phase-7-closed`
