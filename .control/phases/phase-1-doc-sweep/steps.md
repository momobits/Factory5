# Phase 1 Steps

- [ ] 1.1 — Refresh `packages/cli/README.md` — drop "Phase" column, add `spend` / `findings` / `questions cleanup` rows, re-evaluate `stub` / `planned` markers
- [ ] 1.2 — Refresh `packages/channels/README.md` — rewrite Status section (Telegram + web no longer "future"), add Telegram plugin section, add Web channel section, clarify Web ≠ ChannelPlugin
- [ ] 1.3 — Refresh `apps/factory-web/README.md` — remove phase-number references, add page index
- [ ] 1.4 — Add §"Web dashboard" to `docs/ONBOARDING.md` between §4 "First build" and §5 "Discord channel"
- [ ] 1.5 — Add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md`
- [ ] 1.6 — Write `docs/WORKFLOWS.md` — four canonical loops + decision matrix + CLAUDE.md authoring guide; cross-reference from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ONBOARDING.md`
- [ ] 1.7 — Single-pass audit of `docs/SKILLS.md` + `docs/AGENTS.md` against current code; reconcile any divergence
- [ ] 1.8 — `/phase-close` — tag `phase-1-doc-sweep-closed`; append session entry to [`../../../UPGRADE/LOG.md`](../../../UPGRADE/LOG.md); tick Tier 1 boxes in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md); scaffold Phase 2

## Step detail

Each step's full detail (file pointers, acceptance criteria, edge cases, exact text changes) is in [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) under the matching `§1.<step>` heading. Below: just the commit-message templates and step-local guardrails.

### 1.1 — `packages/cli/README.md`

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.1.

**Acceptance:** every command listed in the table corresponds to a real source file under `packages/cli/src/commands/`; no row marked `done` for code that doesn't exist; no command shipped but missing from the table.

**Commit:** `docs(1.1): refresh packages/cli/README.md — drop Phase column, add spend/findings/questions cleanup`

### 1.2 — `packages/channels/README.md`

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.2.

**Acceptance:** Status section reflects what's shipped; all four channel paths (cli-rpc, discord, telegram, web) have a section; the `ChannelPlugin` vs Fastify-route distinction (web is **not** a `ChannelPlugin`) is explicit.

**Commit:** `docs(1.2): refresh packages/channels/README.md — Telegram and web no longer "future"`

### 1.3 — `apps/factory-web/README.md`

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.3.

**Acceptance:** no phase-number references; readers can see at a glance what pages exist.

**Commit:** `docs(1.3): refresh apps/factory-web/README.md — drop phase-number scaffolding, add page index`

### 1.4 — §"Web dashboard" in `docs/ONBOARDING.md`

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.4. Insert between §4 "First build" and §5 "Discord channel".

**Acceptance:** a new operator can open the dashboard from cold based on the doc alone (URL discovery, token capture, page tour, recovery via `factory ui-token`).

**Commit:** `docs(1.4): add §Web dashboard to ONBOARDING.md`

### 1.5 — §"Chat" in `docs/ONBOARDING.md`

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.5. Insert as the next section after Web dashboard.

**Acceptance:** a new operator who's done channel setup can hold a chat across all three surfaces (`factory chat`, Discord thread, Telegram DM).

**Commit:** `docs(1.5): add §Chat to ONBOARDING.md`

### 1.6 — `docs/WORKFLOWS.md`

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.6. **Most important deliverable in this phase.** Covers: four canonical loops (one-shot autonomous, chat-driven, fix loop, resume after pause), decision matrix (when to use which surface), CLAUDE.md authoring guide (worked example).

**Acceptance:** a new operator who's done setup can pick a workflow and execute it from the doc alone. Cross-referenced from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ONBOARDING.md`.

**Commit:** `docs(1.6): write docs/WORKFLOWS.md — four canonical loops + decision matrix + CLAUDE.md authoring guide`

### 1.7 — `docs/SKILLS.md` + `docs/AGENTS.md` audit

Per [`../../../UPGRADE/plans/tier-1-doc-sweep.md`](../../../UPGRADE/plans/tier-1-doc-sweep.md) §1.7.

For each skill in `SKILLS.md`, verify the corresponding `skills/<name>.md` exists. For each agent in `AGENTS.md`, verify it's referenced from `packages/brain/src/`. If anything diverged, update.

**Acceptance:** skills/agents docs match what the brain actually uses.

**Commit (if changes):** `docs(1.7): reconcile SKILLS.md + AGENTS.md against current code`

**Commit (if no changes):** `docs(1.7): SKILLS.md + AGENTS.md verified current; no changes`

### 1.8 — Phase close

Run `/phase-close` after all steps green and four gates clean. Tags `phase-1-doc-sweep-closed`. Scaffolds Phase 2 — channel-parity at `.control/phases/phase-2-channel-parity/`.

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-1-doc-sweep): close phase 1, kick off phase 2`
