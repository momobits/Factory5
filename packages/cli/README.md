# @factory5/cli

Commander-based CLI. Used by the `factory` binary in `apps/factory`.

Every `factory <cmd> --help` lists worked examples and exit codes; `factory --help` cross-references [`../../docs/WORKFLOWS.md`](../../docs/WORKFLOWS.md) for the four canonical operator loops. Tab completion for bash / zsh / pwsh — see [Tab completion](#tab-completion) below.

## Subcommands

| Command                                                                         | Status   | Purpose                                                                                                    |
| ------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `factory --version`                                                             | **done** | Print version                                                                                              |
| `factory answer <questionId> [text...]`                                         | **done** | Close a pending `askUser`/`escalate_blocked` question                                                      |
| `factory ask "<question>" [--json] [--autonomy …]`                              | **done** | Single-shot chat — one directive, one reply, exit                                                          |
| `factory budget set <project> --max-usd <n> [--max-steps <n>]`                  | **done** | Per-project budget defaults — per-field merge, matches web UI write path                                   |
| `factory build <project> [--autonomy … --concurrency … --inline]`               | **done** | Delegates to factoryd if running, else inline                                                              |
| `factory cancel <directive-id> [--reason <text>]`                               | **done** | Actively cancel a directive — flip to `failed` and kill the worker                                         |
| `factory chat [--autonomy …]`                                                   | **done** | Interactive REPL against factoryd (daemon must be up)                                                      |
| `factory completion <bash\|zsh\|pwsh>`                                          | **done** | Emit a static tab-completion script                                                                        |
| `factory daemon start\|stop\|status\|restart`                                   | **done** | Lifecycle; refuses duplicate starts via pidfile                                                            |
| `factory directive mark-blocked <id> [--reason …]`                              | **done** | Flip a stuck `running` directive to `blocked` (manual recovery)                                            |
| `factory doctor [--skip-call] [--skip-discord]`                                 | **done** | Provider probe + triage round-trip + optional Discord reachability probe                                   |
| `factory findings list\|show\|backfill\|mark`                                   | **done** | Cross-project findings registry — list, show one, backfill from workspaces, mark a single finding's status |
| `factory init [--discord-token … --discord-application-id … ...]`               | **done** | Writes `config.toml`; populates `[channels.discord]` when `--discord-*` given                              |
| `factory project list\|show\|delete <name> [--force --purge]`                   | **done** | Per-project introspection + lifecycle (registry-aware)                                                     |
| `factory questions cleanup [--since <iso-date>] [--dry-run]`                    | **done** | Mark un-answered questions on terminated directives as answered (sweep)                                    |
| `factory resume <project>`                                                      | **done** | Resume the most recent build for a project                                                                 |
| `factory spend [--group-by project\|directive\|day\|model] [--since/--until …]` | **done** | Cross-session spend dashboard — per-project / -directive / -day / -model                                   |
| `factory status [--limit N]`                                                    | **done** | Projects + recent directives + per-directive spend                                                         |
| `factory ui-token [--token-only]`                                               | **done** | Print the dashboard URL with the live `FACTORY5_UI_TOKEN`                                                  |

## `factory build <project>`

Resolves `<project>` in this order:

1. Absolute path that exists
2. `./foo` / `../foo` relative to cwd
3. `<workspace>/<name>` (default workspace is `~/factory5-workspace`)
4. `templates/<name>` in the factory5 repo — if found, copied into the workspace

Writes a directive to SQLite. If a daemon is running (`factoryd.pid` owner alive) the directive is picked up by the serve loop; the CLI polls the directive row until terminal. `--inline` forces the old in-process pipeline even when a daemon is up. Exit code: `0` on `complete`, `2` on `blocked` / `failed`, `1` on hard error.

## `factory doctor`

Smoke check the stack before burning tokens on a full build:

```
$ factory doctor
Checking claude-cli provider…
  available(): true

Checking Discord (channel)…
  login:      ok
  bot:        factory-bot#0001
  guilds:     2 visible
  guildId:    reachable

Calling triage (quick tier) with a test directive…
  intent:     build
  confidence: 0.95
  reasoning:  user explicitly requests 'build me …'

All checks passed.
```

Flags: `--skip-call` (skip the model round-trip), `--skip-discord` (skip the Discord login probe even if a token is configured).

## `factory init`

Non-interactive (flag-only, CI-friendly). Writes `config.toml` with sensible defaults and optional Discord credentials.

```
factory init --workspace ~/projects \
  --autonomy assisted \
  --claude-cli-path "$(which claude)" \
  --discord-token "$DISCORD_BOT_TOKEN" \
  --discord-application-id 12345 \
  --discord-guild 67890 \
  --force
```

## `factory answer <questionId> [text...]`

Close a pending question raised by the brain's `askUser` / `escalate_blocked` helpers.

```
factory answer 01K0…ULID "continue"
factory answer 01K0…ULID skip
factory answer 01K0…ULID -    # read answer from stdin
```

Writes `pending_questions.answer` + `answered_at`. The brain's polling loop picks it up within 1 s and unblocks its directive. The daemon does **not** need to be running — SQLite is the bus.

## `factory directive mark-blocked <id> [--reason <text>]`

Manually flip a directive from `running` to `blocked`. Useful when the
brain left a directive stuck after an escalation-kill (shell timeout,
ctrl-C, background-task kill) and you want a clean status without
poking SQL by hand.

```
factory directive mark-blocked 01K0…ULID --reason "ran out of budget"
```

Refuses to touch directives that aren't `running` (already-terminal
rows exit 2 with a message). Works without the daemon. The reason is
stored in `directives.blocked_reason`. For the automated version —
"sweep at daemon startup" — see `reconcileOrphanedDirectives` in
`@factory5/state`, which is wired into `factoryd` automatically.

## `factory cancel <directive-id> [--reason <text>]`

Actively cancel a directive — flip the row to `failed` and kill the in-flight worker subprocess (SIGTERM, then SIGKILL after a 5 s grace window). Distinct from `factory directive mark-blocked`: that command flips a stuck row's status without touching the worker; `cancel` is the active-kill surface.

```
$ factory cancel 01K0…ULID --reason "wrong project"
factory cancel: 01K0…ULID → failed (reason: wrong project)
  worker abort signalled — subprocess will exit within ~5 s.
```

Two paths, daemon-preferred:

- **Daemon up** — IPC `POST /directives/:id/cancel`. The daemon flips the row and fires the per-directive `AbortController`, which propagates to the worker subprocess. The whole cancel completes inside the 10 s acceptance budget.
- **Daemon down** — DB-direct row update. Workers running in another shell continue until their next directive-status check; the row is reconciled immediately for anyone querying state.

Exit codes: `0` cancelled, `1` hard error, `2` directive id not found, `3` directive already terminal (`complete` | `failed` | `blocked`).

## `factory chat`

Interactive REPL that writes `intent=chat` directives against a running daemon and polls `outbound_messages` for replies. Type `/quit` or `Ctrl-D` to exit.

## `factory ask "<question>"`

Single-shot chat: mint one `intent=chat` directive, await the brain's reply, print, exit. The mint + notify + reply-poll cycle is shared with `factory chat` via the internal `submitOneDirective` helper. The daemon must be running (chat goes through the brain, not direct SQLite).

```
$ factory ask "what's the spend this week?"
You've spent $0.32 across 84 calls in the last 7 days. Top project: weather-cli ($0.18).

$ factory ask "list my projects" --json | jq -r .reply
weather-cli, hello-cli, finance-tracker
```

`--json` emits a single JSON object on stdout (no leading log noise), shape `{ directive, reply, status }` — `status` is `reply` | `timeout` | `terminal-no-reply` (the latter adds a `directiveStatus` field). `--autonomy <chat|assisted|autonomous>` overrides the directive's autonomy mode (defaults to `chat`).

Exit codes: `0` got a reply, `1` timeout / terminal-no-reply / hard error, `2` no daemon running (preflight).

## `factory ui-token`

Recover the dashboard URL after losing the terminal scrollback. The web UI bearer (`FACTORY5_UI_TOKEN`) is rotated per daemon startup, so the URL printed at boot is the only way to log into the live dashboard until the daemon restarts. This command queries the running daemon for its current token via the loopback-only `/ui-token` IPC route and prints the dashboard URL.

```
$ factory ui-token
http://127.0.0.1:25295/app/?t=ab12cd34…
```

When the SPA bundle hasn't been built (`pnpm --filter factory-web build`), the printed URL points at the dev server (`http://localhost:4321/app/?t=…`) and a hint is added.

`--token-only` prints just the bare token, useful for piping into env vars or `curl -H "Authorization: Bearer $(factory ui-token --token-only)"`.

Exit codes: `0` on success, `2` if no daemon is running, `3` if the daemon is running CLI-only (no UI bundle), `1` on any other failure.

## `factory budget set <project>`

Set per-project `metadata.budgetDefaults` in `<workspace>/<project>/.factory/project.json` — the same on-disk shape the web UI's `PUT /api/v1/projects/:id/budget` writes (ADR 0027). Idempotent — same call twice yields the same on-disk state.

```
$ factory budget set weather-cli --max-usd 5
factory budget set: weather-cli -> metadata.budgetDefaults
  maxUsd:   $5.00
  maxSteps: (unset)

$ factory budget set weather-cli --max-steps 100
factory budget set: weather-cli -> metadata.budgetDefaults
  maxUsd:   $5.00       # preserved — per-field merge
  maxSteps: 100
```

**Per-field merge** is the distinguishing CLI semantic: passing only `--max-steps` preserves an existing `maxUsd`. The web UI's PUT is full-document replacement; the CLI takes one or both flags and merges into the existing block, so operators never have to re-state the whole budget block. At least one of `--max-usd <n>` or `--max-steps <n>` is required.

Project resolution: `<project>` is matched against the `projects` table by name (the common case) first, then by full ULID. Two projects sharing a name surface as ambiguous — disambiguate with the full ULID. ULID-suffix matching is intentionally not supported here (use `factory spend --project <suffix>` to resolve a suffix to a full ULID first).

Exit codes: `0` on success, `1` on hard error (filesystem / DB exception), `2` on invalid input (missing flags, bad value, project not found, project.json missing or corrupt, ambiguous ref).

## `factory project list / show <name> / delete <name>`

Per-project introspection + lifecycle (registry-aware).

`factory project list` walks the projects registry and prints one row per project — name + status + on-disk language + most-recent build status + workspace path. A missing or corrupt `project.json` renders the language column as `(unavailable)` rather than failing the whole table.

```
$ factory project list
NAME         STATUS  LANGUAGE  LAST BUILD                     WORKSPACE
weather-cli  active  python    complete 2026-04-26T14:02:11Z   /home/op/factory5-workspace/weather-cli
hello-cli    active  node      (no builds yet)                 /home/op/factory5-workspace/hello-cli
```

`factory project show <project>` resolves a project ref (name or full ULID) and pretty-prints the registry row + on-disk `project.json` metadata + the most recent build directive's id / status / timestamp.

`factory project delete <project>` is the unregister surface. Defaults are non-destructive — the registry row is removed, workspace files are left in place. Two flags shape the behaviour:

- _(no flags)_ — interactive `y/N` prompt, then `DELETE FROM projects` only.
- `--force` — skip the prompt, registry-only delete.
- `--purge` — second typed-name confirm, then `DELETE FROM projects` followed by `rm -rf <workspacePath>`.
- `--purge --force` — no prompts, registry-only delete + rm-rf. Use with care.

Order on `--purge`: registry first, then `rm -rf`. If the rm trips (permission denied, etc.) the registry is already clean — the operator gets the rm error, removes the dir manually, and `factory build` won't trip on a stale registry entry.

Exit codes (all three handlers): `0` on success (a declined prompt counts as success — operator chose to cancel), `1` on hard error (rm-rf failed unexpectedly), `2` on invalid input (project not found, ambiguous name).

## `factory spend`

Cross-session spend dashboard reading the LLM-call rollup tables in `@factory5/state`. Four group-by modes — `project` (default), `directive`, `day`, `model` — each renders a table with a `TOTAL` line. NDJSON via `--json` emits one row per line with no totals row (derive with `jq 'map(.totalUsd) | add'`).

```
$ factory spend --group-by day --since 7d
DATE        N_CALL    SPENT
2026-04-26      12  $0.0432
…
TOTAL  84 calls  $0.3210
```

Window flags: `--since` and `--until` accept either a relative duration (`7d`, `24h`, `30m`) or an ISO8601 date / datetime. `--project <ref>` resolves a project by full ULID, exact name, or unique ULID suffix; ambiguous refs error rather than silently picking one. `--limit` defaults to 50, capped at 1000.

Exit codes: `0` on success (an empty result set is success, not error), `2` on invalid input (bad `--group-by`, malformed `--since` / `--until`, or unknown / ambiguous `--project`).

## `factory findings list|show|backfill|mark`

Cross-project findings registry surface — `findings_registry` table per ADR 0021; advisory-vs-blocking gating per ADR 0018.

`factory findings list` defaults to `OPEN` blocking findings. Filter with `--severity LOW|MEDIUM|HIGH|CRITICAL`, `--status OPEN|FIXED|VERIFIED|WONTFIX|all`, `--project <name-or-glob>` (glob accepts `*` and `?`), `--advisory` / `--blocking` (ADR 0018 — advisory findings don't gate). `--limit` defaults to 50, capped at 1000. `--json` emits NDJSON.

```
$ factory findings list --severity HIGH
project   id    severity  status  source        target              description
my-cli    F003  HIGH      OPEN    test-failure  tests/auth.test.ts  Login flow regression …
```

`factory findings show <id>` accepts either `<project>/<id>` or a bare `<id>` (the latter must be unambiguous across projects — multi-project matches print a disambiguation list and exit 2). Renders Description + Resolution as wrapped blocks; `--json` emits one JSON object.

`factory findings backfill` walks `<workspace>/<project>/.factory/findings.json` one level deep and upserts every finding into the registry. Idempotent on `(project_id, finding_id)`. `--workspace <path>` overrides the default `~/factory5-workspace`. `--dry-run` reports what would change without writing. Projects without `.factory/project.json` (ADR 0021) are skipped — the operator must run `factory build` once in that project to claim identity. Exit `1` if any per-project errors surfaced; `2` if the workspace itself isn't readable.

`factory findings mark <id> <status>` flips a finding's status (`OPEN | FIXED | VERIFIED | WONTFIX` — case-insensitive on input). The id resolution mirrors `factory findings show`: either `<project>/<id>` for an explicit project, or a bare `<id>` that must be unambiguous (multi-project matches print the same disambiguation list `show` does). `--note <prose>` records a resolution string against the finding — the same field the agent-side `RESOLUTION` parser populates from fixer output. Output is one line: `<id> in <project>: <prevStatus> → <newStatus>`. Idempotent re-flips succeed; `resolvedAt` is set on the first transition into a terminal status and preserved across subsequent flips. Exit `2` on invalid status / not-found / ambiguous bare id; exit `1` on a runtime error (registry/on-disk drift surfaces as a thrown `updateFindingStatus`).

## `factory questions cleanup`

Sweep `pending_questions` rows whose parent directive ended in a terminal state (`complete` / `failed` / `blocked`). These are escalations the operator never replied to — by the time anyone does, the brain has long since moved on, so the row is just noise on `factory status` and on the dashboard's open-questions view. The sweep marks them as answered with a synthetic note (rather than deleting) to preserve forensic value.

```
$ factory questions cleanup --since 2026-04-01 --dry-run
Found 4 orphaned question(s):
  01K0…  directive=01K0… (failed, discord)  created=2026-04-12T…
    "Should we use Postgres or SQLite for the …"
…
Dry run — no rows written. Re-run without --dry-run to mark them answered.
```

Works whether or not factoryd is running (straight SQL). `--since <iso-date>` restricts the sweep to rows created strictly before that ISO-8601 date / datetime. Exit `0` on success (including empty sweeps), `2` on malformed `--since`, `1` on any other failure.

## Tab completion

`factory completion <shell>` emits a static tab-completion script. Three shells: `bash`, `zsh`, `pwsh`. Static surface only — completes top-level command names and the fixed nested sub-subcommands (e.g. `daemon start|stop|status|restart`, `project list|show|delete`). Dynamic completion (project names, directive ids) is intentionally deferred: it would require running `factory` inside the completion script, which adds latency on every tab press.

Install one-liners — pipe the script into your shell's rc-file:

```bash
# bash
factory completion bash >> ~/.bashrc && source ~/.bashrc

# zsh
factory completion zsh > "${fpath[1]}/_factory" && compinit

# pwsh
factory completion pwsh >> $PROFILE && . $PROFILE
```

Or for one shell session without persisting:

```bash
source <(factory completion bash)                  # bash
factory completion pwsh | Out-String | Invoke-Expression   # pwsh
```

Exit codes: `0` script printed, `2` unknown shell.

## API

```ts
import { buildCli } from '@factory5/cli';

const program = buildCli();
await program.parseAsync(process.argv);
```
