# Phase 4 Steps

- [x] 4.1 — Verify `factory cancel <directive-id>` CLI surface end-to-end (Phase 2 brain hook + IPC route + DB-direct fallback already shipped; this step is a smoke-only verification commit if the surface is already correct)
- [x] 4.2 — `factory budget set <project> --max-usd <n> [--max-steps <n>]` — new `packages/cli/src/commands/budget.ts` reusing `packages/wiki/src/project-metadata.ts`; per-field independent (max-steps doesn't flush max-usd); idempotent; outputs the updated `metadata.budgetDefaults` block; unit tests parallel `spend.test.ts` shape
- [ ] 4.3 — `factory project list / show <name> / delete <name>` — new `packages/cli/src/commands/project.ts`; `list` walks workspace for `.factory/project.json` and prints a table; `show` pretty-prints `project.json`; `delete` defaults to unregister-only (no file deletion), `--force` skips confirm, `--purge` also `rm -rf`s the workspace dir with double-confirm
- [ ] 4.4 — `factory ask "<question>"` — new `packages/cli/src/commands/ask.ts` reusing chat.ts via an extracted `submitOneDirective` helper; emits one `intent=chat` directive, awaits one reply, prints, exits; `--json` outputs the reply shape for scripting
- [ ] 4.5 — Tab completion via `factory completion <shell>` — new `packages/cli/src/commands/completion.ts`; supports bash / zsh / pwsh; static command + flag completion (dynamic deferred); install via `factory completion bash >> ~/.bashrc` or shell-equivalent
- [ ] 4.6 — Rich `--help` examples — `addHelpText('after', '...')` on every command; top-level gets `addHelpText('afterAll', '...')` pointing at `docs/WORKFLOWS.md`
- [ ] 4.7 — `packages/cli/README.md` refresh — add the new commands; document tab completion install; align with current command surface
- [ ] 4.8 — Resolve issues U018 / U019 / U020 / U021 in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) and tick Tier 4 boxes in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md)
- [ ] 4.9 — `/phase-close` — tag `phase-4-cli-completion-closed`; append session entry to [`../../../UPGRADE/LOG.md`](../../../UPGRADE/LOG.md); scaffold Phase 5 if a next-phase plan exists, otherwise close out the upgrade arc

## Step detail

Each step's full detail (file pointers, acceptance criteria, edge cases, suggested commit messages) is in [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) under the matching `§4.<step>` heading. Below: just the commit-message templates and step-local guardrails.

### 4.1 — Verify `factory cancel <directive-id>`

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.1.

**Acceptance:** `factory cancel <id>` calls the `POST /directives/:id/cancel` IPC route on a real factoryd; falls back to direct SQLite update when no daemon. Exit codes (live-verified 2026-05-06 against real factoryd): `0` on success, `1` on hard error, `2` on directive not found, `3` on directive already terminal. The 4-code surface is more granular than the 3-code shape originally sketched in the tier-4 plan — distinguishing "doesn't exist" from "you're too late" is useful for scripting and parallels `factory ui-token`'s 4-code shape. Unit tests shipped with Phase 2 (7 tests in `cancel.test.ts`, all paths covered); live smoke confirmed `2` (bogus ULID) and `3` (complete directive with `--reason` cleanly accepted) in this step.

**Commit:** `chore(4.1): verify factory cancel CLI surface end-to-end`

### 4.2 — `factory budget set <project>`

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.2.

**Acceptance:** `factory budget set my-app --max-usd 5` writes `{ maxUsd: 5 }` to `<workspace>/my-app/.factory/project.json` `metadata.budgetDefaults`; per-field independent; unit tests parallel the `spend.test.ts` shape.

**Commit:** `feat(4.2): factory budget set <project>`

### 4.3 — `factory project list / show / delete`

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.3.

**Acceptance:** end-to-end smoke — `list` walks workspace + prints a table (name + language + last-build + status); `show <name>` pretty-prints metadata; `delete <name>` unregisters cleanly; `delete --purge <name>` removes the workspace dir with double-confirm.

**Commit:** `feat(4.3): factory project list/show/delete`

### 4.4 — `factory ask "<question>"`

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.4.

**Acceptance:** `factory ask "what's the spend?" | jq -r .reply` works (with `--json`); without `--json`, prints the reply text directly. Reuses chat.ts's logic via extracted `submitOneDirective` helper.

**Commit:** `feat(4.4): factory ask "<question>"`

### 4.5 — Tab completion

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.5.

**Acceptance:** `factory completion bash` / `zsh` / `pwsh` emits a valid completion script; tab works after install (manual smoke per shell). Static completion only — no dynamic project-name / directive-ID completion.

**Commit:** `feat(4.5): tab completion for bash/zsh/pwsh`

### 4.6 — Rich `--help` examples

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.6.

**Acceptance:** every `factory <cmd> --help` shows at least one worked example via `addHelpText('after', '...')`; top-level `factory --help` gets `addHelpText('afterAll', '...')` pointing at `docs/WORKFLOWS.md`.

**Commit:** `docs(4.6): rich --help examples on every command`

### 4.7 — README refresh

Per [`../../../UPGRADE/plans/tier-4-cli-completion.md`](../../../UPGRADE/plans/tier-4-cli-completion.md) §4.6 / cross-cuts.

**Acceptance:** `packages/cli/README.md` updated to reflect new commands (`budget set`, `project list/show/delete`, `ask`, `completion`); tab-completion install instructions added.

**Commit:** `docs(cli): packages/cli/README.md — refresh after Tier 4`

### 4.8 — Issues resolved + ROADMAP ticked

Move U018 / U019 / U020 / U021 from Open to Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md) with date + commit refs; tick the matching Tier 4 boxes in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md).

**Commit:** can fold into the per-step close commits or a single `chore(4.8): resolve U018-U021 + tick Tier 4 ROADMAP`.

### 4.9 — Phase close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-4-cli-completion-closed`. If a Phase 5 plan exists, scaffolds it; otherwise the upgrade arc closes out and STATE.md transitions to "all phases complete".

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-4): close phase 4` (+ kickoff if Phase 5 plan exists).
