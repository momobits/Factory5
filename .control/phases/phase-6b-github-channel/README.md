# Phase 6b — GitHub channel

**Dependencies:** Phase 6a closed (`phase-6a-findings-registry-closed` tag)
**Estimated duration:** 2–3 sessions
**Execution order within Phase 6:** 3rd (after 6c, after 6a)
**Status:** ⏸ queued — detailed steps to be authored at phase start

## Goal

A real GitHub issue comment produces a `directive:new` row in factory5's state DB, runs through the full pipeline (triage → architect → planner → scaffolder → builders → verifier → assessor), and posts a reply comment with the terminal status. Parallel to the existing `discord` channel — both conform to `@factory5/channels` `ChannelPlugin`.

## Outcome

- Operator creates a GitHub issue titled with a directive prompt.
- factory5 daemon (`factoryd`) receives the webhook (or polls), creates a directive, runs the build.
- On `terminalStatus`, posts a comment with outcome + any findings.
- `factory tail --channel github` works the same as `--channel discord`.

## Pause-for-human at start

GitHub OAuth / PAT setup requires user coordination — real repo + real token. First step of this phase is **[HALT] secret_needed** per Control's halt conditions, resolved by the user providing a PAT and a test repo URL.

## Sub-steps (preview — expand at phase start)

- OAuth / PAT coordination (user-facing, not automatable)
- `packages/channels/src/github.ts` implementing `ChannelPlugin`
- `packages/events/src/github-webhook.ts` (or polling equivalent) for directive intake
- State migration for `github_channel_config` (repo, PAT ref, comment policy)
- Round-trip integration test using recorded fixtures (record once, replay)
- Discord-parity CLI: `factory channel configure github ...`
- Live run against a throwaway repo

## Done criteria

Full list at phase start. Must include:

- [ ] All steps checked off with commit references
- [ ] `pnpm test` green (target: `channels`, `events`, `daemon`)
- [ ] Round-trip integration test passes with recorded fixtures (no live GH needed for CI)
- [ ] **Live smoke:** real GH issue → directive → build → reply comment, on a user-provided test repo
- [ ] `docs/decisions/` has ADR for GitHub event-source approach (webhook vs polling vs hybrid)
- [ ] `docs/PROGRESS.md` entry + `docs/Phase6_Progress.md` 6b row flipped ✅
- [ ] Working tree clean
- [ ] Tag `phase-6b-github-channel-closed`
- [ ] Phase 6 as a whole closes if 6b is the last sub-phase shipped — see `docs/Phase6_Progress.md` exit criteria

## Rollback plan

`git reset --hard phase-6a-findings-registry-closed`. If a test repo was created on GitHub during the phase, deletion is user-controlled (out-of-band) — no rollback action from factory5 side.

## ADRs decided in this phase

- **ADR TBD** — GitHub event source: webhook vs polling vs hybrid
- **ADR TBD** (maybe) — Channel-config storage shape, if it diverges from Discord's
