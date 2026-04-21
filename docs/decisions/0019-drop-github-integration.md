# 0019 — Drop GitHub integration from factory5

- **Status:** Accepted
- **Date:** 2026-04-21

## Context

Phase 6 opened with three candidate sub-phases (Phase6_Progress.md):
6c verifier overhaul (shipped), 6a cross-project findings registry
(shipped), and 6b GitHub channel. Phase 6b's charter framed GitHub as
a third trigger channel parallel to Discord: an operator files an
issue, factoryd ingests it as a directive, runs the pipeline, posts
the outcome back as a comment. A 9-step plan was scaffolded under
`.control/phases/phase-6b-github-channel/` and step 6b.1 provisioned a
test repo (`momobits/factory5-6b-smoke`) plus a classic PAT stored in
`HKCU\Environment` (commit `c780180`).

At step 6b.2 — the ADR choice between webhook / polling / hybrid event
source — the design session surfaced that the Phase 6b charter had
silently pivoted from the original scaffold intent. `CompleteArchitecture.md`
§3 / §19 had positioned GitHub as an **event source** (observer):
factoryd polls repos factory cares about, emits typed events, and
*things that happen there* ("PR opened in a tracked repo", "CI fails")
become signal the brain can react to. The canonical example was "PR
opened → review directive." Phase 6b's charter reframed the same slot
as a **channel** (inbound directives from GitHub issues, outbound
comments), inheriting the `'github'` entry in `CHANNEL_IDS` and
extrapolating from Discord's shape. That pivot was never captured in
an ADR.

With both framings on the table, neither earned its keep for
factory5's current operator reality:

- **Channel framing.** A solo operator on a dev box always has a
  terminal open. Opening github.com, filing an issue, waiting on a
  60s poll, and watching the reply comment is slower and more
  expensive than running `factory build <project>` directly. The only
  scenario where the channel shape wins is "I'm away from my dev box
  and want to kick off a build from my phone" — a niche use case that
  does not justify the attendant infrastructure (channel plugin, event
  source, `github_channel_config` migration, HMAC or polling cursor
  code, fixture test harness, live-smoke coordination).

- **Observer framing.** Value depends on factory having *context* on
  the repos it watches. The natural observer integration is "factory
  watches repos it built" — a closed loop where CI failures on a
  factory-authored project spawn fix directives, PRs against a
  factory-authored project spawn review directives. That closed loop
  requires the *other* half of the integration, which does not exist:
  **factory outputs do not live on GitHub.** `factory build <project>`
  produces a local directory under `<workspace>/<project>/` and never
  pushes anywhere. Without an output-to-GH path, the observer would
  poll repos factory has never touched, emit events, and do nothing
  useful with them — a notification stream duplicating GitHub's own
  email/web/mobile notifications.

Both framings also sit in front of an unsolved budget discipline
problem: Phase 6c's live-validation build cost $7.71 against a $4–6
envelope (Phase6_Progress.md), with no pre-call `max_usd` enforcement
(CompleteArchitecture.md §12, line 454). Adding a channel or observer
that can autonomously trigger autonomous-mode builds — while the brain
still has no hard spend ceiling — pushes operator-trust in the wrong
direction. Phase 7a is already charted to land pre-call budget gates;
running any GitHub-triggered autonomous build *before* Phase 7a lands
means the first real use of the integration also tests the spend
ceiling that does not exist.

## Decision

Three decisions, one ADR:

1. **Drop the GitHub channel.** No `packages/channels/src/github.ts`.
   The `'github'` entry is removed from `CHANNEL_IDS` in
   `packages/core/src/constants.ts`. The three `github.*` event kinds
   (`github.issue.opened`, `github.issue.commented`, `github.pr.status`)
   are removed from `eventBodySchema` in `packages/core/src/schemas.ts`.
   `packages/events/README.md` drops the `github-poll` stub mention.
   Associated scaffold narrative in `CompleteArchitecture.md`,
   `docs/ARCHITECTURE.md`, and `docs/CONTRACTS.md` is pruned.

2. **Drop the GitHub observer** (the scaffold's original intent).
   Factoryd does not poll GitHub. No webhook server. The observer
   framing has no standalone value until factory builds live on
   GitHub — a prerequisite this ADR does not ship.

3. **Future output-to-GH, if and when it ships, is operator-directed
   per-directive — not pattern-driven.** `factory build <project> --publish-to-gh owner/repo`,
   or a chat directive that says "build me X and publish it to GH," or
   a `factory push <project>` subcommand (already listed as "planned,
   Phase 5" in `packages/cli/README.md` line 21). The side-effect
   happens because the operator asked for it in a directive, not
   because a background rule or channel plugin silently decided to.
   **This principle generalizes beyond GitHub:** factory's effects in
   the world are operator-directed by default. This line is durable
   doctrine regardless of whether output-to-GH ever ships.

## Consequences

**Positive.**

- **Factoryd's mandate simplifies.** After this ADR, factoryd exists
  to own the Discord websocket, host the brain, and serve localhost
  IPC (ADRs 0002 / 0011 / 0012 / 0013 / 0014 all remain valid). The
  "GitHub polling, git watching, fs watching, webhook HTTP server"
  phrase that appeared in the §3 Process-model table and
  `apps/factoryd/package.json#description` is retired.
- **Phase 6 closes with real wins.** 6a (findings registry) and 6c
  (verifier advisory) both ship tangible value. Phase 6's exit
  criterion #2 ("Accept at least one non-CLI trigger live") is
  amended to "factory accepts at least one non-CLI trigger (Discord,
  shipped Phase 4)" — honest to what is in the tree.
- **Phase 7a (budget discipline) is now the next phase.** The
  operator-trust priority is correctly ordered: bound runaway cost
  before expanding surface area that can autonomously trigger builds.
- **Operator secrets and test artefacts are released.** The
  6b.1-provisioned PAT, HKCU env var, and `momobits/factory5-6b-smoke`
  repo become dead. Cleanup steps for the operator are captured in
  the Phase 6 close narrative in `docs/PROGRESS.md` and the 6b config
  file deletion.
- **Dead scaffolding leaves the tree.** `'github'` and `'webhook'`
  exit `CHANNEL_IDS`; the three `github.*` event kinds exit
  `eventBodySchema`; corresponding tests are rewritten to use
  remaining event kinds (`fs.changed`) so test coverage of the
  discriminated union is preserved without the removed arms. The
  alternative — leave the stubs and hope a future phase picks them
  up — was considered and rejected: scaffolded-but-unused types drift
  from reality as the surrounding code evolves, and their presence
  misleads future readers into thinking the integration is "almost
  there." Pruning is cheaper than maintaining dead types.

**Negative.**

- **Original scaffold intent is abandoned in the current charter.**
  `CompleteArchitecture.md` §19's "Phase 5 — GitHub events" line
  never shipped in any form; this ADR makes that explicit rather
  than leaving it implicit. The roadmap narrative in §19 is revised
  accordingly.
- **`momobits/factory5-6b-smoke` and the associated PAT are dead
  resources.** The operator is responsible for out-of-band cleanup:
  revoke the PAT at https://github.com/settings/tokens, delete the
  repo (`gh repo delete momobits/factory5-6b-smoke --yes` or UI),
  clear the env var (`reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`).
  Factory5 cannot and should not automate this from inside a
  same-repo ADR.
- **Phase 7c (Telegram channel) loses its stated pattern reference.**
  The existing phase-plan describes Telegram as "parallel to Discord
  + GitHub (6b), patterns locked by 6b." With 6b dropped, Telegram's
  reference model is Discord alone. The phase-plan is updated to
  reflect this; 7c itself is unaffected structurally.
- **Migration 001's CHECK constraints on `directives.source` and
  `outbound_messages.target_channel`** still permit `'github'` and
  `'webhook'` as historical artefacts. Rewriting a SQLite CHECK
  requires table recreation (SQLite does not support ALTER COLUMN
  CHECK directly). The cost of that recreation — new migration,
  data copy, test fixtures — exceeds the benefit: the TypeScript
  layer is the enforcement point, and the DB CHECK is a stricter
  superset that harmlessly never fires for removed values. Left
  untouched on purpose; callout here so a future reader does not
  mistake the discrepancy for a bug.

**Reversible?** Yes. Every prune is additive to revert: restore the
enum entries in `constants.ts`, restore the event kinds in
`schemas.ts`, add a channel or event-source package. The ADR that
supersedes this one would frame the reversal — "factory now pushes
outputs to GitHub, and here is why observation of those outputs now
earns its keep" — and cite the missing prerequisite this ADR flagged.

## Alternatives considered

- **Ship the channel (6b as originally scoped).** Rejected. The
  session analysis (captured above) found no concrete operator
  workflow where the channel shape outperforms the CLI for a solo
  operator. A 2–3 session $6–15 budget committed to a feature the
  operator cannot construct a use case for is cost without commensurate
  value.

- **Ship the observer instead, keep the event-source framing.**
  Rejected. Without factory-built projects living on GitHub, the
  observer is a notification feed over repos factory has no context
  on. Deferred until the prerequisite (output-to-GH, framing C)
  surfaces. A future ADR can reintroduce the observer at that point.

- **Ship output-to-GH (framing C) in place of 6b.** Deferred, not
  rejected. Output-to-GH has standalone value — factory-built
  projects become shareable artefacts with CI. The operator's
  preference recorded in this session is that output-to-GH be
  **operator-directed per-directive** ("on instruction, not
  pattern"), which means it lives naturally as a plan task the brain
  materialises when a directive requests publishing, or as a
  `--publish-to-gh` CLI flag. Neither shape requires factoryd nor
  changes to the event/channel model. Not scheduled as a specific
  phase; the existing "planned" row for `factory push <project>` in
  `packages/cli/README.md` captures the latent capability.

- **Ship the hybrid (webhook + polling) for completeness.** Rejected.
  The hybrid inherits both setup costs (public URL requirement for
  webhooks) and both code surfaces (HMAC verify + polling cursor +
  external-event-id dedup). With neither base shape earning its keep
  alone, their union is strictly worse.

- **Leave the scaffolded `'github'` / `'webhook'` entries and three
  event kinds in the codebase as "future."** Rejected per the
  positive consequence above. Unused scaffolding drifts and misleads.
  Pruning is cheap now and reversible later.

- **Close Phase 6 without amending exit criterion #2.** Rejected.
  Criterion #2 as originally phrased ("accept at least one non-CLI
  trigger live — a real GitHub issue or PR comment produces a
  `directive:new` row") depends on 6b. The charter's own escape
  hatch ("criteria may be struck through with a charter amend")
  applies; this ADR amends cleanly rather than leaving a criterion
  awkwardly unfulfilled in the close narrative.

## Implementation notes

**Code pruning** (one refactor commit, co-landed with this ADR):

- `packages/core/src/constants.ts` — `CHANNEL_IDS` narrows from
  `['cli','discord','telegram','github','webhook']` to
  `['cli','discord','telegram']`. `telegram` retained as forward
  scaffold for Phase 7c per `.control/architecture/phase-plan.md`.
- `packages/core/src/schemas.ts` — `eventBodySchema` discriminated
  union drops the three `github.*` arms. Remaining arms
  (`git.commit`, `fs.changed`, `channel.message`) preserve
  discriminator coverage.
- `packages/core/src/schemas.test.ts` — the "parses a github issue
  event" case is rewritten to parse a `fs.changed` event (the most
  structurally-similar remaining kind). Coverage of the discriminated
  union is preserved.
- `packages/state/src/state.test.ts` — the `events queries` test's
  seed row is rewritten from `github.issue.opened` to `fs.changed`;
  `recentByKind` query target updated.
- `packages/events/README.md` — `github-poll` and `webhook-server`
  stub lines removed from the status section.
- `packages/daemon/README.md` — "eventually GitHub poll" phrase in
  the event-source bullet removed.
- `apps/factoryd/package.json` — `description` simplified to drop
  "GitHub polling, fs/git watching, webhooks".
- `prompts/agents/triage.md` — line 10 "GitHub event description"
  phrase removed.
- `README.md` (repo root) — opening paragraph and feature list
  pruned of GitHub mentions.
- `CompleteArchitecture.md` — §1 opening sentence, §3 top-level
  diagram and Process-model table, §4 components table
  (events row), §5 (unaffected), §19 roadmap (Phase 5 rewrite), §20
  scaffold listing, all pruned of GitHub.
- `docs/ARCHITECTURE.md` — factoryd bullet + event-sources table
  pruned.
- `docs/CONTRACTS.md` — `ChannelId`, `Event.source` comment, and
  `EventBody` union pruned.

**Migration 001 intentionally left alone.** SQLite CHECK on enum
values cannot be altered in place; recreation cost exceeds benefit
for a pre-release codebase. The DB permits a wider superset than the
TS layer will ever write.

**Control plane** (phase-close commit, lands third):

- `.control/phases/phase-6b-github-channel/` directory deleted in
  full (README, steps.md, config.md). No stub left behind; the
  phase-plan and this ADR are the authoritative record.
- `.control/phases/phase-7-budget-discipline/` scaffolded with README
  + placeholder steps (detailed bodies authored at phase start per
  existing convention).
- `.control/architecture/phase-plan.md` — Phase 6 row status flipped
  to closed; 6b row flipped to "Dropped — see ADR 0019"; Phase 7
  promoted to active; 7c's "patterns locked by 6b" phrase revised to
  "Discord is the reference channel."
- `.control/progress/STATE.md`, `next.md`, `journal.md` — updated to
  reflect Phase 7a as the next active step.

**Operator cleanup** (out-of-band, documented in `docs/PROGRESS.md`'s
Phase 6 close entry):

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete test repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`,
   then log out/in or broadcast `WM_SETTINGCHANGE`.

Factory5 cannot and should not automate these from its own repo.
