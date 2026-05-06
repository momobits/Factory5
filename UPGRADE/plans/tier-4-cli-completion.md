# Tier 4 — CLI completion

**Goal**: every operator action that's available from the web UI or channels is also available from the CLI. Plus tab completion and rich `--help` examples.

**Why this tier**: small but high-leverage. Ships in one session. Most of the heavy lifting (cancel plumbing) is already done in Tier 2.

**Estimated effort**: 1 session.

**Issues addressed**: U018, U019, U020, U021, partially U004 (CLI surface for cancel).

---

## Pre-requisites

Read before starting:

- [`../AUDIT.md`](../AUDIT.md) §4 (CLI gaps)
- `packages/cli/src/index.ts` — top-level program assembly
- All command files in `packages/cli/src/commands/` (sample 2-3 to learn the shape)
- Tier 2 plan, especially 2.4 — `factory cancel` brain hook + IPC route are pre-built
- `packages/wiki/src/project-metadata.ts` — `resolveDirectiveLimits` and project.json helpers

Verify all four gates pass.

---

## Sub-tasks

### 4.1 `factory cancel <directive-id>`

Already most of the way done by Tier 2.4 (brain hook + IPC route + CLI command). Tier 4 work is just verifying the CLI surface works:

- `factory cancel <directive-id> [--reason <text>]`
- Calls the `POST /directives/:id/cancel` IPC route.
- Falls back to direct SQLite update when no daemon (Tier 2 wired this).
- Exit codes: `0` on success, `1` on hard error, `2` on directive not found, `3` on directive already terminal. (Phase 4.1 verified live: the 4-code surface ships, distinguishing not-found from already-terminal — the tier-4 plan's earlier 3-code sketch was wrong.)

**Acceptance**: tested in Tier 2; live-smoke verified in Phase 4.1.

### 4.2 `factory budget set <project> --max-usd <n> [--max-steps <n>]`

**Today**: budget changes go through the web UI's `PUT /api/v1/projects/:id/budget`. The CLI has no sibling.

**Wire**:

- New: `packages/cli/src/commands/budget.ts` — `factory budget set <project> --max-usd <n> [--max-steps <n>]`.
- Reuses: `packages/wiki/src/project-metadata.ts` — same code path as the web UI's PUT handler.
- Idempotent: same call twice is a no-op (matches the web UI's PUT semantics).
- Outputs: prints the updated `metadata.budgetDefaults` block from `project.json`.

**Acceptance**:

- `factory budget set my-app --max-usd 5` writes `{ maxUsd: 5 }` to `<workspace>/my-app/.factory/project.json` `metadata.budgetDefaults`.
- Per-field independent: `--max-steps 100` does not flush `maxUsd`.
- Unit tests parallel `packages/cli/src/commands/spend.test.ts` shape.

### 4.3 `factory project list / show <name> / delete <name>`

**Today**: project management is implicit. No introspection / cleanup commands.

**Wire**:

- `factory project list` — walks the workspace for `.factory/project.json` files; prints a table of name + language + last-build + status.
- `factory project show <name>` — pretty-prints the project's `project.json` (language, budget defaults, last-build summary).
- `factory project delete <name>` — interactive confirm; removes the project from `projects` table; **does not** delete the workspace files (they're the operator's; just unregisters). `--force` skips the confirm; `--purge` also `rm -rf`s the workspace dir (with double-confirm).

**File pointers**:

- New: `packages/cli/src/commands/project.ts`.
- Reuses: `packages/state/src/queries/projects.ts` for the `projects` table; `packages/wiki/src/project-metadata.ts` for `project.json` reads.

**Acceptance**: end-to-end smoke — list shows recent builds; show prints the right metadata; delete unregisters cleanly.

### 4.4 `factory ask "<question>"`

**Today**: to fire one chat directive, you must `factory chat`, type, wait, `/quit`. No single-shot mode.

**Wire**:

- `factory ask "what's the spend?"` — emits one `intent=chat` directive, awaits one reply, prints, exits.
- `factory ask "..." --json` — outputs the reply as JSON (useful for scripting).

**File pointers**:

- New: `packages/cli/src/commands/ask.ts`.
- Reuses most of `chat.ts`'s logic — extract a `submitOneDirective` helper and reuse from both.

**Acceptance**: `factory ask "what's the spend?" | jq -r .reply` works.

### 4.5 Tab completion

**Today**: not wired.

**Wire**:

- Use Commander's `commander-completion` plugin or hand-roll a `factory completion <shell>` subcommand that prints a completion script.
- Support: `bash`, `zsh`, `pwsh`.
- Static command list (sub-command names, flag names) — no dynamic completion (project names, directive IDs) in v1; that's a future polish.
- Install: `factory completion bash >> ~/.bashrc` (or document equivalent for zsh/pwsh).

**File pointers**:

- New: `packages/cli/src/commands/completion.ts`.
- Edit: `packages/cli/README.md` — add a "Tab completion" section.

**Acceptance**: tab works in bash/zsh/pwsh after install.

### 4.6 Rich `--help` examples

**Today**: every Commander `.help()` output is the bare flag listing.

**Wire**:

- For each command, add `.addHelpText('after', '...')` with one or two worked examples.
- Examples to seed:

  ```
  factory build --help
    Examples:
      factory build my-app
      factory build my-app --autonomy autonomous --max-usd 5
      factory build my-app --language node --inline
      factory build templates/python-cli --autonomy chat
  ```

  Similar one-liners for: `chat`, `doctor`, `init`, `resume`, `status`, `spend`, `findings`, `answer`, `ui-token`, `questions cleanup`, `cancel`, `budget set`, `project list`, `ask`.

- Top-level `factory --help` gets `addHelpText('afterAll', '...')` with a "Common workflows" pointer to `docs/WORKFLOWS.md` (Tier 1).

**File pointers**:

- Edit: each command in `packages/cli/src/commands/`.

**Acceptance**: every `factory <cmd> --help` has at least one worked example.

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass.
- All new commands have unit tests in their `*.test.ts` siblings.
- Tab completion produces valid bash/zsh/pwsh scripts.
- Every command's `--help` shows a worked example.
- `packages/cli/README.md` updated to reflect new commands.
- All issues U018-U021 marked Resolved (U004 was resolved by Tier 2).
- Append session entry to [`../LOG.md`](../LOG.md).
- Tick Tier 4 checkboxes in [`../ROADMAP.md`](../ROADMAP.md).

---

## Risks + decisions

- **`project delete` semantics** — by default just unregister (don't touch workspace files). Operators should never lose code by running an unregister. The `--purge` flag is the explicit destructive variant.
- **`ask` JSON output shape** — should mirror the chat reply shape from Tier 3.5's `POST /api/v1/chat/messages` so script consumers can use either surface. Pin in `specs/web-chat-protocol.md` (Tier 3) and reuse here.
- **Completion scope** — static (sub-commands + flags) vs dynamic (project names, directive IDs). Static is cheap; dynamic requires running `factory project list` etc. inside the completion script. Static for v1, dynamic later.
- **Pwsh quirks** — pwsh completion has a different model (Register-ArgumentCompleter). May need a separate codepath; verify on a Windows session.

---

## Suggested commit shape

One commit per sub-task, all in a single session:

1. `feat(cli): factory budget set <project>` (4.2)
2. `feat(cli): factory project list/show/delete` (4.3)
3. `feat(cli): factory ask "<question>"` (4.4)
4. `feat(cli): tab completion for bash/zsh/pwsh` (4.5)
5. `docs(cli): rich --help examples on every command` (4.6)
6. `docs(cli): packages/cli/README.md — refresh after Tier 4` (consolidates with Tier 1 leftovers if any)
