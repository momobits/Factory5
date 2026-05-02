# @factory5/cli

Commander-based CLI. Used by the `factory` binary in `apps/factory`.

## Subcommands

| Command                                                                         | Status   | Purpose                                                                       |
| ------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `factory --version`                                                             | **done** | Print version                                                                 |
| `factory answer <questionId> [text...]`                                         | **done** | Close a pending `askUser`/`escalate_blocked` question                         |
| `factory build <project> [--autonomy … --concurrency … --inline]`               | **done** | Delegates to factoryd if running, else inline                                 |
| `factory chat [--autonomy …]`                                                   | **done** | Interactive REPL against factoryd (daemon must be up)                         |
| `factory daemon start\|stop\|status\|restart`                                   | **done** | Lifecycle; refuses duplicate starts via pidfile                               |
| `factory directive mark-blocked <id> [--reason …]`                              | **done** | Flip a stuck `running` directive to `blocked` (manual recovery)               |
| `factory doctor [--skip-call] [--skip-discord]`                                 | **done** | Provider probe + triage round-trip + optional Discord reachability probe      |
| `factory findings list\|show\|backfill`                                         | **done** | Cross-project findings registry — list, show one, backfill from workspaces    |
| `factory init [--discord-token … --discord-application-id … ...]`               | **done** | Writes `config.toml`; populates `[channels.discord]` when `--discord-*` given |
| `factory questions cleanup [--since <iso-date>] [--dry-run]`                    | **done** | Mark un-answered questions on terminated directives as answered (sweep)       |
| `factory resume <project>`                                                      | **done** | Resume the most recent build for a project                                    |
| `factory spend [--group-by project\|directive\|day\|model] [--since/--until …]` | **done** | Cross-session spend dashboard — per-project / -directive / -day / -model      |
| `factory status [--limit N]`                                                    | **done** | Projects + recent directives + per-directive spend                            |
| `factory ui-token [--token-only]`                                               | **done** | Print the dashboard URL with the live `FACTORY5_UI_TOKEN`                     |
| `factory logs [--component] [--directive] [--follow]`                           | stub     | Placeholder — prints a hint pointing at `~/.factory5/logs/`                   |

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

## `factory chat`

Interactive REPL that writes `intent=chat` directives against a running daemon and polls `outbound_messages` for replies. Type `/quit` or `Ctrl-D` to exit.

## `factory ui-token`

Recover the dashboard URL after losing the terminal scrollback. The web UI bearer (`FACTORY5_UI_TOKEN`) is rotated per daemon startup, so the URL printed at boot is the only way to log into the live dashboard until the daemon restarts. This command queries the running daemon for its current token via the loopback-only `/ui-token` IPC route and prints the dashboard URL.

```
$ factory ui-token
http://127.0.0.1:25295/app/?t=ab12cd34…
```

When the SPA bundle hasn't been built (`pnpm --filter factory-web build`), the printed URL points at the dev server (`http://localhost:4321/app/?t=…`) and a hint is added.

`--token-only` prints just the bare token, useful for piping into env vars or `curl -H "Authorization: Bearer $(factory ui-token --token-only)"`.

Exit codes: `0` on success, `2` if no daemon is running, `3` if the daemon is running CLI-only (no UI bundle), `1` on any other failure.

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

## `factory findings list|show|backfill`

Cross-project findings registry surface — `findings_registry` table per ADR 0021; advisory-vs-blocking gating per ADR 0018.

`factory findings list` defaults to `OPEN` blocking findings. Filter with `--severity LOW|MEDIUM|HIGH|CRITICAL`, `--status OPEN|FIXED|VERIFIED|WONTFIX|all`, `--project <name-or-glob>` (glob accepts `*` and `?`), `--advisory` / `--blocking` (ADR 0018 — advisory findings don't gate). `--limit` defaults to 50, capped at 1000. `--json` emits NDJSON.

```
$ factory findings list --severity HIGH
project   id    severity  status  source        target              description
my-cli    F003  HIGH      OPEN    test-failure  tests/auth.test.ts  Login flow regression …
```

`factory findings show <id>` accepts either `<project>/<id>` or a bare `<id>` (the latter must be unambiguous across projects — multi-project matches print a disambiguation list and exit 2). Renders Description + Resolution as wrapped blocks; `--json` emits one JSON object.

`factory findings backfill` walks `<workspace>/<project>/.factory/findings.json` one level deep and upserts every finding into the registry. Idempotent on `(project_id, finding_id)`. `--workspace <path>` overrides the default `~/factory5-workspace`. `--dry-run` reports what would change without writing. Projects without `.factory/project.json` (ADR 0021) are skipped — the operator must run `factory build` once in that project to claim identity. Exit `1` if any per-project errors surfaced; `2` if the workspace itself isn't readable.

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

## API

```ts
import { buildCli } from '@factory5/cli';

const program = buildCli();
await program.parseAsync(process.argv);
```
