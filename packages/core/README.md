# @factory5/core

Shared types, Zod schemas, and constants used across all factory5 packages.

## What lives here

- **Types** (`src/types.ts`) — TypeScript types derived from Zod schemas (single source of truth: schemas)
- **Schemas** (`src/schemas.ts`) — Zod schemas for runtime validation at all boundaries (IPC, SQLite, channel ingress, LLM JSON output)
- **Constants** (`src/constants.ts`) — enum-like literal sets used across the codebase
- **IDs** (`src/ulid.ts`) — wrapper around `ulid` for time-sortable, collision-free identifiers

## Usage

```ts
import { directiveSchema, type Directive, newId } from '@factory5/core';

const raw = JSON.parse(somePayload);
const directive: Directive = directiveSchema.parse(raw); // throws on invalid

const id = newId(); // "01HQXM..."
```

## Exports

See [`../../docs/CONTRACTS.md`](../../docs/CONTRACTS.md) for the canonical human-readable description of each shape.

## Conventions

- **Types are derived from schemas** via `z.infer<typeof schema>`. Don't write parallel TypeScript types — they'll drift.
- **Every public type has a schema.** If you need to read it across a boundary (IPC, SQLite row, file), validate with the schema.
- **Status enums are string literals** (not numeric) for SQL-friendly storage and human-readable logs.

## Testing

```bash
pnpm --filter @factory5/core test
```

Tests verify:

- Round-trip schema parse/serialize for every shape
- Backward-compat: schemas accept previously-valid payloads
- Forward-compat: schemas reject obviously-malformed payloads with clear error paths
