# Specs — upgrade contracts

Spec updates required by upgrade tiers go here. Each spec is a short markdown document pinning a contract that the code will honor — IPC route shapes, external command grammars, on-disk file formats, etc.

Conceptually similar to ADRs, but scoped to the upgrade work and lighter-weight: no `Context / Decision / Consequences / Alternatives` template, just enough to be precise about the shape.

## When to write a spec

- A new IPC route (e.g. SSE event format on `/api/v1/directives/:id/stream`)
- A new external command grammar (e.g. Discord slash command list, Telegram bot command list)
- A new on-disk file shape (e.g. a `project.json` migration)
- A new file or table that crosses a process boundary (brain ↔ daemon ↔ workers ↔ channels)

## When to write an ADR instead

For architectural decisions with long-term implications. ADRs go in `docs/decisions/`.

A spec pins a _shape_; an ADR pins a _decision_. The two often pair: a tier might write `specs/sse-directive-stream.md` (the shape) and `docs/decisions/0029-directive-stream-protocol.md` (the why), referencing each other.

## Naming

`specs/<short-kebab-name>.md`. No numeric prefix — these are scoped to the upgrade and cleared at the end.

## Index

(empty — populated as specs are written)
