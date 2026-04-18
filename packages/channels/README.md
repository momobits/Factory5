# @factory5/channels

`ChannelPlugin` interface and channel implementations. Lives in the **daemon** process.

## Status

- **Interface** — defined (`src/types.ts`)
- **`cli-rpc` channel** — stub (Phase 3)
- **`discord` channel** — stub (Phase 4)
- **`telegram` channel** — future
- **`web` channel** — future

## Adding a channel

1. Implement `ChannelPlugin` from `src/types.ts`
2. Export from `src/index.ts`
3. Register from the daemon entry (`apps/factoryd/src/main.ts`)
4. Add a row to `docs/ARCHITECTURE.md` channels table
