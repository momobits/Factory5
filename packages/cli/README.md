# @factory5/cli

Commander-based CLI. Used by the `factory` binary in `apps/factory`.

## Subcommands (planned)

| Command | Phase | Purpose |
|---|---|---|
| `factory --version` | 0 | Print version |
| `factory init` | 0/1 | Interactive setup; writes `~/.factory5/config.toml` |
| `factory build <project> [--autonomy chat\|assisted\|autonomous]` | 1 | Inline build |
| `factory resume <project>` | 1 | Resume a stopped/failed build |
| `factory status` | 0/1 | Show projects + active directives |
| `factory chat` | 3 | Interactive REPL against brain |
| `factory daemon start\|stop\|status\|logs\|install` | 3 | Daemon lifecycle |
| `factory logs [--component] [--directive] [--follow]` | 3 | Tail logs across components |
| `factory inspect <directiveId>` | 3 | Stitch all logs/state for a directive |
| `factory push <project>` | 5 | Push completed project to GitHub |

## API

```ts
import { buildCli } from '@factory5/cli';

const program = buildCli();
await program.parseAsync(process.argv);
```
