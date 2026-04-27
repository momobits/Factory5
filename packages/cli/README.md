# @factory5/cli

Commander-based CLI. Used by the `factory` binary in `apps/factory`.

## Subcommands

| Command                                                           | Phase | Status   | Purpose                                                                       |
| ----------------------------------------------------------------- | ----- | -------- | ----------------------------------------------------------------------------- |
| `factory --version`                                               | 0     | **done** | Print version                                                                 |
| `factory answer <questionId> [text...]`                           | 4     | **done** | Close a pending `askUser`/`escalate_blocked` question                         |
| `factory build <project> [--autonomy … --concurrency … --inline]` | 1–3   | **done** | Delegates to factoryd if running, else inline                                 |
| `factory chat [--autonomy …]`                                     | 3     | **done** | Interactive REPL against factoryd (daemon must be up)                         |
| `factory daemon start\|stop\|status\|restart`                     | 3     | **done** | Lifecycle; refuses duplicate starts via pidfile                               |
| `factory directive mark-blocked <id> [--reason …]`                | 5     | **done** | Flip a stuck `running` directive to `blocked` (manual recovery)               |
| `factory doctor [--skip-call] [--skip-discord]`                   | 1/4   | **done** | Provider probe + triage round-trip + optional Discord reachability probe      |
| `factory init [--discord-token … --discord-application-id … ...]` | 1/4   | **done** | Writes `config.toml`; populates `[channels.discord]` when `--discord-*` given |
| `factory resume <project>`                                        | 2     | **done** | Resume the most recent build for a project                                    |
| `factory status [--limit N]`                                      | 1     | **done** | Projects + recent directives + per-directive spend                            |
| `factory ui-token [--token-only]`                                 | 13    | **done** | Print the dashboard URL with the live `FACTORY5_UI_TOKEN`                     |
| `factory logs [--component] [--directive] [--follow]`             | 3+    | stub     | Tail logs across components                                                   |
| `factory inspect <directiveId>`                                   | 3+    | planned  | Stitch all logs/state for a directive                                         |
| `factory push <project>`                                          | 5     | planned  | Push completed project to GitHub                                              |

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

## API

```ts
import { buildCli } from '@factory5/cli';

const program = buildCli();
await program.parseAsync(process.argv);
```
