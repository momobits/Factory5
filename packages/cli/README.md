# @factory5/cli

Commander-based CLI. Used by the `factory` binary in `apps/factory`.

## Subcommands

| Command                                                           | Phase | Status   | Purpose                                                     |
| ----------------------------------------------------------------- | ----- | -------- | ----------------------------------------------------------- |
| `factory --version`                                               | 0     | **done** | Print version                                               |
| `factory build <project> [--autonomy chat\|assisted\|autonomous]` | 1     | **done** | Inline build (triage → architect → plan → workers → assess) |
| `factory doctor [--skip-call]`                                    | 1     | **done** | Verify `claude` binary + run a tiny round-trip              |
| `factory status [--limit N]`                                      | 1     | **done** | Projects + recent directives + per-directive spend          |
| `factory init`                                                    | 1     | stub     | Interactive setup; writes `~/.factory5/config.toml`         |
| `factory resume <project>`                                        | 1     | planned  | Resume a stopped/failed build                               |
| `factory chat`                                                    | 3     | stub     | Interactive REPL against brain                              |
| `factory daemon start\|stop\|status\|logs`                        | 3     | stubs    | Daemon lifecycle                                            |
| `factory logs [--component] [--directive] [--follow]`             | 3     | stub     | Tail logs across components                                 |
| `factory inspect <directiveId>`                                   | 3     | planned  | Stitch all logs/state for a directive                       |
| `factory push <project>`                                          | 5     | planned  | Push completed project to GitHub                            |

## `factory build <project>`

Resolves `<project>` in this order:

1. Absolute path that exists
2. `./foo` / `../foo` relative to cwd
3. `<workspace>/<name>` (default workspace is `~/factory5-workspace`)
4. `templates/<name>` in the factory5 repo — if found, copied into the workspace

Writes a directive to SQLite, opens the brain in inline mode, prints a summary, exits `0` on `complete` / `2` on `blocked` / `1` on hard error.

## `factory doctor`

Smoke check the provider stack before burning tokens on a full build:

```
$ factory doctor
Checking claude-cli provider…
  available(): true

Calling triage (quick tier) with a test directive…
  intent:     build
  confidence: 0.95
  reasoning:  user explicitly requests 'build me …'

All checks passed.
```

`--skip-call` skips the round-trip and only checks availability.

## API

```ts
import { buildCli } from '@factory5/cli';

const program = buildCli();
await program.parseAsync(process.argv);
```
