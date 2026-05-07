# Tier 7 — `factory findings mark <id> <status>` CLI command

**Goal**: ship the operator-side parallel to Tier 6's agent-side `RESOLUTION` parser. `factory findings mark <id> <status>` flips a finding's status (and optionally records a resolution note) by calling the existing `updateFindingStatus` API. Today there's no operator-side surface for this — when a fixer agent doesn't run (or the operator wants to mark something `WONTFIX` directly), the only path is hand-editing `findings.json`.

**Why this tier**: 6.3 wired the agent-side flow — fixer's `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): ...` markers cause `updateFindingStatus` to fire. The operator-side gap is the missing complement. The runtime API (`packages/wiki/src/findings.ts:196`) and the disambiguation pattern (`factory findings show <id>` resolves bare ids via `findingsRegistry.findByFindingId`) already exist — Tier 7 is composition over invention.

**Estimated effort**: 1 session, ~1 substantive commit. The handler is a tight wrapper over `updateFindingStatus`; the disambiguation copies `runFindingsShow` verbatim; tests mirror `findings.test.ts`'s table-driven shape.

**Issues addressed**: U028 (opened by 7.1: `factory findings mark <id> <status>` CLI verb missing).

**Scope explicitly excluded**:

- **Bulk-mark** (`factory findings mark --severity LOW WONTFIX` etc.). Single-id by design — the operator writes the status they intend per finding. If a bulk demand signal arrives, that's a separate sub-step or tier.
- **Status filtering on input.** The CLI accepts any of the four `FindingStatus` values (`OPEN | FIXED | VERIFIED | WONTFIX`); the runtime decides whether the transition is meaningful. `updateFindingStatus` already handles idempotent re-flips (the `resolvedAt` field only sets the first time the finding lands in a terminal state).
- **Cross-project mark.** A bare `<id>` that exists in multiple projects is rejected with a disambiguation message, mirroring `factory findings show`. The operator passes `<project>/<id>` to disambiguate.
- **Listing what changed in a single run.** The handler emits one line per call (`F003 in my-app: OPEN → FIXED`) and exits.
- **`--undo` / history.** `updateFindingStatus` already supports `mark <id> OPEN` to reverse a flip; no separate undo verb. History (who flipped, when, why) is the resolution string + the registry's `updatedAt`. No first-class history surface in scope.
- **Tab-completion for status values.** The completion script's `NESTED_SUBCOMMANDS` table grows by one row (`mark`); enumerating valid status values into the completion templates is out of scope unless trivial.

---

## Pre-requisites

Read before starting:

- `packages/cli/src/commands/findings.ts` — existing `runFindingsList` / `runFindingsShow` / `runFindingsBackfill` handlers + the `registerFindingsCommand` wiring. The new `runFindingsMark` should slot in naturally next to `runFindingsShow`.
- `packages/cli/src/commands/findings.test.ts` — test shape (in-memory DB seeded via `findingsRegistry.upsert`; `runFindings*` handlers driven directly).
- `packages/wiki/src/findings.ts` — `updateFindingStatus` signature: `(projectPath, id, status, resolution?, registry?) => Promise<Finding>`. Throws `updateFindingStatus: no finding with id <id>` on miss.
- `packages/state/src/findings-registry.ts` (or wherever `findingsRegistry.findByFindingId` and `getByProjectAndId` live) — the disambiguation API. Already exercised by `runFindingsShow`.
- `packages/cli/src/commands/completion.ts` — the static command vocabulary; `mark` will be added to `NESTED_SUBCOMMANDS` for the `findings` group.
- `prompts/agents/fixer.md` — the agent-side counterpart wired in 6.3. Tier 7's CLI surface should compose with the agent flow, not duplicate it.

Verify all four gates pass before starting (`pnpm build && pnpm test && pnpm lint && pnpm format:check`).

---

## Sub-tasks

### 7.1 Open U028

**Today**: `factory findings mark <id> <status>` doesn't exist. The agent-side flow lands the same call (`updateFindingStatus`) via 6.3's `RESOLUTION` parser, but operator-side has no verb. The gap lives in conversation + Phase 6's "Deferred to Phase 7" + STATE.md's carry-forward list — no `UPGRADE/ISSUES.md` entry yet.

**Wire**:

- Open `U028 — factory findings mark <id> <status> CLI verb missing` in `UPGRADE/ISSUES.md` Open section. Severity: low. Tier: 7. Area: cli. Hypothesis: pure composition — handler wraps `updateFindingStatus`, disambiguation copies `runFindingsShow`, tests mirror `findings.test.ts`. No new dependencies, no new ADRs.

**Acceptance**:

- `UPGRADE/ISSUES.md` Open section grows by 1 entry (U028); Resolved section unchanged.
- All four `pnpm` gates green (no code touched yet).

**Commit**: `chore(7.1): open U028`

### 7.2 Implement `factory findings mark <id> <status>`

**Today**: `packages/cli/src/commands/findings.ts` has `runFindingsList` / `runFindingsShow` / `runFindingsBackfill`. No `runFindingsMark`.

**Goal**: a fourth subcommand that flips a finding's status via the existing `updateFindingStatus` API.

**Wire**:

- Add `MarkCommandOptions` interface (mirrors `ShowCommandOptions` shape; one field: `note?: string`).
- Add `runFindingsMark(db, rawId, rawStatus, opts)` handler:
  - Normalize `rawStatus` to upper-case; reject if not in `STATUSES` (the existing `OPEN | FIXED | VERIFIED | WONTFIX` set), `exitCode: 2`.
  - Resolve `rawId` the same way `runFindingsShow` does: `<project>/<id>` form takes the explicit project; bare `<id>` looks up via `findingsRegistry.findByFindingId(db, findingId)`. Not-found → `exitCode: 2` with a clear message; multiple matches → emit the same `renderAmbiguity` block `runFindingsShow` uses.
  - On a single resolved entry: call `updateFindingStatus(entry.projectPath, finding.id, status, opts.note)`. Wrap in try/catch — runtime throws `no finding with id <id>` only if the registry and on-disk `findings.json` are out of sync (rare; emit `exitCode: 1` with the error message).
  - Return `{ stdout: \`<id> in <project>: <prevStatus> → <newStatus>\\n\`, exitCode: 0 }` on success.
  - Optionally upsert the updated finding back into the registry — if `runFindingsBackfill` writes through `findingsRegistry.upsert`, the mark handler should keep registry + on-disk in sync the same way (verify on entry; if `updateFindingStatus`'s `registry?` parameter handles this, pass it).
- Wire into `registerFindingsCommand`:
  - `group.command('mark <id> <status>')` with `--note <prose>` option.
  - `addHelpText('after', ...)` examples (bare id, `<project>/<id>` form, with `--note`).
  - `.action(...)` thin wrapper opens DB, calls handler, writes stdout, exits on non-zero.
- Add tests in `findings.test.ts` mirroring the existing `runFindingsShow` test block:
  - Bare id, single match, OPEN → FIXED.
  - Bare id, ambiguous (same id in two projects), `exitCode: 2`, ambiguity message.
  - `<project>/<id>` form, success.
  - Invalid status (`mark F001 BORKED`), `exitCode: 2`.
  - Not found, `exitCode: 2`.
  - With `--note`, resolution string persisted.
  - Idempotent re-flip (FIXED → FIXED) — no error.
- Update `packages/cli/src/commands/completion.ts`: add `mark` to the `findings` row in `NESTED_SUBCOMMANDS`.
- Update `packages/cli/README.md`: add `mark` row to the findings table.
- Update `prompts/agents/fixer.md` if it cites the operator-side gap (6.3 dropped the "no parser today" caveat; verify it doesn't say "no operator CLI" either — if it does, drop that mention or replace with a reference to `factory findings mark`).
- Mark U028 Resolved in `UPGRADE/ISSUES.md` with this commit's sha.

**Constraints**:

- **Don't re-implement `updateFindingStatus`.** The handler is a wrapper; if behaviour needs changing (e.g. better error messages on terminal-to-terminal flips), edit `packages/wiki/src/findings.ts`, not the CLI handler.
- **Disambiguation parity.** The bare-id ambiguity message MUST match `runFindingsShow`'s — operators reading the help should see one consistent disambiguation pattern across `show` and `mark`.
- **No process.exit / stdout in the handler.** Mirror `runFindingsList`'s shape: pure async function returns `{ stdout, exitCode }`. The Commander `.action()` callback owns process lifecycle.
- **Status normalization is case-insensitive on input** (operator types `mark F001 fixed`), but the rendered output uses upper-case to match the rest of the surface.
- **Resolution note flows through to `updateFindingStatus(..., resolution)`** — same field the agent-side parser populates with `RESOLUTION` marker prose.

**Acceptance**:

- New `runFindingsMark` handler with at least 6 unit tests (happy path + invalid status + ambiguous + not-found + with-note + idempotent re-flip).
- `factory findings mark F001 FIXED` works end-to-end against a seeded registry.
- `factory findings mark --help` shows worked examples.
- Tab-completion script picks up `mark` (sanity-check the rendered bash/zsh/pwsh output for the `findings` block).
- `packages/cli/README.md` findings table grows by one row.
- U028 marked Resolved in `UPGRADE/ISSUES.md` with this commit's sha.
- All four `pnpm` gates clean.

**Commit**: `feat(7.2): factory findings mark <id> <status> CLI command`

### 7.close /phase-close

Run `/phase-close` after 7.2 lands and gates are green. Tags `phase-7-findings-mark-closed`. No Phase 8 plan exists at scaffold time; the upgrade arc closes again unless the operator authors a Tier 8 in advance.

**Commit**: auto-generated by `/phase-close`, shape: `chore(phase-7): close phase 7` (+ kickoff if Phase 8 plan exists).

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass after every commit.
- `factory findings mark <id> <status>` works for the four legal statuses, accepts bare or `<project>/<id>` ids, and supports `--note <prose>`.
- Disambiguation message matches `factory findings show`.
- Issue U028 marked Resolved with commit ref.
- Tier 7 ROADMAP rows ticked.
- Append session entry to `UPGRADE/LOG.md` at session end.

---

## Risks + decisions

- **Registry/on-disk sync.** `updateFindingStatus` writes to the per-project `findings.json` and (when passed a `registry` argument) mirrors to the cross-project registry. The CLI handler should pass the `registry` argument so the registry stays current — otherwise `factory findings list` would show stale status until the next backfill. Verify on entry whether the existing test fixtures already exercise the registry-passing path; if not, model the wiring after `runFindingsBackfill`.
- **Bare-id collision behaviour.** The decision is "reject with the same disambiguation message `factory findings show` uses" — not "pick the first" or "apply to all matches". Operators reaching for `mark` should be writing intent for a specific finding; ambiguity is an input error, not a default-target bypass.
- **Idempotency surface.** Calling `mark F001 FIXED` on an already-FIXED finding is a no-op at the runtime level (`resolvedAt` is preserved per the `updateFindingStatus` body); the CLI should report success (`F001 in alpha: FIXED → FIXED`) rather than silently doing nothing or erroring. Aligns with how `git tag` accepts re-applying an already-set tag.
- **Status enum drift.** If a future tier adds a fifth status (e.g. `DEFERRED`), the CLI's `STATUSES` array must grow in lockstep — but that's an `updateFindingStatus` problem first. Tier 7 doesn't add new statuses.
- **Completion vocab maintenance.** `NESTED_SUBCOMMANDS` is a static array; keeping it current is a manual audit. Tier 7 adds one row; the static-only completion deferral from Tier 4 §4.5 still applies (no dynamic finding-id completion).
- **No new ADR expected.** Tier 7 is composition over existing API. If something structural surfaces (e.g. the registry-passing path needs refactoring before the CLI can use it cleanly), pin via ADR before 7.2 lands. Likely candidate ADR number 0030 (none decided yet).

---

## Suggested commit shape

3-commit tier:

1. `chore(7.1): open U028`
2. `feat(7.2): factory findings mark <id> <status> CLI command`
3. `chore(phase-7): close phase 7`

---

## Out of scope — Tier 8+ candidate

- **U005 chat 120 s timeout re-tier.** Carry-forward from Phase 2's Tier-2-or-4 designation; affects channel-chat UX directly. Tier 8 candidate.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface. Tier 8 candidate (deeper than the 1-commit items here).
- **Bulk findings-mark surface** — only worth building if a demand signal arrives (e.g. an audit-cleanup workflow that needs to flip dozens at once).
- **Findings history surface** — first-class who/when/why log per finding. The current `resolution` string + registry `updatedAt` cover the common case.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit; Tier 8 candidate.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5. Doc-debt; not load-bearing.
